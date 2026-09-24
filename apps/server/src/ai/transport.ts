import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { record } from './mapping'
import { HttpException } from '@nestjs/common'

export class AiError extends HttpException {
  constructor(public readonly code: string, public readonly outcomeUnknown = false) {
    super({ code, message: code, outcomeUnknown }, code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 :
      /UNSAFE|ACTIVE|UNKNOWN_OUTCOME/.test(code) ? 409 : /TIMEOUT|PROVIDER|NETWORK/.test(code) ? 502 : 400)
  }
}
export function classify(error: unknown): string {
  if (error instanceof AiError) return error.code
  const message = error instanceof Error ? error.message : String(error)
  if (/out of memory|cuda.*oom/i.test(message)) return 'CUDA_OOM'
  if (/timeout/i.test(message)) return 'TIMEOUT'
  if (/abort/i.test(message)) return 'CANCELLED'
  return 'PROVIDER_ERROR'
}
export function validateBaseUrl(base: string, allow = process.env.ALLOWED_AI_HOSTS ?? ''): URL {
  const url = new URL(base)
  // Exact host[:port] entries only. No wildcard/suffix matching.
  const allowed = allow.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
    !allowed.includes(url.host.toLowerCase())) throw new AiError('HOST_NOT_ALLOWED')
  return url
}
function key(): Buffer {
  const value = process.env.AI_SECRET_KEY ?? ''
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new AiError('AI_SECRET_KEY_MUST_BE_32_BYTE_HEX')
  return Buffer.from(value, 'hex')
}
export function encryptSecret(secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}
export function decryptSecret(value?: string | null): string | undefined {
  if (!value) return undefined
  const [version, iv, tag, data] = value.split('.')
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new AiError('INVALID_SECRET')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}

export interface Endpoint { baseUrl: string; secretEncrypted?: string | null }
interface RequestOptions {
  body?: unknown; signal?: AbortSignal; timeout?: number; maxBytes?: number
}
export class AiTransport {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  request<T>(service: Endpoint, path: string, options: RequestOptions & { consume: (response: Response) => Promise<T> }): Promise<T>
  request(service: Endpoint, path: string, options?: RequestOptions): Promise<Record<string, unknown>>
  async request(service: Endpoint, path: string, options: RequestOptions & {
    consume?: (response: Response) => Promise<unknown>
  } = {}): Promise<unknown> {
    const base = validateBaseUrl(service.baseUrl)
    if (!path.startsWith('/') || path.startsWith('//')) throw new AiError('INVALID_PATH')
    const url = new URL(base.toString().replace(/\/$/, '') + path)
    if (url.origin !== base.origin) throw new AiError('HOST_NOT_ALLOWED')
    const secret = decryptSecret(service.secretEncrypted)
    const signal = AbortSignal.any([AbortSignal.timeout(options.timeout ?? 30_000), ...(options.signal ? [options.signal] : [])])
    try {
      const response = await this.fetcher(url, {
        method: options.body === undefined ? 'GET' : 'POST',
        redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      if (!response.ok) throw new AiError(`PROVIDER_HTTP_${response.status}`, response.status >= 500)
      if (options.consume) return await options.consume(response)
      const bytes = await readBounded(response, options.maxBytes ?? 16 * 1024 * 1024)
      const value: unknown = JSON.parse(bytes.toString('utf8'))
      if (!record(value)) throw new AiError('INVALID_PROVIDER_RESPONSE', options.body !== undefined)
      return value
    } catch (error) {
      if (error instanceof AiError) throw error
      throw new AiError(signal.aborted ? (options.signal?.aborted ? 'CANCELLED' : 'TIMEOUT') : 'NETWORK_OR_PROTOCOL_ERROR', options.body !== undefined)
    }
  }
}
export async function readBounded(response: Response, max: number): Promise<Buffer> {
  if (!response.body) throw new AiError('EMPTY_RESPONSE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) throw new AiError('RESPONSE_TOO_LARGE')
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

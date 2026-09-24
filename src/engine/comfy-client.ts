import { applyMapping, type WorkflowMapping } from '../providers/comfyui'
import type { JsonValue } from '../providers/contracts'

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
export interface ComfyProbeResult {
  connected: boolean
  version?: string
  gpu?: string
  vramTotal?: number
  vramUsed?: number
  running: number
  queued: number
  installedNodeTypes: string[]
  checkedAt: string
  websocket: 'unavailable'
  model: 'unavailable'
}
export interface ComfyOutput {
  nodeId: string
  filename: string
  subfolder: string
  type: string
  url: string
}
export type NativeExecutionStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'UNKNOWN'
export interface NativeExecutionResult {
  status: NativeExecutionStatus
  outputs: ComfyOutput[]
  error?: string
}
export class ComfyTransportError extends Error {
  constructor(
    public readonly code:
      | 'NETWORK_ERROR'
      | 'TIMEOUT'
      | 'WORKFLOW_ERROR'
      | 'NODE_ERROR'
      | 'CUDA_OOM'
      | 'MODEL_MISSING'
      | 'UNSAFE_CANCEL',
    message: string,
  ) {
    super(message)
  }
}
export function classifyComfyError(error: unknown): ComfyTransportError {
  if (error instanceof ComfyTransportError) return error
  const text = error instanceof Error ? error.message : String(error)
  const code = /out of memory|cuda.*oom/i.test(text)
    ? 'CUDA_OOM'
    : /model.*(missing|not found)|checkpoint.*not found/i.test(text)
      ? 'MODEL_MISSING'
      : /node.*error|execution_error/i.test(text)
        ? 'NODE_ERROR'
        : 'NETWORK_ERROR'
  return new ComfyTransportError(code, text)
}

/**
 * Native HTTP transport, called only after explicit user action. No credentials are persisted.
 * Running cancellation is conservative: /interrupt is instance-wide, not prompt-scoped.
 */
export class ComfyHttpClient {
  private readonly base: string
  constructor(
    baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeout = 15000,
  ) {
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('请求超时必须为正数')
    const url = new URL(baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('实例地址只接受无凭据、无查询参数的 HTTP(S) URL')
    this.base = url.href.replace(/\/$/, '')
  }

  private async request(path: string, body?: unknown, externalSignal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController()
    const externalAbort = () => controller.abort(externalSignal?.reason ?? new Error('请求取消'))
    if (externalSignal?.aborted) externalAbort()
    else externalSignal?.addEventListener('abort', externalAbort, { once: true })
    let rejectAbort: (reason: unknown) => void = () => undefined
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    const onAbort = () => rejectAbort(controller.signal.reason)
    controller.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(
      () => controller.abort(new ComfyTransportError('TIMEOUT', `ComfyUI 请求超过 ${this.timeout}ms`)),
      this.timeout,
    )
    try {
      if (controller.signal.aborted) throw controller.signal.reason
      return await Promise.race([
        (async () => {
          const response = await this.fetcher(`${this.base}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: controller.signal,
          })
          if (!response.ok)
            throw new ComfyTransportError('NETWORK_ERROR', `ComfyUI ${path}: HTTP ${response.status}`)
          if (response.status === 204) return {}
          const text = await response.text()
          return text ? (JSON.parse(text) as unknown) : {}
        })(),
        aborted,
      ])
    } catch (cause) {
      throw classifyComfyError(cause)
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
      externalSignal?.removeEventListener('abort', externalAbort)
    }
  }

  async health(signal?: AbortSignal): Promise<ComfyProbeResult> {
    const [stats, queue, nodes] = await Promise.all([
      this.request('/system_stats', undefined, signal),
      this.queue(signal),
      this.request('/object_info', undefined, signal),
    ])
    if (!isObject(stats) || !isObject(stats.system) || !Array.isArray(stats.devices))
      throw new Error('ComfyUI system_stats 响应无效')
    if (!isObject(nodes)) throw new Error('ComfyUI object_info 响应无效')
    const device = Array.isArray(stats.devices) && isObject(stats.devices[0]) ? stats.devices[0] : undefined
    const system = isObject(stats.system) ? stats.system : undefined
    const total = typeof device?.vram_total === 'number' ? device.vram_total : undefined
    const free = typeof device?.vram_free === 'number' ? device.vram_free : undefined
    return {
      connected: true,
      version: typeof system?.comfyui_version === 'string' ? system.comfyui_version : undefined,
      gpu: typeof device?.name === 'string' ? device.name : undefined,
      vramTotal: total,
      vramUsed: total !== undefined && free !== undefined ? Math.max(0, total - free) : undefined,
      running: queue.running.length,
      queued: queue.queued.length,
      installedNodeTypes: isObject(nodes) ? Object.keys(nodes) : [],
      checkedAt: new Date().toISOString(),
      websocket: 'unavailable',
      model: 'unavailable',
    }
  }

  async queue(signal?: AbortSignal): Promise<{ running: string[]; queued: string[] }> {
    const response = await this.request('/queue', undefined, signal)
    if (
      !isObject(response) ||
      !Array.isArray(response.queue_running) ||
      !Array.isArray(response.queue_pending)
    )
      throw new Error('ComfyUI queue 响应无效')
    const ids = (items: unknown[]): string[] =>
      items.map((item) => {
        if (!Array.isArray(item) || typeof item[1] !== 'string' || !item[1].trim())
          throw new Error('ComfyUI 队列项不合法，不能确认作业归属')
        return item[1]
      })
    return { running: ids(response.queue_running), queued: ids(response.queue_pending) }
  }

  async submit(
    workflow: unknown,
    mapping: WorkflowMapping,
    inputs: Record<string, JsonValue>,
    signal?: AbortSignal,
  ): Promise<string> {
    const prompt = applyMapping(workflow, mapping, inputs)
    const response = await this.request('/prompt', { prompt }, signal)
    if (
      !isObject(response) ||
      response.error ||
      (isObject(response.node_errors) && Object.keys(response.node_errors).length) ||
      typeof response.prompt_id !== 'string' ||
      !response.prompt_id.trim()
    ) {
      throw new ComfyTransportError('WORKFLOW_ERROR', `ComfyUI 拒绝工作流：${JSON.stringify(response)}`)
    }
    return response.prompt_id
  }

  async status(promptId: string, signal?: AbortSignal): Promise<NativeExecutionResult> {
    const history = await this.request(`/history/${encodeURIComponent(promptId)}`, undefined, signal)
    const entry = isObject(history) ? history[promptId] : undefined
    if (isObject(entry)) {
      const state = isObject(entry.status) ? entry.status : undefined
      if (
        state?.status_str === 'error' ||
        (Array.isArray(state?.messages) &&
          state.messages.some(
            (item) =>
              Array.isArray(item) && ['execution_error', 'execution_interrupted'].includes(String(item[0])),
          ))
      ) {
        return { status: 'FAILED', outputs: [], error: JSON.stringify(state) }
      }
      if (state?.completed === true) {
        const outputs: ComfyOutput[] = []
        if (isObject(entry.outputs))
          for (const [nodeId, node] of Object.entries(entry.outputs)) {
            if (!isObject(node)) continue
            for (const key of ['images', 'gifs', 'videos', 'audio']) {
              const files = node[key]
              if (!Array.isArray(files)) continue
              for (const file of files) {
                if (!isObject(file) || typeof file.filename !== 'string') continue
                const subfolder = typeof file.subfolder === 'string' ? file.subfolder : ''
                const type = typeof file.type === 'string' ? file.type : 'output'
                outputs.push({
                  nodeId,
                  filename: file.filename,
                  subfolder,
                  type,
                  url: this.outputUrl(file.filename, subfolder, type),
                })
              }
            }
          }
        return { status: 'SUCCESS', outputs }
      }
    }
    const queue = await this.queue(signal)
    return {
      status: queue.running.includes(promptId)
        ? 'RUNNING'
        : queue.queued.includes(promptId)
          ? 'QUEUED'
          : 'UNKNOWN',
      outputs: [],
    }
  }

  outputUrl(filename: string, subfolder = '', type = 'output'): string {
    return `${this.base}/view?${new URLSearchParams({ filename, subfolder, type })}`
  }

  async cancel(promptId: string, signal?: AbortSignal): Promise<void> {
    const queue = await this.queue(signal)
    if (queue.queued.includes(promptId)) {
      await this.request('/queue', { delete: [promptId] }, signal)
      return
    }
    if (queue.running.length === 1 && queue.running[0] === promptId) {
      await this.request('/interrupt', {}, signal)
      return
    }
    throw new ComfyTransportError(
      'UNSAFE_CANCEL',
      '无法安全取消：任务不在队列，或实例存在其他运行任务。未发送全局中断。',
    )
  }
}

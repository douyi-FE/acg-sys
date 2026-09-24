import type { JsonValue } from './contracts'
import { record } from '../services/validation'

export interface ApiNode {
  class_type: string
  inputs: Record<string, JsonValue>
  _meta?: { title?: string }
}
export type ApiWorkflow = Record<string, ApiNode>
export type WorkflowMapping = Record<string, string>
export interface ComfyFile {
  nodeId: string
  filename: string
  subfolder: string
  type: string
  url: string
}
export interface ComfyResult {
  promptId: string
  files: ComfyFile[]
}
export interface ComfyOptions {
  baseUrl: string
  workflow: unknown
  mapping: WorkflowMapping
  requiredInputs?: string[]
  fetch?: typeof globalThis.fetch
  pollInterval?: number
  timeout?: number
  headers?: Record<string, string>
}
function isJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)
  return record(value) && Object.values(value).every(isJson)
}
export function parseApiWorkflow(value: unknown): ApiWorkflow {
  if (!record(value)) throw new Error('ComfyUI 工作流必须是 API JSON 对象')
  if (Array.isArray(value.nodes) || Array.isArray(value.links))
    throw new Error('检测到 UI JSON；请在 ComfyUI 中导出 API Format，不能直接提交 UI 工作流')
  if (Object.keys(value).length === 0) throw new Error('API 工作流为空；占位模板不可执行')
  for (const [id, node] of Object.entries(value)) {
    if (
      ['__proto__', 'constructor', 'prototype'].includes(id) ||
      !record(node) ||
      typeof node.class_type !== 'string' ||
      !node.class_type.trim() ||
      !record(node.inputs) ||
      !Object.values(node.inputs).every(isJson)
    ) {
      throw new Error(`无效的 ComfyUI API 节点：${id}`)
    }
  }
  return JSON.parse(JSON.stringify(value)) as ApiWorkflow
}
function target(path: string): [string, string] {
  const parts = path.split('.')
  const node = parts[0]
  const input =
    parts.length === 2 ? parts[1] : parts.length === 3 && parts[1] === 'inputs' ? parts[2] : undefined
  if (!node || !input || parts.some((p) => ['__proto__', 'constructor', 'prototype'].includes(p)))
    throw new Error(`无效 mapping 路径：${path}；使用 nodeId.input 或 nodeId.inputs.input`)
  return [node, input]
}
/** 业务只传 prompt/seed 等语义参数；节点 ID 完全由用户的 mapping 配置决定。 */
export function applyMapping(
  workflow: unknown,
  mapping: WorkflowMapping,
  inputs: Record<string, JsonValue>,
  requiredInputs: string[] = [],
): ApiWorkflow {
  const graph = parseApiWorkflow(workflow)
  const used = new Set<string>()
  for (const [name, path] of Object.entries(mapping)) {
    const [nodeId, input] = target(path)
    const node = graph[nodeId]
    if (!node || !Object.hasOwn(node.inputs, input))
      throw new Error(`mapping ${name} 指向不存在的节点输入：${path}`)
    const canonical = `${nodeId}.${input}`
    if (used.has(canonical)) throw new Error(`重复 mapping 目标：${path}`)
    used.add(canonical)
  }
  for (const name of requiredInputs) {
    if (!Object.hasOwn(inputs, name) || !Object.hasOwn(mapping, name))
      throw new Error(`缺少必需 mapping/参数：${name}`)
  }
  for (const [name, value] of Object.entries(inputs)) {
    if (!Object.hasOwn(mapping, name)) throw new Error(`参数未配置 mapping：${name}`)
    if (!isJson(value)) throw new Error(`参数不是合法 JSON：${name}`)
    const path = mapping[name]
    if (path === undefined) throw new Error(`参数未配置 mapping：${name}`)
    const [nodeId, input] = target(path)
    const node = graph[nodeId]
    if (!node) throw new Error(`节点不存在：${nodeId}`)
    node.inputs[input] = value
  }
  return graph
}
function abortError(): Error {
  return new DOMException('ComfyUI 请求已取消', 'AbortError')
}
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? abortError())
      return
    }
    const aborted = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', aborted)
      reject(signal.reason ?? abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, ms)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

/** 原生 ComfyUI HTTP：POST /prompt → GET /history/{id} → GET /view。 */
export class ComfyUIAdapter {
  private readonly graph: ApiWorkflow
  private readonly mapping: WorkflowMapping
  private readonly required: string[]
  private readonly base: string
  private readonly fetcher: typeof globalThis.fetch
  private readonly pollInterval: number
  private readonly timeout: number
  private readonly headers: Record<string, string>

  constructor(options: ComfyOptions) {
    this.graph = applyMapping(options.workflow, options.mapping, {})
    this.mapping = { ...options.mapping }
    this.required = [...(options.requiredInputs ?? [])]
    const url = new URL(options.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password)
      throw new Error('ComfyUI 地址必须为 HTTP(S)，不能包含凭据、query 或 hash')
    this.base = url.toString().replace(/\/$/, '')
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.pollInterval = options.pollInterval ?? 1000
    this.timeout = options.timeout ?? 120000
    this.headers = { ...options.headers }
    if (
      !Number.isFinite(this.pollInterval) ||
      this.pollInterval <= 0 ||
      !Number.isFinite(this.timeout) ||
      this.timeout <= 0
    )
      throw new Error('pollInterval 和 timeout 必须为正数')
  }
  viewUrl(file: Pick<ComfyFile, 'filename' | 'subfolder' | 'type'>): string {
    return `${this.base}/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type })}`
  }
  async view(file: Pick<ComfyFile, 'filename' | 'subfolder' | 'type'>, signal?: AbortSignal): Promise<Blob> {
    return this.bounded(signal, async (boundedSignal) => {
      const response = await this.fetcher(this.viewUrl(file), {
        signal: boundedSignal,
        headers: this.headers,
      })
      if (!response.ok) throw new Error(`ComfyUI /view HTTP ${response.status}`)
      return response.blob()
    })
  }
  private async bounded<T>(
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason ?? abortError())
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(
      () => controller.abort(new Error(`ComfyUI timeout：超过 ${this.timeout}ms`)),
      this.timeout,
    )
    let rejectAbort: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(controller.signal.reason ?? abortError())
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
    })
    try {
      if (controller.signal.aborted) throw controller.signal.reason
      return await Promise.race([operation(controller.signal), aborted])
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason
      throw error
    } finally {
      clearTimeout(timer)
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
      signal?.removeEventListener('abort', abort)
    }
  }
  private async json(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await this.fetcher(`${this.base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`ComfyUI ${path} HTTP ${response.status}`)
    return response.json() as Promise<unknown>
  }
  async generate(
    inputs: Record<string, JsonValue>,
    signal?: AbortSignal,
    onSubmitted?: (promptId: string) => void,
  ): Promise<ComfyResult> {
    const prompt = applyMapping(this.graph, this.mapping, inputs, this.required)
    return this.bounded(signal, async (boundedSignal) => {
      const submitted = await this.json('/prompt', boundedSignal, { prompt })
      if (
        !record(submitted) ||
        submitted.error ||
        (record(submitted.node_errors) && Object.keys(submitted.node_errors).length > 0) ||
        typeof submitted.prompt_id !== 'string' ||
        !submitted.prompt_id
      )
        throw new Error(`ComfyUI /prompt 拒绝或响应无效：${JSON.stringify(submitted)}`)
      const promptId = submitted.prompt_id
      onSubmitted?.(promptId)
      while (true) {
        const history = await this.json(`/history/${encodeURIComponent(promptId)}`, boundedSignal)
        if (!record(history)) throw new Error('ComfyUI /history 响应无效')
        const entry = history[promptId]
        if (entry !== undefined) {
          if (!record(entry)) throw new Error('ComfyUI history 条目无效')
          const status = record(entry.status) ? entry.status : undefined
          if (
            status?.status_str === 'error' ||
            (Array.isArray(status?.messages) &&
              status.messages.some(
                (m) =>
                  Array.isArray(m) && ['execution_error', 'execution_interrupted'].includes(String(m[0])),
              ))
          ) {
            throw new Error(`ComfyUI 执行失败：${JSON.stringify(status)}`)
          }
          if (status?.completed === true) {
            if (!record(entry.outputs)) throw new Error('ComfyUI 执行完成但 outputs 无效')
            const files: ComfyFile[] = []
            for (const [nodeId, output] of Object.entries(entry.outputs)) {
              if (!record(output)) continue
              for (const key of ['images', 'gifs', 'videos', 'audio']) {
                const list = output[key]
                if (!Array.isArray(list)) continue
                for (const value of list) {
                  if (!record(value) || typeof value.filename !== 'string' || !value.filename)
                    throw new Error('ComfyUI 输出文件无效')
                  const file = {
                    nodeId,
                    filename: value.filename,
                    subfolder: typeof value.subfolder === 'string' ? value.subfolder : '',
                    type: typeof value.type === 'string' ? value.type : 'output',
                  }
                  files.push({ ...file, url: this.viewUrl(file) })
                }
              }
            }
            if (!files.length) throw new Error('ComfyUI 执行完成但未生成支持的媒体文件')
            return { promptId, files }
          }
        }
        await sleep(this.pollInterval, boundedSignal)
      }
    })
  }
}

import type { Settings, TaskAction, VideoRequest, Workflow } from '../types'
import { ApiError } from './errors'
import type {
  ApiClient,
  ArticleUpdate,
  AssetQuery,
  ListQuery,
  RequestOptions,
  TaskQuery,
  TaskUpdate,
} from './types'

export interface HttpApiClientOptions {
  /** API 前缀，不是站点根目录。例如 /api 或 https://backend.example/api。 */
  baseUrl?: string
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
  /** 默认 same-origin；跨域 Cookie 需要后端 CORS 和 CSRF 防护。 */
  credentials?: RequestCredentials
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function segment(id: string): string {
  if (!id.trim() || id === '.' || id === '..') {
    throw new ApiError('invalid-request', '资源 ID 不能为空或路径相对段')
  }
  try {
    return encodeURIComponent(id)
  } catch (cause) {
    throw new ApiError('invalid-request', '资源 ID 无法编码', { cause })
  }
}

function queryString(query?: ListQuery | TaskQuery | AssetQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    if ((key === 'page' || key === 'pageSize') && (!Number.isSafeInteger(value) || Number(value) < 1)) {
      throw new ApiError('invalid-request', `${key} 必须为正整数`)
    }
    params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

function assertTimeout(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) {
    throw new ApiError('invalid-request', 'timeoutMs 必须为 1..2147483647 范围内的正有限数')
  }
}

/** 不自动重试写操作，不回退 Mock，不读取/接收模型供应商密钥。 */
export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetcher: typeof globalThis.fetch
  private readonly credentials: RequestCredentials

  constructor(options: HttpApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api').replace(/\/+$/, '')
    // 只允许站内绝对路径或 HTTP(S) URL；禁止 URL 携带认证、查询串和 hash。
    if (!this.baseUrl || /[?#\\]/.test(this.baseUrl)) {
      throw new ApiError('invalid-request', 'baseUrl 必须是无查询串和 hash 的 API 前缀')
    }
    if (!this.baseUrl.startsWith('/') || this.baseUrl.startsWith('//')) {
      let url: URL
      try {
        url = new URL(this.baseUrl)
      } catch (cause) {
        throw new ApiError('invalid-request', 'baseUrl 格式无效', { cause })
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new ApiError('invalid-request', 'baseUrl 仅支持不含认证信息的 HTTP(S) URL')
      }
    }
    this.timeoutMs = options.timeoutMs ?? 15_000
    assertTimeout(this.timeoutMs)
    const fetcher = options.fetch ?? globalThis.fetch
    if (!fetcher) throw new ApiError('invalid-request', '当前环境不支持 fetch')
    this.fetcher = fetcher.bind(globalThis)
    this.credentials = options.credentials ?? 'same-origin'
  }

  protected async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
    body?: unknown,
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
    assertTimeout(timeoutMs)
    const controller = new AbortController()
    let abortError: ApiError | undefined
    let rejectAbort: (error: ApiError) => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    const abort = (kind: 'timeout' | 'aborted') => {
      if (abortError) return
      abortError = new ApiError(kind, kind === 'timeout' ? '请求超时' : '请求已取消')
      rejectAbort(abortError)
      controller.abort()
    }
    const onAbort = () => abort('aborted')
    const timer = setTimeout(() => abort('timeout'), timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      if (options.signal?.aborted) onAbort()
      const operation = async (): Promise<T> => {
        if (abortError) throw abortError
        let serialized: string | undefined
        try {
          serialized = body === undefined ? undefined : JSON.stringify(body)
        } catch (cause) {
          throw new ApiError('invalid-request', '请求体无法序列化为 JSON', { cause })
        }
        const response = await this.fetcher(`${this.baseUrl}${path}`, {
          method,
          signal: controller.signal,
          credentials: this.credentials,
          headers: {
            Accept: 'application/json',
            ...(serialized === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: serialized,
          redirect: 'error',
        })
        const text = await response.text()
        let payload: unknown
        try {
          payload = JSON.parse(text)
        } catch (cause) {
          if (response.ok) {
            throw new ApiError('invalid-response', '成功响应必须是 JSON 对象 { data: ... }', {
              status: response.status,
              cause,
            })
          }
          // 代理返回 HTML 或空错误体时仍保留 HTTP 状态，不泄漏原始页面。
        }
        if (!response.ok) {
          const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined
          throw new ApiError(
            'http',
            typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
            {
              status: response.status,
              code: typeof error?.code === 'string' ? error.code : undefined,
              details: error?.details,
              requestId:
                response.headers.get('x-request-id') ??
                (isRecord(payload) && typeof payload.requestId === 'string' ? payload.requestId : undefined),
            },
          )
        }
        if (
          !isRecord(payload) ||
          !Object.prototype.hasOwnProperty.call(payload, 'data') ||
          payload.data === null
        ) {
          throw new ApiError('invalid-response', '响应缺少非 null 的 data 字段', { status: response.status })
        }
        // 泛型是编译期契约；此处校验信封，领域字段须由后端契约测试保证。
        return payload.data as T
      }
      return await Promise.race([operation(), aborted])
    } catch (cause) {
      if (abortError) throw abortError
      if (cause instanceof ApiError) throw cause
      throw new ApiError('network', '网络请求或响应体读取失败', { cause })
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  createVideo: ApiClient['createVideo'] = (request: VideoRequest, options) =>
    this.request('POST', '/video/tasks', options, request)
  listVideoTasks: ApiClient['listVideoTasks'] = async (query, options) =>
    this.request('GET', `/video/tasks${queryString(query)}`, options)
  getVideoTask: ApiClient['getVideoTask'] = async (id, options) =>
    this.request('GET', `/video/tasks/${segment(id)}`, options)
  videoAction: ApiClient['videoAction'] = async (id, action: TaskAction, options) =>
    this.request('POST', `/video/tasks/${segment(id)}/actions`, options, { action })
  listTasks: ApiClient['listTasks'] = async (query, options) =>
    this.request('GET', `/tasks${queryString(query)}`, options)
  getTask: ApiClient['getTask'] = async (id, options) => this.request('GET', `/tasks/${segment(id)}`, options)
  action: ApiClient['action'] = async (id, action, options) =>
    this.request('POST', `/tasks/${segment(id)}/actions`, options, { action })
  updateTask: ApiClient['updateTask'] = async (id, update: TaskUpdate, options) =>
    this.request('PATCH', `/tasks/${segment(id)}`, options, update)
  listHotTopics: ApiClient['listHotTopics'] = async (query, options) =>
    this.request('GET', `/hot-topics${queryString(query)}`, options)
  analyzeTopic: ApiClient['analyzeTopic'] = async (id, options) =>
    this.request('POST', `/hot-topics/${segment(id)}/analyze`, options)
  createArticle: ApiClient['createArticle'] = (topicId, options) =>
    this.request('POST', '/articles', options, { topicId })
  listArticles: ApiClient['listArticles'] = async (query, options) =>
    this.request('GET', `/articles${queryString(query)}`, options)
  getArticle: ApiClient['getArticle'] = async (id, options) =>
    this.request('GET', `/articles/${segment(id)}`, options)
  updateArticle: ApiClient['updateArticle'] = async (id, update: ArticleUpdate, options) =>
    this.request('PATCH', `/articles/${segment(id)}`, options, update)
  listAssets: ApiClient['listAssets'] = async (query, options) =>
    this.request('GET', `/assets${queryString(query)}`, options)
  getAsset: ApiClient['getAsset'] = async (id, options) =>
    this.request('GET', `/assets/${segment(id)}`, options)
  deleteAsset: ApiClient['deleteAsset'] = async (id, options) =>
    this.request('DELETE', `/assets/${segment(id)}`, options)
  listWorkflows: ApiClient['listWorkflows'] = async (query, options) =>
    this.request('GET', `/workflows${queryString(query)}`, options)
  getWorkflow: ApiClient['getWorkflow'] = async (id, options) =>
    this.request('GET', `/workflows/${segment(id)}`, options)
  saveWorkflow: ApiClient['saveWorkflow'] = async (workflow: Workflow, options) =>
    this.request('PUT', `/workflows/${segment(workflow.id)}`, options, workflow)
  listModels: ApiClient['listModels'] = async (query, options) =>
    this.request('GET', `/models${queryString(query)}`, options)
  getModel: ApiClient['getModel'] = async (id, options) =>
    this.request('GET', `/models/${segment(id)}`, options)
  setModelEnabled: ApiClient['setModelEnabled'] = async (id, enabled, options) =>
    this.request('PATCH', `/models/${segment(id)}`, options, { enabled })
  getDashboard: ApiClient['getDashboard'] = (options) => this.request('GET', '/dashboard', options)
  getSettings: ApiClient['getSettings'] = (options) => this.request('GET', '/settings', options)
  saveSettings: ApiClient['saveSettings'] = (settings: Settings, options) =>
    this.request('PUT', '/settings', options, settings)
}

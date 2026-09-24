import type { Session } from '../types/server'

let token = ''
let epoch = 0
let refreshing: Promise<void> | undefined
let signedOut = false
export const clearToken = () => { token = ''; epoch++ }
export const setToken = (value?: string) => { signedOut = false; token = value ?? ''; epoch++ }
export const endSession = () => { signedOut = true; clearToken() }

export async function unwrap<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`)
    Object.assign(error, { status: response.status, code: payload?.error?.code })
    throw error
  }
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error('后端响应缺少 data 信封')
  }
  return payload.data as T
}

export async function refreshToken(): Promise<void> {
  if (signedOut) throw new Error('已退出登录，请重新登录')
  if (!refreshing) {
    const started = epoch
    refreshing = (async () => {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        signal: AbortSignal.timeout(15000),
      })
      const data = normalizeSession(await unwrap<Session>(response))
      if (started !== epoch) throw new Error('会话已发生变化，请重试')
      if (!data.token) throw new Error('刷新响应缺少 token')
      token = data.token
    })().catch((error: unknown) => {
      if (started === epoch) clearToken()
      throw error
    }).finally(() => { refreshing = undefined })
  }
  return refreshing
}
export async function restoreSession(): Promise<void> {
  if (signedOut) return
  const started = epoch
  const response = await fetch('/api/auth/refresh', {
    method: 'POST', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15000),
  })
  if (started !== epoch) return
  if (response.status === 401) { clearToken(); return }
  const data = normalizeSession(await unwrap<Session>(response))
  if (started !== epoch) return
  if (!data.token) throw new Error('刷新响应缺少 token')
  setToken(data.token)
}

/** 仅向同源 /api 发送 bearer，refresh cookie 不交给 JavaScript。 */
export async function sessionFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  if (!path.startsWith('/api/') || /[\\#]/.test(path)) throw new Error('只允许同源后端 API')
  const started = epoch
  const send = () => {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(path, {
      ...init, headers, credentials: 'same-origin', redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(30000),
    })
  }
  const response = await send()
  if (started !== epoch && path !== '/api/auth/logout') throw new Error('会话已发生变化，请重试')
  if (response.status !== 401 || !retry) return response
  await refreshToken()
  return send()
}

export async function serverRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await sessionFetch(`/api${path}`, {
    method, signal,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, !path.startsWith('/auth/')))
}

export function normalizeSession(value: Session | (Session['user'] & {
  role?: string | { id: string; name: string }
  permissions?: string[]
  accessToken?: string
  forceChangePassword?: boolean
})): Session {
  if ('user' in value && (value.user === null || typeof value.user === 'object')) return value as Session
  const row = value as Session['user'] & { role?: string | { id: string; name: string }; permissions?: string[]; accessToken?: string; forceChangePassword?: boolean }
  return {
    user: row ? { id: row.id, username: row.username, nickname: row.nickname, email: row.email, displayName: row.nickname || row.username, mustChangePassword: row.forceChangePassword } : null,
    role: typeof row?.role === 'object' ? row.role : row?.role ? { id: row.role, name: row.role } : null,
    permissions: row?.permissions ?? [],
    token: row?.accessToken,
  }
}

export async function assetBlob(id: string): Promise<Blob> {
  const response = await sessionFetch(`/api/assets/${encodeURIComponent(id)}/content`)
  if (!response.ok) throw new Error(`资产读取失败：HTTP ${response.status}`)
  return response.blob()
}

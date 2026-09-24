import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { isMockMode } from '../api/mode'
import { endSession, normalizeSession, restoreSession, serverRequest, sessionFetch, setToken, unwrap } from '../api/session'
import type { Session } from '../types/server'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const error = ref('')
  const ready = ref(false)
  let pending: Promise<void> | undefined
  let restored = false
  let generation = 0
  const logoutNotice = ref('')
  const mustChangePassword = computed(() => !!session.value?.user?.mustChangePassword)
  const can = (permission: string) => isMockMode || !!session.value?.permissions.includes(permission)
  async function load() {
    if (isMockMode) { ready.value = true; return }
    if (pending) return pending
    const started = generation
    pending = (async () => {
      error.value = ''
      try {
        if (!restored) { await restoreSession(); restored = true }
        const response = await sessionFetch('/api/auth/me', {}, false)
        // 实际 controller 不提供 Guest me：401 只开放 public 路由，不构造角色或权限。
        const value = response.status === 401 ? null : normalizeSession(await unwrap<Session>(response))
        if (started !== generation) return
        session.value = value
        ready.value = true
      } catch (cause) {
        if (started !== generation) return
        session.value = null
        ready.value = false
        error.value = cause instanceof Error ? cause.message : '会话加载失败'
        throw cause
      }
    })().finally(() => { pending = undefined })
    return pending
  }
  async function login(username: string, password: string) {
    if (isMockMode) throw new Error('演示模式不支持真实登录，请切换真实模式')
    logoutNotice.value = ''
    const data = normalizeSession(await serverRequest<Session>('/auth/login', 'POST', { username, password }))
    setToken(data.token)
    restored = true
    session.value = data
    ready.value = true
    await load()
  }
  async function changePassword(currentPassword: string, newPassword: string) {
    if (isMockMode) throw new Error('演示模式不修改真实密码')
    const result = await serverRequest<{ loginRequired?: boolean }>('/auth/change-password', 'POST', { oldPassword: currentPassword, newPassword })
    if (result.loginRequired) {
      generation++; endSession(); session.value = null; ready.value = true; restored = true
      return
    }
    await load()
  }
  async function logout() {
    if (isMockMode) return
    generation++
    // Start revocation with the current bearer, then discard all local authority
    // immediately. Never refresh the cookie after logout, even on server failure.
    const request = sessionFetch('/api/auth/logout', { method: 'POST' }, false)
    endSession(); session.value = null; ready.value = true; restored = true; error.value = ''
    logoutNotice.value = ''
    try { await unwrap(await request) }
    catch {
      logoutNotice.value = '本地会话已清除，但无法确认服务器退出成功；刷新凭证可能仍有效，请稍后重试退出或关闭浏览器。'
    }
  }
  async function updateProfile(body: { nickname?: string; email?: string }) {
    if (isMockMode) throw new Error('演示模式不修改真实资料')
    const started = generation
    const profile = await serverRequest<{ nickname?: string; email?: string }>('/auth/profile', 'PATCH', body)
    if (started === generation && session.value?.user) {
      Object.assign(session.value.user, profile, { displayName: profile.nickname || session.value.user.username })
    }
  }
  return { session, error, ready, logoutNotice, can, mustChangePassword, load, login, logout, changePassword, updateProfile }
})

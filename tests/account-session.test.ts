import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock('../src/api/mode') })
describe('account session boundaries', () => {
  it('demo logout/profile/password never sends a network request', async () => {
    vi.doMock('../src/api/mode', () => ({ isMockMode: true }))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    setActivePinia(createPinia())
    const { useAuthStore } = await import('../src/stores/auth')
    const auth = useAuthStore()
    await auth.logout()
    await expect(auth.updateProfile({ nickname: 'x' })).rejects.toThrow('演示模式')
    await expect(auth.changePassword('old', 'new')).rejects.toThrow('演示模式')
    expect(fetch).not.toHaveBeenCalled()
    expect(auth.session).toBeNull()
  })
  it('successful logout discards authority and does not refresh the cookie', async () => {
    vi.doMock('../src/api/mode', () => ({ isMockMode: false }))
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { loggedOut: true } })))
    vi.stubGlobal('fetch', fetch)
    setActivePinia(createPinia())
    const { useAuthStore } = await import('../src/stores/auth')
    const { setToken, refreshToken } = await import('../src/api/session')
    setToken('sensitive-test-token')
    const auth = useAuthStore()
    auth.session = { user: { id: '1', username: 'owner' }, role: null, permissions: ['users.read'] }
    await auth.logout()
    expect(auth.session).toBeNull()
    expect(auth.can('users.read')).toBe(false)
    expect(auth.logoutNotice).toBe('')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe('/api/auth/logout')
    await expect(refreshToken()).rejects.toThrow('已退出')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('late restore cannot resurrect a token after logout', async () => {
    let finish!: (response: Response) => void
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetch)
    const { restoreSession, endSession, sessionFetch } = await import('../src/api/session')
    const restoring = restoreSession()
    endSession()
    finish(new Response(JSON.stringify({ data: { accessToken: 'late-token' } })))
    await restoring
    fetch.mockResolvedValue(new Response(JSON.stringify({ data: {} })))
    await sessionFetch('/api/auth/me', {}, false)
    expect(fetch.mock.calls[1]![1].headers.get('Authorization')).toBeNull()
  })
})

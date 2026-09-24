import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, HttpApiClient } from '../src/api'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const setup = (response: Response) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
  return { client: new HttpApiClient({ fetch: fetcher }), fetcher }
}
afterEach(() => { vi.useRealTimers() })

describe('HttpApiClient', () => {
  it('编码 ID、查询串并解包 JSON', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 20 }
    const { client, fetcher } = setup(json({ data: page }))
    expect(await client.listTasks({ page: 1, search: 'a & b', status: 'FAILED' })).toEqual(page)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/tasks?page=1&search=a+%26+b&status=FAILED')
    fetcher.mockResolvedValueOnce(json({ data: { id: 'a/b ?' } }))
    await client.getTask('a/b ?')
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/tasks/a%2Fb%20%3F')
  })

  it('发送 action JSON，不自动重试或注入密钥', async () => {
    const { client, fetcher } = setup(json({ data: { id: 'v1' } }))
    await client.videoAction('v1', 'retry')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/video/tasks/v1/actions', expect.objectContaining({
      method: 'POST', body: '{"action":"retry"}', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }))
  })

  it('保留结构化 HTTP 错误', async () => {
    const { client } = setup(json({
      error: { code: 'INVALID_TRANSITION', message: '终态不可暂停', details: { status: 'SUCCESS' } },
      requestId: 'req-1',
    }, 409))
    await expect(client.action('v1', 'pause')).rejects.toMatchObject({
      name: 'ApiError', kind: 'http', status: 409, code: 'INVALID_TRANSITION',
      message: '终态不可暂停', requestId: 'req-1', details: { status: 'SUCCESS' },
    })
  })

  it('非 JSON HTTP 错误仍保留状态和请求 ID', async () => {
    const { client } = setup(new Response('<html>bad gateway</html>', {
      status: 502, headers: { 'x-request-id': 'proxy-1' },
    }))
    await expect(client.getTask('v1')).rejects.toMatchObject({
      kind: 'http', status: 502, requestId: 'proxy-1', message: 'HTTP 502',
    })
  })

  it.each(['not json', '{}', '{"data":null}', '[]'])('拒绝无效成功信封 %s', async text => {
    const { client } = setup(new Response(text))
    await expect(client.getDashboard()).rejects.toMatchObject({ kind: 'invalid-response', status: 200 })
  })

  it('契约不接受 204；布尔 false 不当作缺失 data', async () => {
    const { client } = setup(new Response(null, { status: 204 }))
    await expect(client.deleteAsset('a1')).rejects.toMatchObject({ kind: 'invalid-response' })
    expect(await setup(json({ data: false })).client.deleteAsset('a1')).toBe(false)
  })

  it('区分网络失败', async () => {
    const cause = new TypeError('Failed to fetch')
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(cause)
    await expect(new HttpApiClient({ fetch: fetcher }).listTasks()).rejects.toMatchObject({
      kind: 'network', cause,
    })
  })

  it('响应体读取失败归类 network；成功请求清理定时器和监听器', async () => {
    vi.useFakeTimers()
    const response = json({ data: {} })
    vi.spyOn(response, 'text').mockRejectedValue(new TypeError('stream interrupted'))
    await expect(setup(response).client.getDashboard()).rejects.toMatchObject({ kind: 'network' })
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await setup(json({ data: {} })).client.getDashboard({ signal: controller.signal })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('超时会中止底层请求，即使 fetch 未响应 abort 也会结束等待', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}))
    const client = new HttpApiClient({ fetch: fetcher, timeoutMs: 20 })
    const pending = expect(client.listTasks()).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(20)
    await pending
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('timeout 包含读取响应体时间', async () => {
    vi.useFakeTimers()
    const response = json({ data: {} })
    vi.spyOn(response, 'text').mockImplementation(() => new Promise(() => {}))
    const { client } = setup(response)
    const pending = expect(client.getDashboard({ timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(10)
    await pending
  })

  it('预先取消时不发送请求', async () => {
    const controller = new AbortController()
    controller.abort()
    const { client, fetcher } = setup(json({ data: {} }))
    await expect(client.getDashboard({ signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('外部取消只中止对应请求，清理监听器', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}))
    const client = new HttpApiClient({ fetch: fetcher })
    const pending = expect(client.listTasks({}, { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' })
    controller.abort()
    await pending
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('拒绝非法配置、ID 和页码', async () => {
    expect(() => new HttpApiClient({ timeoutMs: 0 })).toThrow(ApiError)
    expect(() => new HttpApiClient({ baseUrl: 'https://user:secret@example.com/api' })).toThrow(ApiError)
    const { client, fetcher } = setup(json({ data: {} }))
    await expect(client.getTask('..')).rejects.toMatchObject({ kind: 'invalid-request' })
    await expect(client.listTasks({ page: 0 })).rejects.toMatchObject({ kind: 'invalid-request' })
    await expect(client.getDashboard({ timeoutMs: Infinity })).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

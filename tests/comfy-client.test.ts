import { describe, expect, it, vi } from 'vitest'
import { ComfyHttpClient } from '../src/engine/comfy-client'

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
describe('native ComfyUI HTTP transport', () => {
  it('does not drop malformed queue entries when deciding whether interruption is safe', async () => {
    const fetcher = vi.fn(async () =>
      json({ queue_running: [[1, 'target'], { unknown: true }], queue_pending: [] }),
    )
    const client = new ComfyHttpClient('http://localhost:8188', fetcher)
    await expect(client.cancel('target')).rejects.toThrow(/队列项不合法/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects HTTP 200 responses that are not ComfyUI health or queue payloads', async () => {
    const client = new ComfyHttpClient(
      'http://localhost:8188',
      vi.fn(async () => json({})),
    )
    await expect(client.health()).rejects.toThrow(/响应无效/)
    await expect(client.queue()).rejects.toThrow(/响应无效/)
    expect(() => new ComfyHttpClient('http://localhost:8188', fetch, 0)).toThrow()
  })
  it('reports only returned GPU/VRAM data and explicitly unavailable WS/model probes', async () => {
    const client = new ComfyHttpClient(
      'http://localhost:8188',
      vi.fn(async (input) => {
        const url = String(input)
        if (url.endsWith('/system_stats'))
          return json({
            system: { comfyui_version: '0.3.0' },
            devices: [{ name: 'Test GPU', vram_total: 1000, vram_free: 600 }],
          })
        if (url.endsWith('/queue')) return json({ queue_running: [[1, 'prompt-a']], queue_pending: [] })
        return json({ TestNode: {} })
      }),
    )
    const health = await client.health()
    expect(health).toMatchObject({
      connected: true,
      gpu: 'Test GPU',
      vramUsed: 400,
      running: 1,
      websocket: 'unavailable',
      model: 'unavailable',
    })
  })
  it('submits semantic inputs and retains promptId, then extracts encoded output URLs', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/prompt')) {
        expect(JSON.parse(String(init?.body)).prompt.anyId.inputs.text).toBe('story')
        return json({ prompt_id: 'p 1' })
      }
      return json({
        'p 1': {
          status: { completed: true },
          outputs: { out: { videos: [{ filename: 'a b.mp4', subfolder: '', type: 'output' }] } },
        },
      })
    })
    const client = new ComfyHttpClient('http://localhost:8188', fetcher)
    const id = await client.submit(
      { anyId: { class_type: 'TestNode', inputs: { text: '' } } },
      { prompt: 'anyId.text' },
      { prompt: 'story' },
    )
    expect(id).toBe('p 1')
    const result = await client.status(id)
    expect(result.status).toBe('SUCCESS')
    expect(result.outputs[0]?.url).toContain('filename=a+b.mp4')
  })
  it('does not interrupt other running prompts; deletes only queued prompt', async () => {
    const fetcher = vi.fn(async () =>
      json({
        queue_running: [
          [1, 'a'],
          [2, 'b'],
        ],
        queue_pending: [[3, 'c']],
      }),
    )
    const client = new ComfyHttpClient('http://localhost:8188', fetcher)
    await expect(client.cancel('a')).rejects.toMatchObject({ code: 'UNSAFE_CANCEL' })
    await client.cancel('c')
    expect(fetcher).toHaveBeenLastCalledWith(
      'http://localhost:8188/queue',
      expect.objectContaining({ body: '{"delete":["c"]}' }),
    )
  })
  it('settles timeouts even when fetch ignores abort', async () => {
    vi.useFakeTimers()
    try {
      const client = new ComfyHttpClient('http://localhost:8188', () => new Promise(() => undefined), 10)
      const assertion = expect(client.queue()).rejects.toMatchObject({ code: 'TIMEOUT' })
      await vi.advanceTimersByTimeAsync(11)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})

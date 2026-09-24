import { describe, expect, it, vi } from 'vitest'
import { EngineHttpApiClient } from '../src/api/engine'

describe('Engine HTTP contract', () => {
  it('encodes identifiers and keeps mutation endpoints explicit', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [] })))
    const client = new EngineHttpApiClient({ fetch: fetcher })
    await client.executions('task/a')
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/tasks/task%2Fa/executions',
      expect.objectContaining({ method: 'GET' }),
    )
    await client.cancelExecution('exec/a')
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/engines/comfyui/executions/exec%2Fa/cancel',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('rejects relative path segments before making requests', () => {
    const fetcher = vi.fn()
    const client = new EngineHttpApiClient({ fetch: fetcher })
    expect(() => client.execution('..')).toThrow()
    expect(() => client.traces('')).toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

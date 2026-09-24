import { describe, expect, it, vi } from 'vitest'
import { createMockApi, STORAGE_KEY } from '../../src/services/mock'
import { createSeed, createTask } from '../../src/services/seed'
import { WorkflowVersionRegistry } from '../../src/workflow/versions'
import { ComfyUIEngine } from '../../src/services/comfyui-engine'
import type { Database } from '../../src/types'

const graph = { node: { class_type: 'Test', inputs: { text: '', seed: 0 } } }
const json = (body: unknown) => new Response(JSON.stringify(body))
function setup() {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
  const db = createSeed()
  const model = db.models.find((m) => m.provider === 'ComfyUI')!
  model.enabled = model.connected = true
  const workflow = { ...db.workflows[0]!, id: 'real', provider: 'ComfyUI' }
  db.workflows.push(workflow)
  const task = createTask({
    title: 'test',
    theme: 'test',
    type: '短剧',
    ratio: '1:1',
    duration: 10,
    platform: '本地',
    style: 'test',
    characters: '',
    modelId: 'minimax-h3',
    workflowId: 'minimax-video-v1',
    scenario: 'normal',
  })
  task.status = 'WAITING'
  task.stageIndex = 4
  db.tasks.push(task)
  const stage = db.pipelines![0]!.stages[4]!
  Object.assign(stage, { id: 'image-stage', provider: 'ComfyUI', modelId: model.id, workflowId: workflow.id })
  storage.setItem(STORAGE_KEY, JSON.stringify(db))
  const versions = new WorkflowVersionRegistry(storage)
  const revision = versions.import(workflow, {
    version: '1.0.0',
    apiWorkflow: graph,
    uiWorkflow: null,
    mapping: { prompt: 'node.text', seed: 'node.seed' },
    note: '',
  })
  versions.activate(workflow.id, revision.id)
  const api = createMockApi({ storage })
  api.createComfyInstance({
    id: 'local',
    name: 'local',
    baseUrl: 'http://localhost:8188',
    enabled: true,
    connected: true,
  })
  const input = {
    instanceId: 'local',
    workflowId: workflow.id,
    taskId: task.id,
    stageId: 'image-stage',
    inputs: { prompt: 'test', seed: 42 },
  }
  return { api, storage, versions, revision, workflow, input }
}

describe('Engine 持久化桥接', () => {
  it('提交即持久化 promptId，history 失败仍保留；异步写入不覆盖其他事务', async () => {
    const { api, storage, input } = setup()
    await api.probeComfyHealth('local', async () => json({ system: {}, devices: [] }))
    const job = api.enqueueComfy(input)
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ prompt_id: 'remote-id' }))
      .mockImplementationOnce(async () => {
        const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!) as Database
        expect(persisted.comfyExecutions?.[0]).toMatchObject({
          status: 'RUNNING',
          promptId: 'remote-id',
          workflowVersion: '1.0.0',
        })
        api.saveSettings({ ...api.getDb().settings, threshold: 88 })
        throw new Error('history broken')
      })
    const result = await api.runComfy(job.id, { fetch: fetcher })
    expect(result).toMatchObject({
      status: 'FAILED',
      promptId: 'remote-id',
      error: { message: 'history broken' },
    })
    const restored = createMockApi({ storage }).getDb()
    expect(restored.comfyExecutions?.[0]?.promptId).toBe('remote-id')
    expect(restored.settings.threshold).toBe(88)
  })
  it('明确拒绝非当前 stage、active snapshot 切换、UI-only 和空 Mapping', async () => {
    const { api, input, versions, workflow } = setup()
    await api.probeComfyHealth('local', async () => json({ system: {}, devices: [] }))
    expect(() => api.enqueueComfy({ ...input, stageId: 'IMAGE' })).toThrow('stageId')
    const job = api.enqueueComfy(input)
    const revision = versions.import(workflow, {
      version: '2.0.0',
      apiWorkflow: graph,
      uiWorkflow: null,
      mapping: { prompt: 'node.text' },
      note: '',
    })
    versions.activate(workflow.id, revision.id)
    await expect(api.runComfy(job.id, { fetch: vi.fn<typeof fetch>() })).rejects.toThrow('snapshot 已变化')
    const engine = new ComfyUIEngine()
    expect(() => engine.configure('i', 'w', { workflow: graph, mapping: {} })).toThrow('Mapping')
    expect(() =>
      engine.configure('i', 'w', { workflow: { nodes: [] }, mapping: { prompt: 'node.text' } }),
    ).toThrow('UI JSON')
    versions.activate(workflow.id, null)
    expect(() => engine.configureActive('i', workflow.id, versions)).toThrow('active API')
  })
  it.each([{}, { system: {} }, { system: {}, devices: [{}] }, { system: [], devices: [] }])(
    'HTTP 200 无效 body 不健康：%j',
    async (body) => {
      const { api } = setup()
      expect(await api.probeComfyHealth('local', async () => json(body))).toMatchObject({
        status: 'unhealthy',
        simulated: false,
      })
    },
  )
  it('health body 永不返回也受 deadline 约束', async () => {
    vi.useFakeTimers()
    try {
      const { api } = setup()
      const pending = api.probeComfyHealth(
        'local',
        async () => new Response(new ReadableStream<Uint8Array>()),
        10,
      )
      await vi.advanceTimersByTimeAsync(11)
      expect(await pending).toMatchObject({ status: 'unhealthy', message: '健康探测 timeout' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('取消后保留 promptId，不被 late completion 复活', async () => {
    const { api, input } = setup()
    await api.probeComfyHealth('local', async () => json({ system: {}, devices: [] }))
    const job = api.enqueueComfy(input)
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ prompt_id: 'cancel-id' }))
      .mockImplementationOnce(async () => {
        api.cancelComfy(job.id)
        return json({
          'cancel-id': {
            status: { completed: true },
            outputs: { node: { images: [{ filename: 'late.png' }] } },
          },
        })
      })
    expect(await api.runComfy(job.id, { fetch: fetcher })).toMatchObject({
      status: 'CANCELLED',
      promptId: 'cancel-id',
    })
    expect(api.comfyQueue()).toEqual([])
  })
})

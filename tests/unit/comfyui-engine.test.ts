import { describe, expect, it, vi } from 'vitest'
import { ComfyUIEngine } from '../../src/services/comfyui-engine'
import { createSeed, createTask } from '../../src/services/seed'
import { ComfyUIAdapter } from '../../src/providers/comfyui'
import { Orchestrator } from '../../src/orchestrator/engine'

const graph = { node: { class_type: 'Test', inputs: { text: '' } } }
const json = (data: unknown) => new Response(JSON.stringify(data))
function setup() {
  const db = createSeed()
  const engine = new ComfyUIEngine()
  engine.createInstance(db, {
    id: 'local',
    name: 'local',
    baseUrl: 'http://localhost:8188',
    enabled: true,
    connected: true,
  })
  return { db, engine }
}
describe('ComfyUI Engine', () => {
  it('instance CRUD、默认 health mock probe 无网络，未连接拒绝入队', () => {
    const { db, engine } = setup()
    expect(engine.health(db, 'local').status).toBe('unhealthy')
    expect(() => engine.enqueue(db, 'local', 'wf', {})).toThrow('未健康')
    expect(engine.health(db, 'local', true)).toMatchObject({ status: 'healthy', simulated: true })
    const instance = engine.listInstances(db)[0]!
    engine.updateInstance(db, { ...instance, connected: false })
    expect(engine.health(db, 'local', true).status).toBe('unhealthy')
    engine.deleteInstance(db, 'local')
    expect(engine.listInstances(db)).toEqual([])
  })
  it('模拟健康允许本地队列检查，但不能授权真实执行；取消持久化', async () => {
    const { db, engine } = setup()
    const fetcher = vi.fn<typeof fetch>()
    engine.configure('local', 'wf', { workflow: graph, mapping: { prompt: 'node.text' }, fetch: fetcher })
    engine.health(db, 'local', true)
    const job = engine.enqueue(db, 'local', 'wf', { prompt: 'hello' })
    expect(engine.queue(db)).toMatchObject([{ executionId: job.id, status: 'QUEUED', position: 0 }])
    await expect(engine.run(db, job.id)).rejects.toThrow('真实健康')
    expect(fetcher).not.toHaveBeenCalled()
    expect(() => engine.deleteInstance(db, 'local')).toThrow('队列')
    engine.cancel(db, job.id)
    expect(engine.queue(db)).toEqual([])
    expect(engine.executions(db)[0]?.status).toBe('CANCELLED')
  })
  it('显式配置与真实探测通过后复用 Adapter，保留 promptId 和媒体文件', async () => {
    const { db, engine } = setup()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ system: {}, devices: [] }))
      .mockResolvedValueOnce(json({ prompt_id: 'p' }))
      .mockResolvedValueOnce(
        json({
          p: { status: { completed: true }, outputs: { node: { images: [{ filename: 'out.png' }] } } },
        }),
      )
    engine.configure('local', 'wf', { workflow: graph, mapping: { prompt: 'node.text' }, fetch: fetcher })
    await engine.probe(db, 'local', fetcher)
    const job = engine.enqueue(db, 'local', 'wf', { prompt: 'hello' }, 'task', 'IMAGE')
    const result = await engine.run(db, job.id)
    expect(result).toMatchObject({ status: 'SUCCESS', promptId: 'p', taskId: 'task', stageId: 'IMAGE' })
    expect(result.files[0]?.filename).toBe('out.png')
    expect(engine.queue(db)).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('取消正在运行且忽略 AbortSignal 的 fetch，不能被迟到结果写回成功', async () => {
    const { db, engine } = setup()
    await engine.probe(db, 'local', async () => json({ system: {}, devices: [] }))
    engine.configure('local', 'wf', {
      workflow: graph,
      mapping: { prompt: 'node.text' },
      fetch: () => new Promise<Response>(() => {}),
    })
    const job = engine.enqueue(db, 'local', 'wf', {})
    const pending = engine.run(db, job.id)
    engine.cancel(db, job.id)
    expect((await pending).status).toBe('CANCELLED')
    expect(engine.executions(db)[0]?.status).toBe('CANCELLED')
  })
  it('同一 Pipeline 中仅 IMAGE 绑定 ComfyUI，消费真实产物并保留 ComfyUI trace', async () => {
    const { db, engine } = setup()
    db.settings.stageDuration = 1
    const model = db.models.find((m) => m.provider === 'ComfyUI')!
    model.enabled = model.connected = true
    db.workflows.push({
      ...db.workflows[0]!,
      id: 'image-real',
      provider: 'ComfyUI',
      type: 'Text to Image',
      version: '1.2.0',
    })
    const definition = db.pipelines?.find((p) => p.kind === 'video')?.stages.find((s) => s.key === 'IMAGE')
    if (!definition) throw new Error('缺少 IMAGE')
    Object.assign(definition, { provider: 'ComfyUI', modelId: model.id, workflowId: 'image-real' })
    const task = createTask({
      title: 'mixed',
      theme: 'mixed',
      type: '短剧',
      ratio: '1:1',
      duration: 10,
      platform: '本地',
      style: '写实',
      characters: '',
      modelId: 'minimax-h3',
      workflowId: 'minimax-video-v1',
      scenario: 'normal',
    })
    db.tasks.push(task)
    const orchestrator = new Orchestrator()
    const time = Date.parse(task.createdAt)
    for (let i = 0; i <= 4; i++) orchestrator.tick(db, time + i)
    expect(task.stages[task.stageIndex]?.key).toBe('IMAGE')
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ system: {}, devices: [] }))
      .mockResolvedValueOnce(json({ prompt_id: 'real-image' }))
      .mockResolvedValueOnce(
        json({
          'real-image': {
            status: { completed: true },
            outputs: { node: { images: [{ filename: 'image.png' }] } },
          },
        }),
      )
    await engine.probe(db, 'local', fetcher)
    engine.configure('local', 'image-real', {
      workflow: graph,
      mapping: { prompt: 'node.text' },
      fetch: fetcher,
    })
    const job = engine.enqueue(db, 'local', 'image-real', {}, task.id, 'IMAGE')
    await engine.run(db, job.id)
    orchestrator.tick(db, time + 5)
    expect(task.stageIndex).toBe(5)
    expect(db.executions?.find((e) => e.stageId === 'IMAGE')).toMatchObject({
      provider: 'ComfyUI',
      status: 'SUCCESS',
      workflowVersion: '1.2.0',
    })
    expect(db.assets[0]).toMatchObject({
      provider: 'ComfyUI',
      stageId: 'IMAGE',
      executionId: db.executions?.find((e) => e.stageId === 'IMAGE')?.id,
    })
    expect(task.stages[4]?.output).toContain('real-image')
    expect(task.stages[4]?.output).not.toContain('Mock')
  })
})
describe('Adapter bounded Promise.race', () => {
  it('不响应 signal 的操作仍在 deadline 返回，清理 timer', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new ComfyUIAdapter({
        baseUrl: 'http://localhost:8188',
        workflow: graph,
        mapping: {},
        timeout: 10,
        fetch: () => new Promise<Response>(() => {}),
      })
      const assertion = expect(adapter.generate({})).rejects.toThrow('timeout')
      await vi.advanceTimersByTimeAsync(11)
      await assertion
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('view 响应体永不返回仍可 abort', async () => {
    const adapter = new ComfyUIAdapter({
      baseUrl: 'http://localhost:8188',
      workflow: graph,
      mapping: {},
      fetch: async () => new Response(new ReadableStream<Uint8Array>({ start() {} })),
    })
    const controller = new AbortController()
    const assertion = expect(
      adapter.view({ filename: 'x', subfolder: '', type: 'output' }, controller.signal),
    ).rejects.toThrow()
    controller.abort()
    await assertion
  })
})

import { describe, expect, it } from 'vitest'
import { Orchestrator } from '../../src/orchestrator/engine'
import { ProviderRegistry } from '../../src/orchestrator/registry'
import { QualityGate } from '../../src/orchestrator/quality'
import { pipelineDefinitions } from '../../src/orchestrator/definitions'
import { createSeed, createTask, createStages } from '../../src/services/seed'
import { createMockApi, STORAGE_KEY } from '../../src/services/mock'
import { assertDatabase, assertRequest } from '../../src/services/validation'
import type { VideoRequest } from '../../src/types'

const request: VideoRequest = {
  title: '测试',
  theme: '主题',
  type: '短剧',
  ratio: '9:16',
  duration: 30,
  platform: '本地',
  style: '写实',
  characters: '',
  modelId: 'minimax-h3',
  workflowId: 'minimax-video-v1',
  scenario: 'normal',
}
function setup(scenario: VideoRequest['scenario'] = 'normal') {
  const db = createSeed()
  db.settings.stageDuration = 1
  const task = createTask({ ...request, scenario })
  db.tasks.push(task)
  return { db, task, engine: new Orchestrator(), time: Date.parse(task.createdAt) }
}

describe('ProviderRegistry', () => {
  it('显式注册、能力解析、无隐式 Mock fallback，list 不暴露可变内部数组', () => {
    const registry = new ProviderRegistry()
    registry.register({ provider: 'Mock', workflowKinds: ['text'], execute: () => 'text' })
    expect(registry.resolve('Mock', 'text').provider).toBe('Mock')
    expect(() => registry.resolve('ComfyUI', 'video')).toThrow('不支持')
    expect(() => registry.resolve('Mock', 'video')).toThrow('不支持')
    expect(() =>
      registry.register({ provider: 'Mock', workflowKinds: ['video'], execute: () => '' }),
    ).toThrow('已注册')
    registry.list()[0]!.workflowKinds.push('video')
    expect(() => registry.resolve('Mock', 'video')).toThrow()
  })
})
describe('QualityGate', () => {
  it('按 stage 覆盖默认门限，边界相等通过且拒绝非有限评分', () => {
    const db = createSeed()
    db.qualityConfigs = [{ stageId: 'SCRIPT', threshold: 75, criteria: ['结构'] }]
    const gate = new QualityGate()
    expect(gate.evaluate(db, 'SCRIPT', 75, 'video')).toMatchObject({ passed: true, threshold: 75 })
    expect(gate.evaluate(db, 'QA', 75, 'video').passed).toBe(false)
    expect(gate.evaluate(db, 'SCRIPT', 74, 'video').criteria[0]?.name).toBe('Mock 结构')
    expect(() => gate.evaluate(db, 'QA', NaN, 'video')).toThrow()
  })
})
describe('Orchestrator', () => {
  it('submit 校验后入队，重复提交拒绝且不增加任务', () => {
    const db = createSeed()
    const engine = new Orchestrator()
    const task = createTask(request)
    expect(engine.submit(db, task)).toBe(task)
    expect(db.tasks).toHaveLength(1)
    expect(() => engine.submit(db, task)).toThrow('已提交')
    expect(db.tasks).toHaveLength(1)
  })
  it('每次真实推进只生成一份 execution/trace，保存本轮输出并连接资产来源', () => {
    const { db, task, engine, time } = setup()
    engine.tick(db, time)
    expect(engine.tick(db, time)).toBe(false)
    expect(db.executions).toBeUndefined()
    engine.tick(db, time + 1)
    expect(db.executions).toHaveLength(1)
    expect(db.executions?.[0]).toMatchObject({
      stageId: 'SCRIPT',
      provider: 'Mock',
      status: 'SUCCESS',
      attempt: 1,
      output: task.script,
    })
    expect(db.executions?.[0]).toMatchObject({
      modelId: 'qwen-max',
      workflowId: 'article-text',
      stageKey: 'SCRIPT',
      stageIndex: 0,
      seed: 842103,
      quality: null,
    })
    expect(JSON.parse(db.executions?.[0]?.prompt ?? '{}')).toEqual(request)
    expect(db.traces?.[0]?.id).toBe(db.executions?.[0]?.traceId)
    expect(db.executions?.[0]?.logs).toHaveLength(2)
    for (let i = 2; i <= 10; i++) engine.tick(db, time + i)
    engine.action(db, task, 'approve', time + 11)
    expect(db.executions).toHaveLength(11)
    expect(db.assets[0]).toMatchObject({
      provider: 'Mock',
      stageId: 'SCRIPT',
      executionId: db.executions?.[0]?.id,
    })
    assertDatabase(db)
  })
  it('质量自动重试保留失败证据和 attempt，不将 QUEUED 误记成功', () => {
    const { db, task, engine, time } = setup('quality')
    for (let i = 0; i < 12; i++) engine.tick(db, time + i)
    const failure = db.executions?.find((e) => e.stageId === 'QA')
    expect(failure).toMatchObject({ status: 'FAILED', error: { type: 'quality' } })
    expect(failure?.quality).toMatchObject({ passed: false, score: 65, threshold: 90 })
    db.settings.threshold = 0
    expect(failure?.quality?.threshold).toBe(90)
    expect(task.retries).toBe(1)
    engine.tick(db, time + 12)
    expect(db.executions?.filter((e) => e.stageId === 'SCRIPT').map((e) => e.attempt)).toEqual([1, 2])
  })
  it('按 stage 的 QualityGate 真正阻止后续执行', () => {
    const { db, task, engine, time } = setup()
    db.qualityConfigs = [{ stageId: 'SCRIPT', threshold: 100 }]
    db.settings.autoRetry = false
    engine.tick(db, time)
    engine.tick(db, time + 1)
    expect(task.status).toBe('FAILED')
    expect(db.executions?.[0]?.error?.type).toBe('quality')
  })
  it('timeout 仅到 deadline 创建失败 trace，wait 恢复当前阶段并增加 attempt', () => {
    const { db, task, engine, time } = setup('timeout')
    engine.tick(db, time)
    engine.tick(db, time + 1)
    engine.tick(db, time + 2)
    expect(db.executions).toHaveLength(1)
    engine.tick(db, time + 4)
    expect(db.executions?.[1]).toMatchObject({
      stageId: 'CHARACTER',
      status: 'FAILED',
      error: { type: 'timeout', code: 'PROVIDER_TIMEOUT' },
    })
    engine.action(db, task, 'wait', time + 5)
    engine.tick(db, time + 6)
    engine.tick(db, time + 7)
    expect(db.executions?.[2]).toMatchObject({ stageId: 'CHARACTER', status: 'SUCCESS', attempt: 2 })
  })
  it('单任务抛异常隔离，后续任务继续推进，系统错误保持结构化', () => {
    const { db, task, engine, time } = setup()
    const broken = createTask({ ...request, modelId: 'qwen-max', workflowId: 'article-text' }, 'article')
    const system = createTask({ ...request, scenario: 'system' })
    db.tasks.unshift(broken, system)
    engine.tick(db, time)
    engine.tick(db, time + 1)
    engine.tick(db, time + 2)
    expect(broken.status).toBe('FAILED')
    expect(system.status).toBe('FAILED')
    expect(task.status).toBe('RUNNING')
    expect(task.stageIndex).toBe(2)
    expect(db.executions?.find((e) => e.taskId === broken.id)?.error?.message).toContain('缺少文章')
    expect(db.executions?.find((e) => e.taskId === system.id && e.status === 'FAILED')?.error?.type).toBe(
      'system',
    )
  })
  it('未连接 ComfyUI 即使手动 enabled 也拒绝，已连接但未配置也不能 Mock 成功', () => {
    const { db, task, engine, time } = setup()
    const model = db.models.find((m) => m.provider === 'ComfyUI')!
    expect(model.enabled).toBe(false)
    model.enabled = true
    task.modelId = model.id
    expect(() => engine.submit(db, task)).toThrow('未连接')
    engine.tick(db, time)
    expect(task.status).toBe('FAILED')
    expect(db.executions?.[0]).toMatchObject({ provider: 'ComfyUI', status: 'FAILED' })
    model.connected = true
    db.workflows[0]!.provider = 'ComfyUI'
    task.status = 'QUEUED'
    engine.tick(db, time + 1)
    engine.tick(db, time + 2)
    expect(task.status).toBe('FAILED')
    expect(task.script).toBe('')
    expect(db.executions?.every((e) => e.status === 'FAILED')).toBe(true)
  })
  it('stage keys 与旧工作流完全兼容，拒绝视频使用文章工作流', () => {
    const db = createSeed()
    for (const definition of pipelineDefinitions())
      expect(definition.stages.map((s) => s.key)).toEqual(createStages(definition.kind).map((s) => s.key))
    expect(() => assertRequest(db, { ...request, workflowId: 'article-text' })).toThrow('Video')
    expect(() => assertRequest(db, request)).not.toThrow()
  })
})

describe('持久化升级与多标签页', () => {
  it('旧 v2 optional 字段可缺省，事务写 v3；交错实例写入保留双方任务', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
    }
    const seed = createSeed()
    seed.version = 2
    delete seed.pipelines
    delete seed.qualityConfigs
    delete seed.providerRegistry
    storage.setItem(STORAGE_KEY, JSON.stringify(seed))
    const a = createMockApi({ storage }),
      b = createMockApi({ storage })
    a.getDb()
    b.getDb()
    const first = a.createVideo(request)
    const second = b.createVideo(request)
    a.action(first.id, 'pause')
    const restored = b.refresh()
    expect(restored.version).toBe(3)
    expect(restored.tasks.map((t) => t.id)).toContain(second.id)
    expect(restored.tasks).toHaveLength(2)
    expect(restored.tasks.find((t) => t.id === first.id)?.status).toBe('WAITING')
  })
  it('新增结构损坏被拒绝，不能绕过原本递归校验', () => {
    const db = createSeed()
    expect(() => assertDatabase({ ...db, executions: [{ id: 'invalid' }] })).toThrow('结构损坏')
    expect(() => assertDatabase({ ...db, qualityConfigs: [{ stageId: 'QA', threshold: 101 }] })).toThrow(
      '结构损坏',
    )
  })
})

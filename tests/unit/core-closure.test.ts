import { describe, expect, it } from 'vitest'
import { createSeed, createTask } from '../../src/services/seed'
import { createMockApi } from '../../src/services/mock'
import { Orchestrator } from '../../src/orchestrator/engine'
import { selectStage } from '../../src/orchestrator/selection'
import type { VideoRequest } from '../../src/types'

const request: VideoRequest = { title: '收口', theme: '能力路由', type: '短剧', ratio: '1:1', duration: 10, platform: '本地', style: '写实', characters: '', modelId: 'minimax-h3', workflowId: 'minimax-video-v1', scenario: 'normal' }

describe('核心收口回归', () => {
  it('未绑定的 Mock 阶段按实际能力路由，主配置仅用于匹配阶段', () => {
    const db = createSeed()
    const task = createTask(request)
    db.tasks.push(task)
    db.settings.stageDuration = 1
    const engine = new Orchestrator()
    const time = Date.parse(task.createdAt)
    for (let i = 0; i <= 10; i++) engine.tick(db, time + i)
    expect(task.status).toBe('REVIEWING')
    const expected: Record<string, string> = { SCRIPT: 'LLM', CHARACTER: 'LLM', IMAGE: 'Image', VIDEO: 'Video', COMPOSE: 'Video', AUDIO: 'Audio', QA: 'Vision' }
    for (const [key, capability] of Object.entries(expected)) {
      const execution = db.executions?.find(e => e.stageKey === key)
      expect(db.models.find(m => m.id === execution?.modelId)?.capability).toBe(capability)
      expect(task.stages.find(s => s.key === key)?.model).toBe(execution?.modelId)
      expect(db.workflows.some(w => w.id === execution?.workflowId && w.active)).toBe(true)
    }
    expect(db.executions?.find(e => e.stageKey === 'VIDEO')?.modelId).toBe(request.modelId)
    expect(db.executions?.find(e => e.stageKey === 'QA')?.workflowId).toBe('mock-vision')
  })

  it('显式配置优先，禁用或能力不匹配拒绝，不编造模型', () => {
    const db = createSeed()
    const task = createTask(request)
    const stage = db.pipelines![0]!.stages[0]!
    db.models.push({ ...db.models[1]!, id: 'explicit-llm' })
    db.workflows.push({ ...db.workflows.find(w => w.id === 'article-text')!, id: 'explicit-text' })
    stage.modelId = 'explicit-llm'; stage.workflowId = 'explicit-text'
    expect(selectStage(db, task, stage)).toMatchObject({ modelId: 'explicit-llm', workflowId: 'explicit-text' })
    stage.modelId = request.modelId
    expect(() => selectStage(db, task, stage)).toThrow('能力不匹配')
    delete stage.modelId; delete stage.workflowId
    db.models.filter(m => m.capability === 'LLM').forEach(m => { m.enabled = false })
    expect(() => selectStage(db, task, stage)).toThrow('缺少已注册')
  })

  it('Quality repair 修改实际执行 Prompt，保留 before/after/attempt，超限提示人工处理', () => {
    const db = createSeed()
    db.settings.stageDuration = 1
    const task = createTask({ ...request, scenario: 'quality' })
    db.tasks.push(task)
    const engine = new Orchestrator()
    const time = Date.parse(task.createdAt)
    for (let i = 0; i < 40; i++) engine.tick(db, time + i)
    expect(task.status).toBe('FAILED')
    expect(task.qualityRepairs).toHaveLength(2)
    expect(task.qualityRepairs?.map(r => r.attempt)).toEqual([2, 3])
    expect(task.qualityRepairs?.every(r => r.before !== r.after)).toBe(true)
    const attempts = db.executions?.filter(e => e.stageKey === 'VIDEO') ?? []
    expect(attempts.map(e => e.attempt)).toEqual([1, 2, 3])
    expect(new Set(attempts.map(e => e.prompt)).size).toBe(3)
    expect(attempts[1]?.prompt).toBe(task.qualityRepairs?.[0]?.after)
    expect(attempts[1]?.output).toContain('已应用修复 Prompt')
    expect(task.error).toContain('人工修改 Prompt')
    expect(task.quality?.suggestions.join('')).toContain('人工')
    expect(task.quality?.score).toBe(85)
    expect(task.request).toEqual({ ...request, scenario: 'quality' })
  })

  it('热点分析独立 trace，重复调用记录 attempt 而不重复添加分析项；不污染文章队列', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const api = createMockApi({ storage })
    api.analyzeTopic('topic-1'); api.analyzeTopic('topic-1')
    const db = api.getDb()
    expect(db.tasks).toEqual([])
    expect(db.executions?.map(e => e.attempt)).toEqual([1, 2])
    expect(db.executions?.every(e => e.provider === 'Mock' && e.stageKey === 'HOT_TOPIC_ANALYSIS' && e.status === 'SUCCESS')).toBe(true)
    expect(db.traces).toHaveLength(2)
    expect(db.topics[0]?.analysis).toHaveLength(2)
    expect(api.createArticle('topic-1').taskId).toBe(api.getDb().tasks[0]?.id)
  })

  it('saveQualityConfigs 持久化且原子拒绝非法门限、未知阶段及重复配置', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const api = createMockApi({ storage })
    const configs = [{ stageId: 'QA', threshold: 95, criteria: ['一致性'], enabled: true }]
    api.saveQualityConfigs(configs)
    configs[0]!.threshold = 0
    expect(createMockApi({ storage }).getDb().qualityConfigs?.[0]?.threshold).toBe(95)
    expect(() => api.saveQualityConfigs([{ stageId: 'QA', threshold: 101 }])).toThrow()
    expect(() => api.saveQualityConfigs([{ stageId: 'MISSING', threshold: 90 }])).toThrow()
    expect(() => api.saveQualityConfigs([{ stageId: 'QA', threshold: 90 }, { stageId: 'QA', threshold: 80 }])).toThrow()
    expect(api.getDb().qualityConfigs?.[0]?.threshold).toBe(95)
  })
})

import { describe, expect, it } from 'vitest'
import { createSeed, createTask } from '../../src/services/seed'
import { Orchestrator } from '../../src/orchestrator/engine'
import { selectStage } from '../../src/orchestrator/selection'
import { createMockApi } from '../../src/services/mock'
import type { VideoRequest } from '../../src/types'

const request: VideoRequest = {
  title: '回归',
  theme: '回归',
  type: '短剧',
  ratio: '1:1',
  duration: 30,
  platform: '本地',
  style: '写实',
  characters: '',
  modelId: 'minimax-h3',
  workflowId: 'minimax-video-v1',
  scenario: 'normal',
}

describe('核心收口', () => {
  it('按阶段能力选取真实注册的 Mock 模型/工作流，主视频配置只供匹配阶段使用', () => {
    const db = createSeed()
    db.settings.stageDuration = 1
    const task = createTask(request)
    const engine = new Orchestrator()
    engine.submit(db, task)
    const time = Date.parse(task.createdAt)
    for (let i = 0; i <= 10; i++) engine.tick(db, time + i)
    expect(task.status).toBe('REVIEWING')
    for (const [stageId, modelId, workflowId] of [
      ['SCRIPT', 'qwen-max', 'article-text'],
      ['IMAGE', 'flux-pro', 'storyboard-v2'],
      ['VIDEO', 'minimax-h3', 'minimax-video-v1'],
      ['AUDIO', 'whisper-large', 'mock-audio'],
      ['QA', 'mock-vision', 'mock-vision'],
    ])
      expect(db.executions?.find((e) => e.stageId === stageId)).toMatchObject({
        modelId,
        workflowId,
        provider: 'Mock',
      })
  })
  it('显式配置优先，错误显式能力和缺少已注册模型均拒绝而不虚构', () => {
    const db = createSeed()
    db.models.push({ ...db.models[1]!, id: 'custom-text' })
    db.workflows.push({ ...db.workflows[2]!, id: 'custom-workflow' })
    const stage = db.pipelines![0]!.stages[0]!
    expect(
      selectStage(db, request, { ...stage, modelId: 'custom-text', workflowId: 'custom-workflow' }),
    ).toMatchObject({ modelId: 'custom-text', workflowId: 'custom-workflow' })
    expect(() => selectStage(db, request, { ...stage, modelId: request.modelId })).toThrow('能力不匹配')
    db.models = db.models.filter((m) => m.capability !== 'Vision')
    expect(() => selectStage(db, request, db.pipelines![0]!.stages[9]!)).toThrow('缺少已注册')
  })
  it('质量 repair 修改实际使用 Prompt，记录前后快照和 attempt；超限提示人工处理', () => {
    const db = createSeed()
    db.settings.stageDuration = 1
    const task = createTask({ ...request, scenario: 'quality' })
    const engine = new Orchestrator()
    engine.submit(db, task)
    const time = Date.parse(task.createdAt)
    for (let i = 0; i < 40; i++) engine.tick(db, time + i)
    expect(task.status).toBe('FAILED')
    expect(task.qualityRepairs).toHaveLength(2)
    expect(task.qualityRepairs?.map((r) => r.attempt)).toEqual([2, 3])
    expect(task.qualityRepairs?.every((r) => r.before !== r.after)).toBe(true)
    const scripts = db.executions!.filter((e) => e.stageKey === 'SCRIPT')
    expect(scripts.map((e) => e.attempt)).toEqual([1, 2, 3])
    expect(scripts[1]?.prompt).toBe(task.qualityRepairs?.[0]?.after)
    expect(scripts[2]?.prompt).toBe(task.qualityRepairs?.[1]?.after)
    expect(task.quality?.score).toBe(85)
    expect(task.error).toContain('人工修改 Prompt')
    expect(task.request).toEqual({ ...request, scenario: 'quality' })
  })
  it('热点同步分析独立留痕，重复调用不重复内容且不创建文章任务', () => {
    const db = createSeed()
    const engine = new Orchestrator()
    engine.analyzeTopic(db, 'topic-1', Date.now())
    engine.analyzeTopic(db, 'topic-1', Date.now())
    expect(db.tasks).toEqual([])
    expect(db.articles).toEqual([])
    expect(db.topics[0]?.analysis).toHaveLength(2)
    expect(db.executions).toHaveLength(2)
    expect(db.executions?.map((e) => e.attempt)).toEqual([1, 2])
    expect(db.executions?.[0]).toMatchObject({
      stageId: 'HOT_TOPIC_ANALYSIS',
      provider: 'Mock',
      modelId: 'qwen-max',
      status: 'SUCCESS',
    })
    expect(db.traces?.[0]?.executionId).toBe(db.executions?.[0]?.id)
  })
  it('saveQualityConfigs 持久化且原子拒绝重复/越界/不存在阶段，createArticle 保持兼容', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
    }
    const api = createMockApi({ storage })
    const configs = [{ stageId: 'QA', threshold: 80, criteria: ['一致性'] }]
    api.saveQualityConfigs(configs)
    expect(createMockApi({ storage }).getDb().qualityConfigs).toEqual(configs)
    expect(() => api.saveQualityConfigs([...configs, ...configs])).toThrow()
    expect(() => api.saveQualityConfigs([{ stageId: 'QA', threshold: 101 }])).toThrow()
    expect(() => api.saveQualityConfigs([{ stageId: 'missing', threshold: 50 }])).toThrow()
    expect(api.getDb().qualityConfigs).toEqual(configs)
    api.analyzeTopic('topic-1')
    const article = api.createArticle('topic-1')
    expect(api.getDb().tasks[0]?.id).toBe(article.taskId)
    expect(api.getDb().tasks[0]?.stages[0]?.key).toBe('HOT_TOPIC')
  })
})

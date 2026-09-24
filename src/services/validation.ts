import type { Database, Settings, VideoRequest } from '../types'
import { createStages } from './seed'

export const isTextWorkflow = (type: string): boolean =>
  ['text', 'text to text', 'article', '文本', '文章'].includes(type.trim().toLowerCase())

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function assertSettings(value: Settings): void {
  if (
    !Number.isFinite(value.threshold) ||
    value.threshold < 0 ||
    value.threshold > 100 ||
    !Number.isInteger(value.maxRetries) ||
    value.maxRetries < 0 ||
    value.maxRetries > 100 ||
    !Number.isInteger(value.maxIterations) ||
    value.maxIterations < 1 ||
    value.maxIterations > 101 ||
    !Number.isFinite(value.stageDuration) ||
    value.stageDuration < 1 ||
    typeof value.autoRetry !== 'boolean'
  )
    throw new Error('设置无效：门限 0–100，重试 0–100，迭代 1–101，阶段时长必须为正数')
}
export function assertRequest(db: Database, request: VideoRequest): void {
  if (
    ![request.title, request.theme, request.type, request.ratio, request.platform, request.style].every(
      (v) => typeof v === 'string' && v.trim(),
    ) ||
    typeof request.characters !== 'string' ||
    !Number.isFinite(request.duration) ||
    request.duration <= 0 ||
    !['normal', 'quality', 'system', 'timeout'].includes(request.scenario)
  )
    throw new Error('视频请求参数无效')
  assertEnabled(db, request.modelId, request.workflowId)
  if (db.models.find((m) => m.id === request.modelId)?.capability !== 'Video')
    throw new Error('视频任务需要 Video 模型')
  if (!/video/i.test(db.workflows.find((w) => w.id === request.workflowId)?.type ?? ''))
    throw new Error('视频任务需要 Video 工作流')
}
export function assertEnabled(db: Database, modelId: string, workflowId: string): void {
  const model = db.models.find((model) => model.id === modelId)
  const workflow = db.workflows.find((workflow) => workflow.id === workflowId)
  if (!model?.enabled) throw new Error('模型不存在或未启用')
  if (!workflow?.active) throw new Error('工作流不存在或未启用')
  if (model.provider === 'ComfyUI' && !model.connected) throw new Error('ComfyUI 未连接，拒绝执行')
  if (model.provider !== workflow.provider) throw new Error('模型与工作流 Provider 不匹配')
  if (!['Mock', 'ComfyUI'].includes(model.provider)) throw new Error(`Provider 未支持：${model.provider}`)
}

// 对整个持久化结构做递归校验，不把 JSON.parse 的未知结果直接当成 Database。
type Check = (value: unknown) => boolean
const string: Check = (v) => typeof v === 'string'
const number: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const boolean: Check = (v) => typeof v === 'boolean'
const values =
  (...allowed: unknown[]): Check =>
  (v) =>
    allowed.includes(v)
const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || check(v)
const array =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check)
const shape =
  (fields: Record<string, Check>): Check =>
  (v) =>
    record(v) && Object.entries(fields).every(([key, check]) => check(v[key]))
const strings: Check = (v) => record(v) && Object.values(v).every(string)
const time: Check = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const request = shape({
  title: string,
  theme: string,
  type: string,
  ratio: string,
  duration: number,
  platform: string,
  style: string,
  characters: string,
  modelId: string,
  workflowId: string,
  scenario: values('normal', 'quality', 'system', 'timeout'),
})
const quality = shape({
  score: number,
  passed: boolean,
  threshold: number,
  criteria: array(shape({ name: string, score: number, passed: boolean, reason: string })),
  suggestions: array(string),
})
const task = shape({
  repairPrompt: optional(string),
  qualityRepairs: optional(
    array(
      shape({
        attempt: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 2,
        stageKey: string,
        time,
        before: string,
        after: string,
        reason: string,
      }),
    ),
  ),
  id: string,
  title: string,
  kind: values('video', 'article'),
  status: values('QUEUED', 'RUNNING', 'REVIEWING', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED'),
  progress: number,
  stageIndex: number,
  createdAt: time,
  updatedAt: time,
  elapsed: number,
  estimated: number,
  modelId: string,
  workflowId: string,
  cover: string,
  request,
  script: string,
  previousScript: string,
  stages: array(
    shape({
      key: string,
      name: string,
      status: values('pending', 'running', 'success', 'failed'),
      duration: number,
      input: string,
      output: string,
      prompt: string,
      model: string,
      workflow: string,
      seed: number,
      score: optional(number),
      error: optional(string),
    }),
  ),
  characters: array(
    shape({
      id: string,
      name: string,
      age: number,
      gender: string,
      identity: string,
      appearance: string,
      outfit: string,
      expression: string,
      pose: string,
    }),
  ),
  shots: array(
    shape({
      id: string,
      start: number,
      end: number,
      description: string,
      character: string,
      camera: string,
      action: string,
      emotion: string,
      sound: string,
      firstPrompt: string,
      lastPrompt: string,
      bridge: string,
      continuity: string,
    }),
  ),
  quality: (v) => v === null || quality(v),
  logs: array(shape({ id: string, time, level: values('info', 'warn', 'error'), message: string })),
  retries: number,
  approved: boolean,
  errorType: optional(values('quality', 'system', 'timeout')),
  error: optional(string),
})
const provider = values('Mock', 'ComfyUI')
const workflowKind = values('text', 'image', 'video', 'audio', 'vision', 'embedding')
const executionStatus = values('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED')
const positiveInteger: Check = (v) => typeof v === 'number' && Number.isInteger(v) && v > 0
const score: Check = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
const executionError = shape({
  code: string,
  type: values('quality', 'system', 'timeout', 'cancelled'),
  message: string,
  retryable: boolean,
})
const executionLog = shape({
  id: string,
  time,
  level: values('info', 'warn', 'error'),
  message: string,
  traceId: string,
  executionId: string,
})
const stageDefinition = shape({
  id: string,
  key: string,
  name: string,
  workflowKind,
  provider: optional(provider),
  modelId: optional(string),
  workflowId: optional(string),
  optional: optional(boolean),
  manual: optional(boolean),
})
const pipelineDefinition = shape({
  id: string,
  kind: values('video', 'article'),
  version: string,
  stages: array(stageDefinition),
})
const execution = shape({
  modelId: optional(string),
  prompt: optional(string),
  seed: optional(number),
  quality: optional((v) => v === null || quality(v)),
  stageKey: optional(string),
  stageIndex: optional(number),
  id: string,
  taskId: string,
  pipelineId: string,
  stageId: string,
  provider,
  workflowId: string,
  workflowVersion: string,
  status: executionStatus,
  attempt: positiveInteger,
  traceId: string,
  startedAt: time,
  finishedAt: optional(time),
  input: string,
  output: string,
  error: optional(executionError),
  logs: array(executionLog),
})
const trace = shape({
  id: string,
  taskId: string,
  pipelineId: string,
  stageId: string,
  executionId: string,
  provider,
  status: executionStatus,
  attempt: positiveInteger,
  startedAt: time,
  finishedAt: optional(time),
  error: optional(executionError),
})
const health = shape({
  status: values('unknown', 'healthy', 'unhealthy'),
  checkedAt: time,
  simulated: boolean,
  message: string,
})
const httpUrl: Check = (v) => {
  if (typeof v !== 'string') return false
  try {
    const url = new URL(v)
    return (
      ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    )
  } catch {
    return false
  }
}
const comfyInstance = shape({
  id: string,
  name: string,
  baseUrl: httpUrl,
  enabled: boolean,
  connected: boolean,
  health,
})
const json: Check = (v) =>
  v === null ||
  string(v) ||
  number(v) ||
  boolean(v) ||
  (Array.isArray(v) ? v.every(json) : record(v) && Object.values(v).every(json))
const comfyExecution = shape({
  modelId: optional(string),
  workflowVersion: optional(string),
  workflowRevisionId: optional(string),
  id: string,
  instanceId: string,
  workflowId: string,
  status: executionStatus,
  createdAt: time,
  updatedAt: time,
  inputs: (v) => record(v) && Object.values(v).every(json),
  taskId: optional(string),
  stageId: optional(string),
  promptId: optional(string),
  files: array(shape({ nodeId: string, filename: string, subfolder: string, type: string, url: string })),
  error: optional(executionError),
})
const database = shape({
  version: values(2, 3),
  tasks: array(task),
  settings: shape({
    threshold: number,
    maxRetries: number,
    maxIterations: number,
    autoRetry: boolean,
    stageDuration: number,
  }),
  models: array(
    shape({
      id: string,
      name: string,
      provider: string,
      capability: values('LLM', 'Vision', 'Image', 'Video', 'Audio', 'Embedding'),
      enabled: boolean,
      connected: boolean,
      calls: number,
      latency: number,
      failureRate: number,
    }),
  ),
  workflows: array(
    shape({
      id: string,
      name: string,
      type: string,
      provider: string,
      version: string,
      active: boolean,
      description: string,
      mapping: strings,
      history: array(shape({ version: string, time: string, description: string })),
    }),
  ),
  topics: array(
    shape({
      id: string,
      title: string,
      category: string,
      heat: number,
      growth: number,
      sources: array(shape({ name: string, url: string, publishedAt: string, fetchedAt: string })),
      summary: string,
      analysis: array(
        shape({ label: string, type: values('事实', 'AI 推断', '用户观点', '待核实'), text: string }),
      ),
      risk: string,
      analyzed: boolean,
    }),
  ),
  articles: array(
    shape({
      id: string,
      topicId: string,
      taskId: string,
      title: string,
      outline: string,
      body: string,
      platform: string,
      status: values('draft', 'review', 'approved'),
      updatedAt: time,
      safety: array(shape({ name: string, status: values('待核实', '通过', '风险'), reason: string })),
    }),
  ),
  assets: array(
    shape({
      id: string,
      name: string,
      type: values('图片', '视频', '音频', '角色', '剧本', '分镜', '文章'),
      url: string,
      cover: string,
      tags: array(string),
      taskId: string,
      model: string,
      createdAt: time,
      duration: optional(number),
      resolution: optional(string),
      content: optional(string),
      provider: optional(values('Mock', 'ComfyUI')),
      workflowVersion: optional(string),
      prompt: optional(string),
      seed: optional(number),
      executionId: optional(string),
      pipelineId: optional(string),
      stageId: optional(string),
    }),
  ),
  pipelines: optional(array(pipelineDefinition)),
  executions: optional(array(execution)),
  traces: optional(array(trace)),
  comfyInstances: optional(array(comfyInstance)),
  comfyExecutions: optional(array(comfyExecution)),
  providerRegistry: optional(array(shape({ provider, workflowKinds: array(workflowKind) }))),
  qualityConfigs: optional(
    array(
      shape({
        stageId: string,
        threshold: score,
        criteria: optional(array(string)),
        enabled: optional(boolean),
      }),
    ),
  ),
})
export function assertDatabase(value: unknown): asserts value is Database {
  if (!database(value))
    throw new Error('持久化数据结构损坏或版本不支持（支持 version 2/3）；请备份后显式 reset，未覆盖原数据')
  const db = value as Database
  assertSettings(db.settings)
  for (const list of [
    db.tasks,
    db.models,
    db.workflows,
    db.topics,
    db.articles,
    db.assets,
    db.pipelines ?? [],
    db.executions ?? [],
    db.traces ?? [],
    db.comfyInstances ?? [],
    db.comfyExecutions ?? [],
  ]) {
    if (new Set(list.map((item) => item.id)).size !== list.length) throw new Error('持久化数据 ID 重复')
  }
  for (const pipeline of db.pipelines ?? []) {
    const keys = createStages(pipeline.kind).map((s) => s.key)
    if (
      new Set(pipeline.stages.map((s) => s.id)).size !== pipeline.stages.length ||
      pipeline.stages.length !== keys.length ||
      pipeline.stages.some((s, i) => s.key !== keys[i])
    )
      throw new Error('Pipeline 阶段与旧工作流不兼容')
  }
  if (new Set((db.qualityConfigs ?? []).map((c) => c.stageId)).size !== (db.qualityConfigs ?? []).length)
    throw new Error('质量配置阶段重复')
  for (const t of db.tasks) {
    const keys = createStages(t.kind).map((s) => s.key)
    if (
      t.stages.length !== keys.length ||
      t.stages.some((s, i) => s.key !== keys[i]) ||
      !Number.isInteger(t.stageIndex) ||
      t.stageIndex < 0 ||
      t.stageIndex >= keys.length ||
      !Number.isInteger(t.retries) ||
      t.retries < 0 ||
      t.progress < 0 ||
      t.progress > 100 ||
      (t.status === 'SUCCESS' && (!t.approved || !t.quality?.passed)) ||
      (t.status === 'REVIEWING' && (t.stageIndex !== keys.length - 1 || !t.quality?.passed))
    ) {
      throw new Error(`持久化任务状态不合法：${t.id}`)
    }
  }
}

import type {
  Database,
  ExecutionError,
  PipelineDefinition,
  PipelineStageDefinition,
  ProductionTrace,
  ProviderKind,
  StageExecution,
  TaskAction,
  VideoTask,
} from '../types'
import { clone, createTask, uid } from '../services/seed'
import { qualityGate } from './quality'
import { advanceTask, applyAction, mockStageOutput, qualityKey } from '../services/pipeline'
import { assertEnabled, isTextWorkflow } from '../services/validation'
import { pipelineDefinitions } from './definitions'
import { ProviderRegistry } from './registry'
import type { StageContext } from './contracts'
import { assetRegistry } from './asset-registry'
import { selectStage } from './selection'

/** 网络调用不进入同步 localStorage 事务：ComfyUI Engine 显式运行并产出结果，
 * 调度器只消费对应 task/stage/workflow 的真实产物，绝不回退 Mock。 */
export class Orchestrator {
  constructor(readonly registry = defaultRegistry()) {}

  /** Independent synchronous Mock operation; not inserted into the article/video task queue. */
  analyzeTopic(db: Database, topicId: string, time: number) {
    const topic = db.topics.find((t) => t.id === topicId)
    if (!topic) throw new Error('话题不存在')
    const stage: PipelineStageDefinition = {
      id: 'HOT_TOPIC_ANALYSIS',
      key: 'HOT_TOPIC_ANALYSIS',
      name: 'Mock 热点分析',
      workflowKind: 'text',
      provider: 'Mock',
    }
    const selected = selectStage(db, { modelId: '', workflowId: '' }, stage)
    this.registry.resolve('Mock', 'text')
    const task = createTask(
      {
        title: topic.title,
        theme: topic.summary,
        type: '热点分析',
        ratio: '1:1',
        duration: 1,
        platform: '本地',
        style: '客观',
        characters: '',
        modelId: selected.modelId,
        workflowId: selected.workflowId,
        scenario: 'normal',
      },
      'article',
    )
    task.id = `topic-analysis:${topicId}`
    task.stages = [
      {
        key: stage.key,
        name: stage.name,
        status: 'running',
        duration: 0,
        input: JSON.stringify(topic),
        output: '',
        prompt: `Mock 分析：${topic.title}\n${topic.summary}\n保留事实边界与待核实事项。`,
        model: selected.modelId,
        workflow: selected.workflowId,
        seed: 0,
      },
    ]
    const stamp = new Date(time).toISOString()
    const { execution, trace } = this.start(
      db,
      task,
      'hot-topic-analysis',
      stage.id,
      'Mock',
      selected.workflowId,
      stamp,
      stage.key,
      selected.modelId,
    )
    try {
      if (!topic.analyzed)
        topic.analysis.push(
          {
            label: 'Mock 内容方向',
            type: 'AI 推断',
            text: `围绕“${topic.title}”整理用户问题；这是本地模板分析而非联网研究。`,
          },
          { label: '事实边界', type: '待核实', text: '缺少可核实原始来源，不能视作事实。' },
        )
      topic.analyzed = true
      execution.output = JSON.stringify(topic.analysis)
      this.finish(execution, trace, stamp)
    } catch (error) {
      this.finish(execution, trace, stamp, {
        code: 'TOPIC_ANALYSIS_FAILED',
        type: 'system',
        message: String(error),
        retryable: true,
      })
    }
    return topic
  }

  submit(db: Database, task: VideoTask): VideoTask {
    this.validateTask(db, task)
    if (db.tasks.some((existing) => existing.id === task.id)) throw new Error(`任务已提交：${task.id}`)
    if (task.status !== 'QUEUED') throw new Error('仅排队任务可以提交')
    db.tasks.unshift(task)
    return task
  }

  private validateTask(db: Database, task: VideoTask): void {
    assertEnabled(db, task.modelId, task.workflowId)
    const model = db.models.find((m) => m.id === task.modelId)
    const workflow = db.workflows.find((w) => w.id === task.workflowId)
    if (model?.capability !== (task.kind === 'article' ? 'LLM' : 'Video'))
      throw new Error('模型能力与任务不匹配')
    if (
      !workflow ||
      (task.kind === 'article' ? !isTextWorkflow(workflow.type) : !/video/i.test(workflow.type))
    )
      throw new Error('工作流类型与任务不匹配')
  }

  private definition(db: Database, task: VideoTask): PipelineDefinition {
    const pipeline =
      db.pipelines?.find((p) => p.kind === task.kind) ??
      pipelineDefinitions().find((p) => p.kind === task.kind)
    if (!pipeline) throw new Error('Pipeline 定义不存在')
    return pipeline
  }

  executeStage(db: Database, task: VideoTask, time: number): boolean {
    if (!['QUEUED', 'RUNNING'].includes(task.status)) return false
    // 不在等待阶段创建空执行记录；timeout 仍保持旧行为的三倍时长。
    const timeout =
      task.request.scenario === 'timeout' &&
      task.stageIndex === 1 &&
      !task.logs.some((l) => l.message === 'TIMEOUT_WAIT_USED')
    if (
      task.status === 'RUNNING' &&
      time - Date.parse(task.updatedAt) < db.settings.stageDuration * (timeout ? 3 : 1)
    )
      return false
    const legacyStage = task.stages[task.stageIndex]
    let execution: StageExecution | undefined
    let trace: ProductionTrace | undefined
    const stamp = new Date(time).toISOString()
    try {
      this.validateTask(db, task)
      if (task.status === 'QUEUED') return advanceTask(db, task, time)
      const pipeline = this.definition(db, task)
      const stage = pipeline.stages.find((s) => s.key === legacyStage?.key)
      if (!stage || !legacyStage) throw new Error('阶段定义不存在')
      const { modelId, workflowId, provider: selectedProvider } = selectStage(db, task, stage)
      const model = db.models.find((m) => m.id === modelId)
      const provider = providerKind(selectedProvider)
      const remote =
        provider === 'ComfyUI'
          ? [...(db.comfyExecutions ?? [])]
              .reverse()
              .find((e) => e.taskId === task.id && e.stageId === stage.id && e.workflowId === workflowId)
          : undefined
      // 已排队的真实请求由异步 Engine 运行，tick 不把等待误判为失败。
      if (remote && ['QUEUED', 'RUNNING'].includes(remote.status)) return false
      ;({ execution, trace } = this.start(
        db,
        task,
        pipeline.id,
        stage.id,
        provider,
        workflowId,
        stamp,
        stage.key,
        modelId,
      ))
      if (remote?.workflowVersion) execution.workflowVersion = remote.workflowVersion
      if (remote) {
        execution.prompt =
          typeof remote.inputs.prompt === 'string' ? remote.inputs.prompt : JSON.stringify(remote.inputs)
        execution.seed = typeof remote.inputs.seed === 'number' ? remote.inputs.seed : legacyStage.seed
      }
      assertEnabled(db, modelId, workflowId)
      if (model?.provider !== provider) throw new Error('阶段 Provider 与模型不匹配')
      if (remote?.modelId && remote.modelId !== modelId) throw new Error('Engine 执行模型与当前 stage 不匹配')
      if (
        provider !== 'Mock' &&
        (stage.key === qualityKey(task) ||
          db.qualityConfigs?.some((c) => c.stageId === stage.id && c.enabled !== false))
      ) {
        throw new Error('真实 Provider 的质量阶段必须配置真实评估器，不使用 Mock 固定评分')
      }
      const executor = this.registry.resolve(provider, stage.workflowKind)
      const changed = advanceTask(db, task, time, () =>
        executor.execute({ db, task, stage: { ...stage, modelId, workflowId }, time }),
      )
      execution.input = legacyStage.input
      execution.output = legacyStage.output
      if (legacyStage.score !== undefined)
        execution.quality = clone(qualityGate.evaluate(db, stage.key, legacyStage.score, task.kind))
      legacyStage.model = modelId
      legacyStage.workflow = workflowId
      // 自动重试会替换 task.stages 和清除 task.error，故读取本轮阶段引用。
      if (legacyStage.status === 'failed') {
        this.finish(execution, trace, stamp, {
          code:
            task.errorType === 'timeout'
              ? 'PROVIDER_TIMEOUT'
              : task.errorType === 'system'
                ? 'PROVIDER_ERROR'
                : 'QUALITY_REJECTED',
          type: task.errorType ?? 'quality',
          message: legacyStage.error ?? '阶段执行失败',
          retryable: true,
        })
      } else {
        this.finish(execution, trace, stamp)
        if (remote?.status === 'SUCCESS')
          for (const file of remote.files) {
            assetRegistry.register(
              db,
              {
                id: `${execution.id}:${file.nodeId}:${file.type}:${file.subfolder}:${file.filename}`,
                name: file.filename,
                type: /\.(mp4|webm|gif|mov)$/i.test(file.filename)
                  ? '视频'
                  : /\.(wav|mp3|ogg|flac)$/i.test(file.filename)
                    ? '音频'
                    : '图片',
                url: file.url,
                cover: '',
                tags: ['ComfyUI'],
                taskId: task.id,
                model: modelId,
                createdAt: stamp,
              },
              execution,
            )
          }
      }
      return changed
    } catch (error) {
      if (!execution || !trace) {
        const model = db.models.find((m) => m.id === task.modelId)
        ;({ execution, trace } = this.start(
          db,
          task,
          `${task.kind}-pipeline`,
          legacyStage?.key ?? 'UNKNOWN',
          model?.provider === 'ComfyUI' ? 'ComfyUI' : 'Mock',
          task.workflowId,
          stamp,
        ))
      }
      const failure: ExecutionError = {
        code: 'PROVIDER_ERROR',
        type: 'system',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      }
      this.finish(execution, trace, stamp, failure)
      if (legacyStage) {
        legacyStage.status = 'failed'
        legacyStage.error = failure.message
      }
      task.status = 'FAILED'
      task.errorType = 'system'
      task.error = failure.message
      task.updatedAt = stamp
      task.logs.push({ id: uid('log'), time: stamp, level: 'error', message: failure.message })
      return true
    }
  }

  private start(
    db: Database,
    task: VideoTask,
    pipelineId: string,
    stageId: string,
    provider: ProviderKind,
    workflowId: string,
    stamp: string,
    stageKey = stageId,
    modelId = task.modelId,
  ) {
    const executions = (db.executions ??= [])
    const stageIndex = task.stages.findIndex((s) => s.key === stageKey)
    const stage = task.stages[stageIndex]
    const execution: StageExecution = {
      id: uid('execution'),
      taskId: task.id,
      pipelineId,
      stageId,
      provider,
      workflowId,
      modelId,
      stageKey,
      stageIndex,
      prompt: stage?.prompt || task.repairPrompt || JSON.stringify(task.request, null, 2),
      seed: stage?.seed ?? 0,
      quality: null,
      workflowVersion: db.workflows.find((w) => w.id === workflowId)?.version ?? 'unknown',
      status: 'RUNNING',
      attempt: executions.filter((e) => e.taskId === task.id && e.stageId === stageId).length + 1,
      traceId: uid('trace'),
      startedAt: stamp,
      input: stage?.input ?? '',
      output: '',
      logs: [],
    }
    execution.logs.push({
      id: uid('log'),
      time: stamp,
      level: 'info',
      message: `${provider} 阶段开始`,
      traceId: execution.traceId,
      executionId: execution.id,
    })
    const trace: ProductionTrace = {
      id: execution.traceId,
      taskId: task.id,
      pipelineId,
      stageId,
      executionId: execution.id,
      provider,
      status: 'RUNNING',
      attempt: execution.attempt,
      startedAt: stamp,
    }
    executions.push(execution)
    ;(db.traces ??= []).push(trace)
    return { execution, trace }
  }

  private finish(
    execution: StageExecution,
    trace: ProductionTrace,
    stamp: string,
    error?: ExecutionError,
  ): void {
    execution.status = error ? 'FAILED' : 'SUCCESS'
    execution.finishedAt = stamp
    if (error) execution.error = error
    trace.status = execution.status
    trace.finishedAt = stamp
    if (error) trace.error = error
    execution.logs.push({
      id: uid('log'),
      time: stamp,
      level: error ? 'error' : 'info',
      message: error?.message ?? '阶段完成',
      traceId: trace.id,
      executionId: execution.id,
    })
  }

  tick(db: Database, time: number): boolean {
    let changed = false
    for (const task of db.tasks) changed = this.executeStage(db, task, time) || changed
    return changed
  }

  action(db: Database, task: VideoTask, action: TaskAction, time: number): void {
    const stage = task.stages[task.stageIndex]
    applyAction(db, task, action, time)
    if ((action === 'approve' || action === 'reject' || action === 'skip') && stage) {
      const pipeline = this.definition(db, task)
      const definition = pipeline.stages.find((s) => s.key === stage.key)
      if (!definition) throw new Error('阶段定义不存在')
      const selected = selectStage(db, task, definition)
      const { execution, trace } = this.start(
        db,
        task,
        pipeline.id,
        definition.id,
        providerKind(selected.provider),
        selected.workflowId,
        new Date(time).toISOString(),
        stage.key,
        selected.modelId,
      )
      execution.input = stage.input
      execution.output = action === 'reject' ? task.error ?? '人工审核拒绝' : stage.output
      if (action === 'approve') execution.quality = clone(task.quality)
      this.finish(execution, trace, new Date(time).toISOString(), action === 'reject' ? {
        code: 'MANUAL_REJECTED', type: 'quality', message: execution.output, retryable: true,
      } : undefined)
      if (action === 'skip') execution.status = trace.status = 'SKIPPED'
      for (const asset of db.assets.filter((a) => a.taskId === task.id)) {
        const sourceKey =
          asset.type === '文章'
            ? 'GENERATE'
            : asset.type === '角色'
              ? 'CHARACTER'
              : asset.type === '分镜'
                ? 'STORYBOARD'
                : asset.name.endsWith('.srt')
                  ? 'SUBTITLE'
                  : 'SCRIPT'
        if (asset.executionId) continue
        const source = [...(db.executions ?? [])]
          .reverse()
          .find(
            (e) => e.taskId === task.id && (e.stageKey ?? e.stageId) === sourceKey && e.status === 'SUCCESS',
          )
        if (source)
          Object.assign(asset, {
            provider: source.provider,
            model: source.modelId ?? asset.model,
            workflowVersion: source.workflowVersion,
            executionId: source.id,
            pipelineId: source.pipelineId,
            stageId: source.stageId,
            prompt: source.prompt,
            seed: source.seed,
          })
      }
    }
  }
}

function providerKind(value: string | undefined): ProviderKind {
  if (value !== 'Mock' && value !== 'ComfyUI') throw new Error(`Provider 未支持：${value}`)
  return value
}

export function defaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register({
    provider: 'Mock',
    workflowKinds: ['text', 'image', 'video', 'audio', 'vision', 'embedding'],
    execute: ({ db, task, stage }: StageContext) => mockStageOutput(db, task, stage.key),
  })
  registry.register({
    provider: 'ComfyUI',
    workflowKinds: ['image', 'video', 'audio'],
    execute: ({ db, task, stage }: StageContext) => comfyOutput(db, task, stage),
  })
  return registry
}

function comfyOutput(db: Database, task: VideoTask, stage: PipelineStageDefinition): string {
  const result = [...(db.comfyExecutions ?? [])]
    .reverse()
    .find((e) => e.taskId === task.id && e.stageId === stage.id && e.workflowId === stage.workflowId)
  const instance = db.comfyInstances?.find((i) => i.id === result?.instanceId)
  if (
    !instance?.enabled ||
    !instance.connected ||
    instance.health.status !== 'healthy' ||
    instance.health.simulated
  )
    throw new Error('ComfyUI 未通过真实健康探测，拒绝执行')
  const previous = db.executions?.some(
    (e) =>
      e.taskId === task.id &&
      e.stageId === stage.id &&
      e.status === 'SUCCESS' &&
      e.output.includes(`"${result?.id}"`),
  )
  if (!result || result.status !== 'SUCCESS' || !result.promptId || !result.files.length || previous)
    throw new Error('ComfyUI 需要 Engine 已完成且未消费的真实执行，不能回退 Mock')
  return JSON.stringify({ executionId: result.id, promptId: result.promptId, files: result.files })
}

export const orchestrator = new Orchestrator()

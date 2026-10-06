import type {
  Article,
  ComfyUIInstance,
  ComfyUIExecution,
  Database,
  QualityGateConfig,
  Settings,
  TaskAction,
  VideoRequest,
  VideoTask,
  Workflow,
} from '../types'
import { clone, createDemoSeed, createSeed, createTask, now, uid } from './seed'
import { invalidateReview, log, restartTask } from './pipeline'
import { assertDatabase, assertEnabled, assertRequest, assertSettings, isTextWorkflow } from './validation'
import { orchestrator } from '../orchestrator/engine'
import { ComfyUIEngine } from './comfyui-engine'
import type { EngineTransport } from './comfyui-engine'
import type { JsonValue } from '../providers/contracts'
import { WorkflowVersionRegistry } from '../workflow/versions'
import { pipelineDefinitions } from '../orchestrator/definitions'

export const STORAGE_KEY = 'acg-content-factory-db'
export type TaskConfiguration = Pick<VideoRequest, 'modelId' | 'workflowId' | 'scenario'>
export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export interface EngineSubmission {
  instanceId: string
  workflowId: string
  taskId: string
  stageId: string
  inputs: Record<string, JsonValue>
}
export class PersistenceError extends Error {
  constructor(operation: string, cause: unknown) {
    super(
      `持久化${operation}失败：${cause instanceof Error ? cause.message : String(cause)}。数据未静默重置。`,
    )
    this.name = 'PersistenceError'
  }
}
interface Options {
  storage?: StoragePort
  clock?: () => number
}

/** 同步事务核心；异步 UI 延迟由 factory store 提供。返回值全部为快照，禁止外部绕过状态机。 */
export function createMockApi(options: Options = {}) {
  const engine = new ComfyUIEngine()
  let db: Database | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const clock = options.clock ?? (() => Date.now())
  const listeners = new Map<(snapshot: Database) => void, (error: unknown) => void>()
  const storage = () => {
    if (options.storage) return options.storage
    if (typeof localStorage === 'undefined') throw new Error('localStorage 不可用')
    return localStorage
  }
  function load(): Database {
    try {
      const raw = storage().getItem(STORAGE_KEY)
      if (raw === null) {
        const seed = createSeed()
        storage().setItem(STORAGE_KEY, JSON.stringify(seed))
        return seed
      }
      const parsed: unknown = JSON.parse(raw)
      assertDatabase(parsed)
      // v2 字段原样保留；新集合按需初始化，下次成功事务写入 v3。
      parsed.version = 3
      return parsed
    } catch (error) {
      throw new PersistenceError('读取', error)
    }
  }
  function current(): Database {
    db ??= load()
    return db
  }
  function commit(next: Database): void {
    assertDatabase(next)
    try {
      storage().setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
      throw new PersistenceError('写入', error)
    }
    db = next
    for (const [notify, onError] of listeners) {
      try {
        notify(clone(next))
      } catch (error) {
        onError(error)
      }
    }
  }
  function transaction<T>(update: (draft: Database) => T): T {
    // 基于最新持久化快照计算事务，不将旧标签页的缓存重新写回。
    const next = clone(load())
    const result = update(next)
    commit(next)
    return clone(result)
  }
  function taskById(draft: Database, id: string): VideoTask {
    const task = draft.tasks.find((item) => item.id === id)
    if (!task) throw new Error(`任务不存在：${id}`)
    return task
  }
  function validateEngineStage(draft: Database, input: EngineSubmission): string {
    const task = taskById(draft, input.taskId)
    if (!['RUNNING', 'WAITING', 'QUEUED'].includes(task.status)) throw new Error('任务状态不允许 Engine 执行')
    const pipeline = (draft.pipelines ?? pipelineDefinitions()).find((p) => p.kind === task.kind)
    const stage = pipeline?.stages.find((s) => s.id === input.stageId)
    if (!stage || task.stages[task.stageIndex]?.key !== stage.key)
      throw new Error('必须显式选择任务当前 stageId')
    const modelId = stage.modelId ?? task.modelId
    const model = draft.models.find((m) => m.id === modelId)
    if ((stage.provider ?? model?.provider) !== 'ComfyUI' || model?.provider !== 'ComfyUI')
      throw new Error('所选 stage 未绑定 ComfyUI')
    if ((stage.workflowId ?? task.workflowId) !== input.workflowId)
      throw new Error('所选 stage 与 Workflow 不匹配')
    assertEnabled(draft, modelId, input.workflowId)
    return modelId
  }
  function persistExecution(update: ComfyUIExecution): ComfyUIExecution {
    return transaction((draft) => {
      const saved = draft.comfyExecutions?.find((e) => e.id === update.id)
      if (!saved) throw new Error('执行已被移除，拒绝回写')
      // 取消优先于迟到的成功；仍保存远端刚返回的 promptId。
      if (saved.status === 'CANCELLED') {
        if (update.promptId) saved.promptId = update.promptId
      } else Object.assign(saved, clone(update))
      return saved
    })
  }
  const api = {
    getDb: (): Database => clone(current()),
    refresh: (): Database => {
      const loaded = load()
      db = loaded
      return clone(loaded)
    },
    reset: (): Database => {
      const seed = createSeed()
      commit(seed)
      return clone(seed)
    },
    createComfyInstance: (input: Omit<ComfyUIInstance, 'health'>) =>
      transaction((draft) => engine.createInstance(draft, input)),
    updateComfyInstance: (input: ComfyUIInstance) =>
      transaction((draft) => engine.updateInstance(draft, input)),
    deleteComfyInstance: (id: string): boolean =>
      transaction((draft) => {
        engine.deleteInstance(draft, id)
        return true
      }),
    comfyQueue: () => engine.queue(load()),
    comfyExecutions: () => engine.executions(load()),
    mockComfyHealth: (id: string, healthy = false) =>
      transaction((draft) => engine.health(draft, id, healthy)),
    probeComfyHealth: async (id: string, fetcher: typeof fetch = globalThis.fetch, timeout?: number) => {
      const snapshot = load()
      const original = snapshot.comfyInstances?.find((i) => i.id === id)
      if (!original) throw new Error('ComfyUI 实例不存在')
      const signature = JSON.stringify(original)
      const health = await engine.probe(snapshot, id, fetcher, timeout)
      return transaction((draft) => {
        const instance = draft.comfyInstances?.find((i) => i.id === id)
        if (!instance || JSON.stringify(instance) !== signature)
          throw new Error('探测期间实例已变化，拒绝过期健康结果')
        instance.health = health
        return health
      })
    },
    enqueueComfy: (input: EngineSubmission, transport: EngineTransport = {}): ComfyUIExecution =>
      transaction((draft) => {
        const modelId = validateEngineStage(draft, input)
        if (
          draft.comfyExecutions?.some(
            (e) =>
              e.taskId === input.taskId &&
              e.stageId === input.stageId &&
              ['QUEUED', 'RUNNING'].includes(e.status),
          )
        )
          throw new Error('阶段已有排队或运行的执行')
        engine.configureActive(
          input.instanceId,
          input.workflowId,
          new WorkflowVersionRegistry(storage()),
          transport,
        )
        const result = engine.enqueue(
          draft,
          input.instanceId,
          input.workflowId,
          input.inputs,
          input.taskId,
          input.stageId,
        )
        const saved = draft.comfyExecutions?.find((e) => e.id === result.id)
        if (!saved) throw new Error('执行未入队')
        saved.modelId = modelId
        return saved
      }),
    runComfy: async (
      id: string,
      transport: EngineTransport = {},
      signal?: AbortSignal,
      onProgress?: (snapshot: Database) => void,
    ): Promise<ComfyUIExecution> => {
      const snapshot = load()
      const execution = snapshot.comfyExecutions?.find((e) => e.id === id)
      if (!execution?.taskId || !execution.stageId) throw new Error('执行必须关联 taskId/stageId')
      const modelId = validateEngineStage(snapshot, {
        ...execution,
        taskId: execution.taskId,
        stageId: execution.stageId,
      })
      if (execution.modelId !== modelId) throw new Error('阶段模型已变化，请重新入队')
      engine.configureActive(
        execution.instanceId,
        execution.workflowId,
        new WorkflowVersionRegistry(storage()),
        transport,
      )
      let persistenceFailure: unknown
      await engine.run(snapshot, id, signal, (update) => {
        try {
          persistExecution(update)
          onProgress?.(clone(current()))
        } catch (error) {
          persistenceFailure = error
          throw error
        }
      })
      if (persistenceFailure) throw persistenceFailure
      const saved = load().comfyExecutions?.find((e) => e.id === id)
      if (!saved) throw new Error('执行不存在')
      return clone(saved)
    },
    cancelComfy: (id: string): ComfyUIExecution => transaction((draft) => engine.cancel(draft, id)),
    loadDemo: (): VideoTask[] =>
      transaction((draft) => {
        const demo = createDemoSeed(draft)
        const tasks = demo.tasks
        for (const task of tasks) {
          task.createdAt = task.updatedAt = new Date(clock()).toISOString()
          task.estimated = ((task.stages.length - 1) * draft.settings.stageDuration) / 1000
          log(task, '用户显式加载 Mock 示例；不覆盖已有任务')
        }
        draft.tasks.unshift(...tasks)
        draft.articles.unshift(...demo.articles)
        draft.assets.unshift(...demo.assets)
        return tasks
      }),
    createVideo: (request: VideoRequest): VideoTask =>
      transaction((draft) => {
        assertRequest(draft, request)
        const task = createTask(request)
        orchestrator.submit(draft, task)
        task.createdAt = task.updatedAt = new Date(clock()).toISOString()
        task.estimated = (10 * draft.settings.stageDuration) / 1000
        log(task, '任务已创建，等待 Mock 调度')
        return task
      }),
    action: (id: string, action: TaskAction): VideoTask =>
      transaction((draft) => {
        const task = taskById(draft, id)
        orchestrator.action(draft, task, action, clock())
        return task
      }),
    reconfigureTask: (id: string, configuration: TaskConfiguration): VideoTask =>
      transaction((draft) => {
        const task = taskById(draft, id)
        if (!['WAITING', 'FAILED'].includes(task.status)) throw new Error('仅 WAITING/FAILED 任务可重新配置')
        const { modelId, workflowId, scenario } = configuration
        assertEnabled(draft, modelId, workflowId)
        if (!['normal', 'quality', 'system', 'timeout'].includes(scenario)) throw new Error('模拟场景无效')
        const capability = task.kind === 'article' ? 'LLM' : 'Video'
        if (!draft.models.some((m) => m.id === modelId && m.capability === capability))
          throw new Error(`任务需要 ${capability} 模型`)
        const workflow = draft.workflows.find((w) => w.id === workflowId)
        if (
          !workflow ||
          (task.kind === 'article' ? !isTextWorkflow(workflow.type) : !/video/i.test(workflow.type))
        )
          throw new Error('工作流类型与任务不匹配')
        task.modelId = modelId
        task.workflowId = workflowId
        task.request = { ...task.request, modelId, workflowId, scenario }
        restartTask(task, clock())
        task.estimated = ((task.stages.length - 1) * draft.settings.stageDuration) / 1000
        log(task, '重新配置完成，保留创作内容并重新排队')
        return task
      }),
    tick: (): Database => {
      const next = clone(load())
      const changed = orchestrator.tick(next, clock())
      if (changed) commit(next)
      else db = next
      return clone(current())
    },
    advance: (id: string): VideoTask =>
      transaction((draft) => {
        const task = taskById(draft, id)
        orchestrator.executeStage(draft, task, clock())
        return task
      }),
    analyzeTopic: (id: string) => transaction((draft) => orchestrator.analyzeTopic(draft, id, clock())),
    createArticle: (topicId: string): Article =>
      transaction((draft) => {
        const topic = draft.topics.find((t) => t.id === topicId)
        if (!topic) throw new Error('话题不存在')
        const model = draft.models.find((m) => m.enabled && m.capability === 'LLM')
        const workflow = draft.workflows.find((w) => w.active && isTextWorkflow(w.type))
        if (!model) throw new Error('没有启用的 LLM 模型')
        if (!workflow) throw new Error('没有可用的文本工作流')
        assertEnabled(draft, model.id, workflow.id)
        const task = createTask(
          {
            title: topic.title,
            theme: topic.summary,
            type: '文章',
            ratio: '1:1',
            duration: 30,
            platform: '微信公众号',
            style: '客观克制',
            characters: '叙述者',
            modelId: model.id,
            workflowId: workflow.id,
            scenario: 'normal',
          },
          'article',
        )
        orchestrator.submit(draft, task)
        task.createdAt = task.updatedAt = new Date(clock()).toISOString()
        task.estimated = ((task.stages.length - 1) * draft.settings.stageDuration) / 1000
        const article: Article = {
          id: uid('article'),
          topicId,
          taskId: task.id,
          title: topic.title,
          outline: '一、话题概述\n二、可能影响\n三、事实核验',
          body: `# ${topic.title}\n\n${topic.summary}\n\n## AI 推断（Mock）\n可从实际使用场景出发，比较收益与限制。\n\n## 待核实\n${topic.risk}\n\n本文为本地模板初稿，尚未发布。`,
          platform: '微信公众号',
          status: 'draft',
          updatedAt: now(),
          safety: [{ name: '原始来源', status: '待核实', reason: '请人工核实并补充来源' }],
        }
        draft.articles.unshift(article)
        return article
      }),
    saveArticle: (article: Article): Article =>
      transaction((draft) => {
        const saved = draft.articles.find((a) => a.id === article.id)
        if (!saved || saved.taskId !== article.taskId || saved.topicId !== article.topicId)
          throw new Error('文章不存在或关联不可修改')
        const task = taskById(draft, saved.taskId)
        if (['SUCCESS', 'CANCELLED'].includes(task.status)) throw new Error('终态文章不可修改')
        if (article.status === 'approved') throw new Error('请通过任务 approve 完成人工审核')
        if (!article.title.trim() || !article.body.trim() || !article.safety.length)
          throw new Error('文章内容及安全检查不能为空')
        const contentChanged =
          saved.title !== article.title || saved.body !== article.body ||
          saved.outline !== article.outline || saved.platform !== article.platform
        Object.assign(saved, clone(article), { updatedAt: now() })
        if (contentChanged) {
          saved.status = 'draft'
          saved.safety = saved.safety.map(check => ({
            ...check, status: '待核实', reason: '内容已修改，需要重新人工核验',
          }))
        }
        task.title = saved.title
        task.script = saved.body
        if (contentChanged && task.quality) invalidateReview(task, clock())
        return saved
      }),
    saveTask: (task: VideoTask): VideoTask =>
      transaction((draft) => {
        const saved = taskById(draft, task.id)
        if (saved.kind === 'article') throw new Error('文章内容请使用 saveArticle 保存')
        if (!['WAITING', 'REVIEWING', 'FAILED'].includes(saved.status))
          throw new Error('请先暂停任务再编辑；终态不可修改')
        // 仅可编辑创作内容；状态、重试计数、评分、request 和模型关联不可由表单覆盖。
        if (!task.title.trim()) throw new Error('任务标题不能为空')
        if (saved.script !== task.script) log(saved, 'MANUAL_CONTENT:SCRIPT')
        if (JSON.stringify(saved.characters) !== JSON.stringify(task.characters))
          log(saved, 'MANUAL_CONTENT:CHARACTER')
        if (JSON.stringify(saved.shots) !== JSON.stringify(task.shots))
          log(saved, 'MANUAL_CONTENT:STORYBOARD')
        saved.title = task.title
        saved.previousScript = saved.script
        saved.script = task.script
        saved.characters = clone(task.characters)
        saved.shots = clone(task.shots)
        saved.updatedAt = new Date(clock()).toISOString()
        if (saved.status === 'REVIEWING') {
          invalidateReview(saved, clock())
        }
        return saved
      }),
    saveWorkflow: (workflow: Workflow): Workflow =>
      transaction((draft) => {
        if (!workflow.id.trim() || !workflow.name.trim()) throw new Error('工作流 ID 和名称不能为空')
        const existing = draft.workflows.find((w) => w.id === workflow.id)
        if (existing) Object.assign(existing, clone(workflow))
        else draft.workflows.push(clone(workflow))
        return workflow
      }),
    deleteAsset: (id: string): boolean =>
      transaction((draft) => {
        const index = draft.assets.findIndex((a) => a.id === id)
        if (index < 0) throw new Error('资产不存在')
        draft.assets.splice(index, 1)
        return true
      }),
    saveSettings: (settings: Settings): Settings =>
      transaction((draft) => {
        assertSettings(settings)
        draft.settings = clone(settings)
        return settings
      }),
    saveQualityConfigs: (configs: QualityGateConfig[]): QualityGateConfig[] =>
      transaction((draft) => {
        const keys = new Set(
          (draft.pipelines ?? pipelineDefinitions()).flatMap((p) => p.stages.map((s) => s.key)),
        )
        if (configs.some((config) => !keys.has(config.stageId)))
          throw new Error('质量配置 stageId 必须是现有阶段 key')
        draft.qualityConfigs = clone(configs)
        // Commit performs recursive validation, including finite 0–100 thresholds and duplicate stages.
        return draft.qualityConfigs
      }),
    toggleModel: (id: string): boolean =>
      transaction((draft) => {
        const model = draft.models.find((m) => m.id === id)
        if (!model) throw new Error('模型不存在')
        model.enabled = !model.enabled
        return model.enabled
      }),
    /** 单个 API 实例仅一个 interval；最后一个订阅者离开时停止。tick 错误停止定时器并明确上报。 */
    subscribe: (notify: (snapshot: Database) => void, onError: (error: unknown) => void): (() => void) => {
      current()
      listeners.set(notify, onError)
      if (timer === undefined)
        timer = setInterval(() => {
          try {
            api.tick()
          } catch (error) {
            api.stop()
            for (const report of listeners.values()) report(error)
          }
        }, 250)
      return () => {
        listeners.delete(notify)
        if (listeners.size === 0) api.stop()
      }
    },
    stop: (): void => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
  }
  return api
}

export const mockApi = createMockApi()
export type MockApi = ReturnType<typeof createMockApi>

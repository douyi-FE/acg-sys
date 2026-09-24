import { defineStore } from 'pinia'
import { onScopeDispose, ref } from 'vue'
import type {
  Article,
  ComfyUIExecution,
  ComfyUIInstance,
  Database,
  QualityGateConfig,
  Settings,
  TaskAction,
  VideoRequest,
  VideoTask,
  Workflow,
} from '../types'
import { mockApi } from '../services/mock'
import type { EngineSubmission, TaskConfiguration } from '../services/mock'
import type { EngineTransport } from '../services/comfyui-engine'
import { clone, createSeed } from '../services/seed'
import { isMockMode } from '../api/mode'
import { serverRequest } from '../api/session'
import { segment } from '../api/http'
import { reviewActionReason, REVIEW_UNAVAILABLE } from '../services/pipeline'
import { useAuthStore } from './auth'

function emptyWorkspace(): Database {
  return {
    version: 1, tasks: [], topics: [], articles: [], assets: [], workflows: [], models: [],
    settings: { threshold: 0, maxRetries: 0, maxIterations: 0, autoRetry: false, stageDuration: 0 },
  }
}
async function workspace(): Promise<Database> {
  const data = await serverRequest<Database>('/workspace')
  if (!data || !['tasks', 'topics', 'articles', 'assets', 'workflows', 'models'].every(key => Array.isArray(Reflect.get(data, key))) || !data.settings) {
    throw new Error('后端 /workspace 尚未返回兼容 Database 投影；拒绝填充 Mock 数据')
  }
  // 旧页面不应透传任何供应商媒体 URL；真实预览统一走 AuthorizedAsset。
  return { ...data, assets: data.assets.map(asset => ({ ...asset, url: '', cover: '' })) }
}

export const MOCK_LATENCY = 120
export const useFactoryStore = defineStore('factory', () => {
  const db = ref<Database>(isMockMode ? createSeed() : emptyWorkspace())
  const loading = ref(false)
  const error = ref('')
  let pending = 0
  let unsubscribe: (() => void) | undefined
  let initializing: Promise<void> | undefined
  let generation = 0
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

  async function run<T>(operation: () => T | Promise<T>, realOperation?: () => Promise<T>): Promise<T> {
    const started = generation
    pending++
    loading.value = true
    error.value = ''
    try {
      if (!isMockMode && !realOperation) throw new Error('此旧版操作尚未接入后端，未执行；请使用真实创作入口')
      if (isMockMode) await new Promise<void>((resolve) => setTimeout(resolve, MOCK_LATENCY))
      const result = realOperation && !isMockMode ? await realOperation() : await operation()
      if (started !== generation) return result
      const snapshot = isMockMode ? mockApi.getDb() : await workspace()
      if (started === generation) db.value = snapshot
      return result
    } catch (cause) {
      if (started === generation) error.value = message(cause)
      throw cause
    } finally {
      pending--
      loading.value = pending > 0
    }
  }
  function init(): Promise<void> {
    if (initializing) return initializing
    const token = generation
    if (!isMockMode) {
      initializing = run(() => undefined, async () => undefined).finally(() => { initializing = undefined })
      return initializing
    }
    initializing = run(() => {
      db.value = mockApi.refresh()
      if (!unsubscribe && token === generation)
        unsubscribe = mockApi.subscribe(
          (snapshot) => {
            db.value = snapshot
          },
          (cause) => {
            error.value = message(cause)
            unsubscribe?.()
            unsubscribe = undefined
          },
        )
    }).finally(() => {
      initializing = undefined
    })
    return initializing
  }
  function refresh(): Promise<void> {
    // refresh 必须走与 init 相同的订阅恢复路径；持久化损坏修复后 scheduler 不能停留在旧状态。
    return init()
  }
  // 额外生命周期方法：用于测试、路由退出或主动停止后台调度；init 可重新启动。
  function dispose(): void {
    generation++
    unsubscribe?.()
    unsubscribe = undefined
  }
  onScopeDispose(dispose)

  return {
    db,
    loading,
    error,
    init,
    dispose,
    reset: () => { dispose(); db.value = isMockMode ? createSeed() : emptyWorkspace(); error.value = '' },
    createComfyInstance: (input: Omit<ComfyUIInstance, 'health'>) => {
      const copy = clone(input)
      return run(() => mockApi.createComfyInstance(copy),
        () => serverRequest('/comfyui/instances', 'POST', copy))
    },
    updateComfyInstance: (input: ComfyUIInstance) => {
      const copy = clone(input)
      return run(() => mockApi.updateComfyInstance(copy),
        () => serverRequest(`/comfyui/instances/${segment(copy.id)}`, 'PATCH', copy))
    },
    deleteComfyInstance: (id: string) => run(() => mockApi.deleteComfyInstance(id)),
    mockComfyHealth: (id: string, healthy = false) => run(() => mockApi.mockComfyHealth(id, healthy)),
    probeComfyHealth: (id: string, fetcher?: typeof fetch, timeout?: number) => {
      void fetcher; void timeout
      return run(() => { throw new Error('Mock 模式禁止真实探测，请切换 real 并配置后端') },
        () => serverRequest(`/comfyui/instances/${segment(id)}/test`, 'POST'))
    },
    enqueueComfy: (input: EngineSubmission, transport: EngineTransport = {}) => {
      const copy = clone(input)
      void transport
      return run(() => { throw new Error('Mock 模式禁止真实 ComfyUI 提交，请切换 real') },
        () => serverRequest<ComfyUIExecution>('/comfyui/executions/submit', 'POST', {
          serviceId: copy.instanceId, taskId: copy.taskId, workflowId: copy.workflowId, input: copy.inputs,
        }))
    },
    runComfy: (id: string, transport?: EngineTransport) => {
      void transport
      return run(() => { throw new Error('浏览器执行已关闭；请使用后端执行入口') },
        () => serverRequest(`/comfyui/executions/${segment(id)}/status`))
    },
    cancelComfy: (id: string) => run(() => mockApi.cancelComfy(id),
      () => serverRequest(`/comfyui/executions/${segment(id)}/cancel`, 'POST')),
    comfyQueue: () => isMockMode ? mockApi.comfyQueue() : (db.value.comfyExecutions ?? []).filter(row => row.status === 'QUEUED').map((row, position) => ({ executionId: row.id, instanceId: row.instanceId, status: row.status, position })),
    comfyExecutions: () => isMockMode ? mockApi.comfyExecutions() : db.value.comfyExecutions ?? [],
    createVideo: (request: VideoRequest): Promise<VideoTask> => {
      const input = clone(request)
      return run(() => mockApi.createVideo(input), () => serverRequest<VideoTask>('/tasks', 'POST', input))
    },
    action: (id: string, action: TaskAction): Promise<void> =>
      run(() => {
        if (action === 'approve' || action === 'reject') {
          const task = db.value.tasks.find(item => item.id === id)
          if (!task) throw new Error('任务不存在')
          const reason = reviewActionReason(db.value, task, action, {
            permitted: useAuthStore().can('tasks.update'), available: isMockMode,
          })
          if (reason) throw new Error(reason)
        }
        mockApi.action(id, action)
      }, async () => {
        if (action === 'approve' || action === 'reject') {
          if (!useAuthStore().can('tasks.update')) throw new Error('当前账号缺少 tasks.update 权限，不能人工审核。')
          throw new Error(REVIEW_UNAVAILABLE)
        }
        await serverRequest(`/tasks/${segment(id)}/actions`, 'POST', { action })
      }),
    reconfigureTask: (id: string, configuration: TaskConfiguration): Promise<void> => {
      const input = clone(configuration)
      return run(() => {
        mockApi.reconfigureTask(id, input)
      }, async () => { await serverRequest(`/tasks/${segment(id)}`, 'PATCH', input) })
    },
    analyzeTopic: (id: string): Promise<void> =>
      run(() => {
        mockApi.analyzeTopic(id)
      }, async () => { throw new Error('真实热点分析暂不可用：后端尚未提供此接口') }),
    createArticle: (topicId: string): Promise<Article> => run(() => mockApi.createArticle(topicId),
      async () => { throw new Error('真实文章创建暂不可用：后端尚未提供文章存储接口') }),
    saveArticle: (article: Article): Promise<void> => {
      const input = clone(article)
      return run(() => {
        mockApi.saveArticle(input)
      }, async () => { throw new Error('真实文章保存暂不可用：后端尚未提供文章存储接口') })
    },
    saveTask: (task: VideoTask): Promise<void> => {
      const input = clone(task)
      return run(() => {
        mockApi.saveTask(input)
      }, async () => { await serverRequest(`/tasks/${segment(input.id)}`, 'PATCH', input) })
    },
    saveWorkflow: (workflow: Workflow): Promise<void> => {
      const input = clone(workflow)
      return run(() => {
        mockApi.saveWorkflow(input)
      }, async () => {
        const exists = db.value.workflows.some(row => row.id === input.id)
        await serverRequest(exists ? `/workflows/${segment(input.id)}` : '/workflows', exists ? 'PATCH' : 'POST', {
          name: input.name, description: input.description, provider: input.provider, type: input.type,
          mapping: input.mapping, status: input.active ? 'ACTIVE' : 'DRAFT',
        })
      })
    },
    deleteAsset: (id: string): Promise<void> =>
      run(() => {
        mockApi.deleteAsset(id)
      }, async () => { await serverRequest(`/assets/${segment(id)}`, 'DELETE') }),
    saveSettings: (settings: Settings): Promise<void> => {
      const input = clone(settings)
      return run(() => {
        mockApi.saveSettings(input)
      }, async () => { await serverRequest('/settings', 'PUT', input) })
    },
    saveQualityConfigs: (configs: QualityGateConfig[]): Promise<QualityGateConfig[]> => {
      const input = clone(configs)
      return run(() => mockApi.saveQualityConfigs(input),
        () => serverRequest<QualityGateConfig[]>('/quality-configs', 'PUT', input))
    },
    toggleModel: (id: string): Promise<void> =>
      run(() => {
        mockApi.toggleModel(id)
      }, async () => { await serverRequest(`/models/${segment(id)}`, 'PATCH', { enabled: !db.value.models.find(model => model.id === id)?.enabled }) }),
    refresh,
    loadDemo: (): Promise<void> =>
      run(() => {
        mockApi.loadDemo()
      }),
  }
})

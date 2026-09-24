import { computed } from 'vue'
import { useFactoryStore } from '../../stores/factory'
import type { ComfyUIExecution } from '../../types'

// 页面侧预期契约：缺失字段不回填演示数据，不改动 store/types/services。
export type ExecutionState = 'RUNNING' | 'QUEUED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type HealthKey = 'API' | 'WebSocket' | 'GPU' | 'VRAM' | 'Workflow' | 'Model'
export interface HealthReading {
  status: 'Healthy' | 'Unhealthy' | 'Mock' | 'Unavailable'
  detail?: string
  checkedAt?: string
}
export interface EngineInstance {
  id: string
  name: string
  endpoint: string
  enabled: boolean
  connected: boolean
  health?: Partial<Record<HealthKey, HealthReading>>
}
export interface ExecutionLog {
  id: string
  time: string
  event: 'Submit' | 'Queue' | 'Node Start' | 'Node Complete' | 'Error' | 'Output' | 'Complete'
  message: string
  errorType?: 'SYSTEM_ERROR' | 'QUALITY_FAILED'
}
export interface EngineExecution {
  id: string
  workflow: string
  instanceId: string
  state: ExecutionState
  priority?: number
  concurrency?: number
  createdAt?: string
  mock?: boolean
  errorType?: 'SYSTEM_ERROR' | 'QUALITY_FAILED'
  logs?: ExecutionLog[]
  files?: ComfyUIExecution['files']
  errorMessage?: string
}
export const states: ExecutionState[] = ['RUNNING', 'QUEUED', 'COMPLETED', 'FAILED', 'CANCELLED']
export const healthKeys: HealthKey[] = ['API', 'WebSocket', 'GPU', 'VRAM', 'Workflow', 'Model']
export function useEngineAdapter() {
  const store = useFactoryStore()
  const instances = computed<EngineInstance[]>(() =>
    (store.db.comfyInstances ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      endpoint: item.baseUrl,
      enabled: item.enabled,
      connected: item.connected,
      health: {
        API: {
          status:
            item.health.status === 'unknown'
              ? 'Unavailable'
              : item.health.simulated
                ? 'Mock'
                : item.health.status === 'healthy'
                  ? 'Healthy'
                  : 'Unhealthy',
          detail: item.health.message,
          checkedAt: item.health.checkedAt,
        },
      },
    })),
  )
  const executions = computed<EngineExecution[]>(() =>
    (store.db.comfyExecutions ?? []).map((item) => ({
      id: item.id,
      workflow:
        store.db.workflows.find((workflow) => workflow.id === item.workflowId)?.name ?? item.workflowId,
      instanceId: item.instanceId,
      state: item.status === 'SUCCESS' ? 'COMPLETED' : item.status === 'SKIPPED' ? 'CANCELLED' : item.status,
      createdAt: item.createdAt,
      files: item.files,
      errorMessage: item.error?.message,
      errorType:
        item.error?.type === 'quality'
          ? 'QUALITY_FAILED'
          : item.error && item.error.type !== 'cancelled'
            ? 'SYSTEM_ERROR'
            : undefined,
    })),
  )
  const queueAvailable = computed(() => true)
  const summary = computed(() => [
    ...(['LLM', 'Vision'] as const).map((capability) => {
      const enabled = store.db.models.filter((model) => model.capability === capability && model.enabled)
      return {
        name: capability === 'LLM' ? 'LLM 文本服务' : '视觉理解服务',
        value: enabled.some((model) => /mock/i.test(`${model.provider} ${model.name}`))
          ? 'Mock · 已启用配置'
          : enabled.length
            ? '状态未知 · 未实测'
            : '不可用 · 无启用配置',
      }
    }),
    {
      name: 'ComfyUI引擎',
      value: instances.value.length
        ? `${instances.value.length} 个实例 · ${instances.value.filter((item) => item.health?.API?.status === 'Healthy').length} 个 HTTP 探测通过`
        : '未配置 · 请创建实例',
    },
    { name: 'GPU / VRAM', value: '不可用 · 不提供汇总硬件遥测' },
    {
      name: '执行队列',
      value: queueAvailable.value
        ? `${executions.value.filter((row) => ['RUNNING', 'QUEUED'].includes(row.state)).length} 个活动执行（store）`
        : '不可用 · 未接入执行接口',
    },
  ])
  return { store, instances, executions, queueAvailable, summary }
}

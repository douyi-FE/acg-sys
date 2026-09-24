import type {
  ComfyUIEngineDatabase,
  ComfyUIExecution,
  ComfyUIHealth,
  ComfyUIInstance,
  ComfyUIQueueItem,
} from '../types'
import type { JsonValue } from '../providers/contracts'
import type { ComfyOptions } from '../providers/comfyui'
import { ComfyUIAdapter, applyMapping } from '../providers/comfyui'
import { clone, now, uid } from './seed'
import { record } from './validation'
import type { WorkflowVersionRegistry } from '../workflow/versions'

export interface EngineConfiguration extends Omit<ComfyOptions, 'baseUrl'> {
  allowNetwork?: boolean
  workflowVersion?: string
  workflowRevisionId?: string
}
export type EngineTransport = Pick<EngineConfiguration, 'fetch' | 'allowNetwork' | 'timeout' | 'pollInterval'>
export class ComfyUIEngine {
  private readonly controllers = new Map<string, AbortController>()
  private readonly configurations = new Map<string, EngineConfiguration>()
  private readonly realHealthy = new Set<string>()
  private key(instanceId: string, workflowId: string): string {
    return JSON.stringify([instanceId, workflowId])
  }
  listInstances(db: ComfyUIEngineDatabase): ComfyUIInstance[] {
    return clone(db.comfyInstances ?? [])
  }
  createInstance(db: ComfyUIEngineDatabase, input: Omit<ComfyUIInstance, 'health'>): ComfyUIInstance {
    this.validateUrl(input.baseUrl)
    if (!input.id.trim() || !input.name.trim()) throw new Error('ComfyUI 实例 ID/名称不能为空')
    if (db.comfyInstances?.some((item) => item.id === input.id))
      throw new Error(`ComfyUI 实例已存在：${input.id}`)
    const instance: ComfyUIInstance = {
      ...input,
      health: { status: 'unknown', checkedAt: now(), simulated: true, message: '尚未探测' },
    }
    ;(db.comfyInstances ??= []).push(instance)
    return clone(instance)
  }
  updateInstance(db: ComfyUIEngineDatabase, input: ComfyUIInstance): ComfyUIInstance {
    this.validateUrl(input.baseUrl)
    const instance = this.instance(db, input.id)
    if (this.queue(db).some((e) => e.instanceId === input.id)) throw new Error('队列中实例不可修改')
    Object.assign(instance, clone(input), {
      health: { status: 'unknown', checkedAt: now(), simulated: true, message: '配置更新后需重新探测' },
    })
    this.realHealthy.delete(input.id)
    return clone(instance)
  }
  deleteInstance(db: ComfyUIEngineDatabase, id: string): void {
    this.instance(db, id)
    if (this.queue(db).some((e) => e.instanceId === id)) throw new Error('队列中实例不可删除')
    db.comfyInstances = (db.comfyInstances ?? []).filter((item) => item.id !== id)
    this.realHealthy.delete(id)
    for (const key of this.configurations.keys())
      if ((JSON.parse(key) as string[])[0] === id) this.configurations.delete(key)
  }
  /** 默认纯本地 mock probe；模拟健康不能授权真实执行。 */
  health(db: ComfyUIEngineDatabase, id: string, probe = false): ComfyUIHealth {
    const instance = this.instance(db, id)
    this.realHealthy.delete(id)
    instance.health = {
      status: probe && instance.enabled && instance.connected ? 'healthy' : 'unhealthy',
      checkedAt: now(),
      simulated: true,
      message: 'Mock probe；未发起网络请求',
    }
    return clone(instance.health)
  }
  async probe(
    db: ComfyUIEngineDatabase,
    id: string,
    fetcher: typeof fetch,
    timeout = 5000,
  ): Promise<ComfyUIHealth> {
    const instance = this.instance(db, id)
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('探测超时必须为正数')
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (!instance.enabled || !instance.connected) throw new Error('实例未连接或未启用')
      await Promise.race([
        (async () => {
          const response = await fetcher(`${instance.baseUrl.replace(/\/$/, '')}/system_stats`, {
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`健康探测 HTTP ${response.status}`)
          const body: unknown = await response.json()
          if (
            !record(body) ||
            !record(body.system) ||
            !Array.isArray(body.devices) ||
            !body.devices.every(
              (device) =>
                record(device) &&
                typeof device.name === 'string' &&
                typeof device.type === 'string' &&
                typeof device.vram_total === 'number' &&
                Number.isFinite(device.vram_total) &&
                device.vram_total >= 0,
            )
          ) {
            throw new Error('健康探测 system_stats body 无效：需要 system 和 devices')
          }
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new Error('健康探测 timeout'))
          }, timeout)
        }),
      ])
      instance.health = {
        status: 'healthy',
        checkedAt: now(),
        simulated: false,
        message: 'HTTP 健康探测通过',
      }
      this.realHealthy.add(id)
    } catch (error) {
      this.realHealthy.delete(id)
      instance.health = {
        status: 'unhealthy',
        checkedAt: now(),
        simulated: false,
        message: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timer)
    }
    return clone(instance.health)
  }
  configure(instanceId: string, workflowId: string, config: EngineConfiguration): void {
    if (!Object.keys(config.mapping).length) throw new Error('ComfyUI Mapping 不能为空')
    applyMapping(config.workflow, config.mapping, {})
    this.configurations.set(this.key(instanceId, workflowId), {
      ...config,
      workflow: clone(config.workflow),
      mapping: { ...config.mapping },
    })
  }
  configureActive(
    instanceId: string,
    workflowId: string,
    versions: WorkflowVersionRegistry,
    transport: EngineTransport = {},
  ): void {
    const revision = versions.active(workflowId)
    if (!revision?.apiWorkflow) throw new Error('缺少 active API snapshot；UI-only 工作流不可执行')
    this.configure(instanceId, workflowId, {
      ...transport,
      workflow: revision.apiWorkflow,
      mapping: revision.mapping,
      workflowVersion: revision.version,
      workflowRevisionId: revision.id,
    })
  }
  queue(db: ComfyUIEngineDatabase): ComfyUIQueueItem[] {
    const queue: ComfyUIQueueItem[] = []
    for (const item of db.comfyExecutions ?? [])
      if (item.status === 'QUEUED' || item.status === 'RUNNING') {
        queue.push({
          executionId: item.id,
          instanceId: item.instanceId,
          status: item.status,
          position: queue.length,
        })
      }
    return queue
  }
  executions(db: ComfyUIEngineDatabase): ComfyUIExecution[] {
    return clone(db.comfyExecutions ?? [])
  }
  enqueue(
    db: ComfyUIEngineDatabase,
    instanceId: string,
    workflowId: string,
    inputs: Record<string, JsonValue>,
    taskId?: string,
    stageId?: string,
  ): ComfyUIExecution {
    const instance = this.instance(db, instanceId)
    if (!instance.enabled || !instance.connected || instance.health.status !== 'healthy')
      throw new Error('ComfyUI 实例未健康，拒绝入队')
    const config = this.configurations.get(this.key(instanceId, workflowId))
    if (!config) throw new Error('ComfyUI 工作流未配置')
    applyMapping(config.workflow, config.mapping, inputs, config.requiredInputs)
    const execution: ComfyUIExecution = {
      id: uid('comfy-exec'),
      instanceId,
      workflowId,
      workflowVersion: config.workflowVersion,
      workflowRevisionId: config.workflowRevisionId,
      status: 'QUEUED',
      createdAt: now(),
      updatedAt: now(),
      inputs: clone(inputs),
      taskId,
      stageId,
      files: [],
    }
    ;(db.comfyExecutions ??= []).push(execution)
    return clone(execution)
  }
  cancel(db: ComfyUIEngineDatabase, id: string): ComfyUIExecution {
    const execution = this.execution(db, id)
    if (!['QUEUED', 'RUNNING'].includes(execution.status)) return clone(execution)
    execution.status = 'CANCELLED'
    execution.updatedAt = now()
    execution.error = {
      code: 'CANCELLED',
      type: 'cancelled',
      message: '本地请求取消；不保证远端 GPU 作业已停止',
      retryable: false,
    }
    this.controllers.get(id)?.abort()
    return clone(execution)
  }
  async run(
    db: ComfyUIEngineDatabase,
    id: string,
    signal?: AbortSignal,
    onChange?: (execution: ComfyUIExecution) => void,
  ): Promise<ComfyUIExecution> {
    const execution = this.execution(db, id)
    if (execution.status !== 'QUEUED') throw new Error('仅排队执行可以运行')
    const instance = this.instance(db, execution.instanceId)
    const config = this.configurations.get(this.key(instance.id, execution.workflowId))
    if (!config || (!config.fetch && !config.allowNetwork)) throw new Error('真实网络执行未显式配置')
    if (execution.workflowRevisionId !== config.workflowRevisionId)
      throw new Error('active snapshot 已变化，请重新入队')
    if (
      !instance.enabled ||
      !instance.connected ||
      instance.health.status !== 'healthy' ||
      instance.health.simulated ||
      !this.realHealthy.has(instance.id)
    )
      throw new Error('ComfyUI 需通过真实健康探测')
    const adapter = new ComfyUIAdapter({ ...config, baseUrl: instance.baseUrl })
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    this.controllers.set(id, controller)
    execution.status = 'RUNNING'
    execution.updatedAt = now()
    try {
      onChange?.(clone(execution))
      const result = await adapter.generate(execution.inputs, controller.signal, (promptId) => {
        execution.promptId = promptId
        execution.updatedAt = now()
        onChange?.(clone(execution))
      })
      if (!controller.signal.aborted) {
        execution.status = 'SUCCESS'
        execution.promptId = result.promptId
        execution.files = result.files
      }
    } catch (error) {
      execution.status = controller.signal.aborted ? 'CANCELLED' : 'FAILED'
      execution.error = {
        code: execution.status === 'CANCELLED' ? 'CANCELLED' : 'COMFYUI_EXECUTION_FAILED',
        type: controller.signal.aborted
          ? 'cancelled'
          : error instanceof Error && /timeout/i.test(error.message)
            ? 'timeout'
            : 'system',
        message: error instanceof Error ? error.message : String(error),
        retryable: !controller.signal.aborted,
      }
    } finally {
      execution.updatedAt = now()
      this.controllers.delete(id)
      signal?.removeEventListener('abort', abort)
    }
    onChange?.(clone(execution))
    return clone(execution)
  }
  private instance(db: ComfyUIEngineDatabase, id: string): ComfyUIInstance {
    const instance = db.comfyInstances?.find((i) => i.id === id)
    if (!instance) throw new Error('ComfyUI 实例不存在')
    return instance
  }
  private execution(db: ComfyUIEngineDatabase, id: string): ComfyUIExecution {
    const execution = db.comfyExecutions?.find((e) => e.id === id)
    if (!execution) throw new Error('ComfyUI 执行不存在')
    return execution
  }
  private validateUrl(base: string): void {
    const url = new URL(base)
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password)
      throw new Error('ComfyUI 地址无效')
  }
}

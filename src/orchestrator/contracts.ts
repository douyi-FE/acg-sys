import type {
  Database,
  PipelineStageDefinition,
  ProviderKind,
  ProviderRegistration,
  VideoTask,
  WorkflowKind,
} from '../types'

export interface StageContext {
  db: Database
  task: VideoTask
  stage: PipelineStageDefinition
  time: number
}
/** 同步调度读取已完成的真实 Engine 产物；网络执行由 ComfyUIEngine 异步负责。 */
export interface StageExecutor extends ProviderRegistration {
  execute(context: StageContext): string
}
export interface ProviderRegistryContract {
  register(executor: StageExecutor): void
  resolve(provider: ProviderKind, kind: WorkflowKind): StageExecutor
  list(): ProviderRegistration[]
}

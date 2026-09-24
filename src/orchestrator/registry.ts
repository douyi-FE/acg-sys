import type { ProviderKind, ProviderRegistration, WorkflowKind } from '../types'
import type { ProviderRegistryContract, StageExecutor } from './contracts'

export class ProviderRegistry implements ProviderRegistryContract {
  private readonly executors = new Map<ProviderKind, StageExecutor>()
  register(executor: StageExecutor): void {
    if (this.executors.has(executor.provider)) throw new Error(`Provider 已注册：${executor.provider}`)
    if (!executor.workflowKinds.length) throw new Error('Provider 必须声明工作流能力')
    this.executors.set(executor.provider, {
      ...executor,
      workflowKinds: [...executor.workflowKinds],
      execute: executor.execute.bind(executor),
    })
  }
  resolve(provider: ProviderKind, kind: WorkflowKind): StageExecutor {
    const executor = this.executors.get(provider)
    if (!executor || !executor.workflowKinds.includes(kind))
      throw new Error(`Provider ${provider} 不支持 ${kind}`)
    return { ...executor, workflowKinds: [...executor.workflowKinds] }
  }
  list(): ProviderRegistration[] {
    return [...this.executors.values()].map(({ provider, workflowKinds }) => ({
      provider,
      workflowKinds: [...workflowKinds],
    }))
  }
}

import { HttpApiClient, segment } from './http'
import type { RequestOptions } from './types'
import type {
  PipelineDefinition,
  StageExecution,
  ProductionTrace,
  ComfyUIInstance,
  ComfyUIExecution,
} from '../types'

/** Transport contract only. No HTTP backend is started by the local Mock workspace. */
export class EngineHttpApiClient extends HttpApiClient {
  pipelines(options?: RequestOptions): Promise<PipelineDefinition[]> {
    return this.request('GET', '/engine/pipelines', options)
  }
  executions(taskId: string, options?: RequestOptions): Promise<StageExecution[]> {
    return this.request('GET', `/tasks/${segment(taskId)}/executions`, options)
  }
  traces(taskId: string, options?: RequestOptions): Promise<ProductionTrace[]> {
    return this.request('GET', `/tasks/${segment(taskId)}/traces`, options)
  }
  instances(options?: RequestOptions): Promise<ComfyUIInstance[]> {
    return this.request('GET', '/engines/comfyui/instances', options)
  }
  createInstance(
    instance: Omit<ComfyUIInstance, 'health'>,
    options?: RequestOptions,
  ): Promise<ComfyUIInstance> {
    return this.request('POST', '/engines/comfyui/instances', options, instance)
  }
  deleteInstance(id: string, options?: RequestOptions): Promise<void> {
    return this.request('DELETE', `/engines/comfyui/instances/${segment(id)}`, options)
  }
  saveInstance(instance: ComfyUIInstance, options?: RequestOptions): Promise<ComfyUIInstance> {
    return this.request('PUT', `/engines/comfyui/instances/${segment(instance.id)}`, options, instance)
  }
  probeInstance(id: string, options?: RequestOptions): Promise<ComfyUIInstance> {
    return this.request('POST', `/engines/comfyui/instances/${segment(id)}/health`, options)
  }
  queue(options?: RequestOptions): Promise<ComfyUIExecution[]> {
    return this.request('GET', '/engines/comfyui/queue', options)
  }
  execution(id: string, options?: RequestOptions): Promise<ComfyUIExecution> {
    return this.request('GET', `/engines/comfyui/executions/${segment(id)}`, options)
  }
  cancelExecution(id: string, options?: RequestOptions): Promise<ComfyUIExecution> {
    return this.request('POST', `/engines/comfyui/executions/${segment(id)}/cancel`, options)
  }
}

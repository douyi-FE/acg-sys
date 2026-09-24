import type { WorkflowMapping } from '../../src/providers/comfyui'

/** 未配置占位：必须依据用户真实的 API Workflow 填入，不猜测 ComfyUI 节点编号。 */
export const mapping: WorkflowMapping = {}
export const semanticInputs = ['prompt', 'width', 'height', 'duration', 'seed', 'firstFrame', 'lastFrame'] as const
export const requiredInputs = ['prompt', 'width', 'height', 'duration', 'seed']
export const workflowMetadata = {
  id: 'minimax-h3-video-v1',
  configured: false,
  format: 'ComfyUI API Workflow',
  durationUnit: 'requires-node-documentation',
} as const

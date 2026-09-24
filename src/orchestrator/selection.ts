import type { AIModel, Database, PipelineStageDefinition, VideoTask, Workflow, WorkflowKind } from '../types'
import { assertEnabled, isTextWorkflow } from '../services/validation'

const capabilities: Record<WorkflowKind, AIModel['capability']> = {
  text: 'LLM',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  vision: 'Vision',
  embedding: 'Embedding',
}

export function workflowMatches(workflow: Workflow, kind: WorkflowKind): boolean {
  if (kind === 'text') return isTextWorkflow(workflow.type)
  const output = workflow.type
    .trim()
    .toLowerCase()
    .split(/\s+to\s+/)
    .at(-1)
  return output === kind
}

/** Explicit bindings win; task defaults apply only when their capability matches the stage.
 * No synthetic model IDs and no automatic fallback from a real provider to Mock. */
export function selectStage(
  db: Database,
  task: Pick<VideoTask, 'modelId' | 'workflowId'>,
  stage: PipelineStageDefinition,
) {
  const primaryModel = db.models.find((m) => m.id === task.modelId)
  const explicitModel = db.models.find((m) => m.id === stage.modelId)
  const explicitWorkflow = db.workflows.find((w) => w.id === stage.workflowId)
  const provider =
    stage.provider ??
    explicitModel?.provider ??
    explicitWorkflow?.provider ??
    primaryModel?.provider ??
    'Mock'
  const capability = capabilities[stage.workflowKind]
  const model = stage.modelId
    ? explicitModel
    : primaryModel?.provider === provider && primaryModel.capability === capability
      ? primaryModel
      : db.models.find((m) => m.provider === provider && m.capability === capability && m.enabled)
  const primaryWorkflow = db.workflows.find((w) => w.id === task.workflowId)
  const workflow = stage.workflowId
    ? explicitWorkflow
    : primaryWorkflow?.provider === provider && workflowMatches(primaryWorkflow, stage.workflowKind)
      ? primaryWorkflow
      : db.workflows.find(
          (w) => w.provider === provider && w.active && workflowMatches(w, stage.workflowKind),
        )
  if (!model || !workflow)
    throw new Error(
      `阶段 ${stage.key} 缺少已注册的 ${provider} ${capability}/${stage.workflowKind} 模型或工作流`,
    )
  if (model.provider !== provider || workflow.provider !== provider)
    throw new Error(`阶段 ${stage.key} Provider 不匹配`)
  // Real ComfyUI graphs may combine capabilities; only the Mock executor uses single-capability models.
  if (
    provider === 'Mock' &&
    (model.capability !== capability || !workflowMatches(workflow, stage.workflowKind))
  ) {
    throw new Error(`阶段 ${stage.key} 显式配置能力不匹配：需要 ${capability}/${stage.workflowKind}`)
  }
  assertEnabled(db, model.id, workflow.id)
  return { modelId: model.id, workflowId: workflow.id, provider }
}

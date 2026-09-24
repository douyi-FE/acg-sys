import type { PipelineDefinition, WorkflowKind } from '../types'
import { createStages } from '../services/seed'

const kinds: Record<string, WorkflowKind> = {
  IMAGE: 'image',
  VIDEO: 'video',
  COMPOSE: 'video',
  AUDIO: 'audio',
  QA: 'vision',
}
export function pipelineDefinitions(): PipelineDefinition[] {
  return (['video', 'article'] as const).map((kind) => ({
    id: `${kind}-pipeline`,
    kind,
    version: '1.0.0',
    stages: createStages(kind).map((stage) => ({
      id: stage.key,
      key: stage.key,
      name: stage.name,
      workflowKind: kinds[stage.key] ?? 'text',
      optional: ['AUDIO', 'SUBTITLE'].includes(stage.key),
      manual: ['PUBLISH', 'FINAL_REVIEW'].includes(stage.key),
    })),
  }))
}

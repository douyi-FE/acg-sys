import type { Asset, Task, Workflow } from '@prisma/client'
import type { RequestUser } from './permissions'

export function taskProjection(user: RequestUser, row: Task): Task {
  if (row.userId === user.id || user.permissions.includes('tasks.manage')) return row
  return {
    id: row.id, title: row.title, kind: row.kind, status: row.status, progress: row.progress,
    isPublic: row.isPublic, createdAt: row.createdAt, updatedAt: row.updatedAt,
    userId: '', stageIndex: 0, stages: [], request: {}, metadata: null, modelId: null, workflowId: null,
    pipelineId: null, script: '', previousScript: '', characters: [], shots: [], quality: null,
    logs: [], cover: '', elapsed: 0, estimated: 0, retries: 0, approved: false, error: null,
  }
}
export function assetProjection(user: RequestUser, row: Asset): Asset {
  const privateRead = row.userId === user.id || user.permissions.includes('assets.manage')
  return {
    id: row.id, name: row.name, type: row.type, mimeType: row.mimeType, createdAt: row.createdAt,
    isPublic: row.isPublic, userId: privateRead ? row.userId : '',
    taskId: privateRead ? row.taskId : null, executionId: privateRead ? row.executionId : null,
    metadata: privateRead ? row.metadata : {}, storagePath: null,
  }
}
export function workflowProjection(user: RequestUser, row: Workflow): Workflow {
  if (user.permissions.includes('workflows.update')) return row
  return {
    id: row.id, name: row.name, description: row.description, provider: row.provider, type: row.type,
    instanceId: row.instanceId, status: row.status, version: row.version,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    workflowJson: null, apiWorkflowJson: null, mapping: null, metadata: null,
  }
}
export function serviceProjection<T extends { id: string; name: string; kind: string; enabled: boolean; health: unknown; baseUrl: string }>(user: RequestUser, row: T) {
  const health = row.health && typeof row.health === 'object' ? row.health as Record<string, unknown> : {}
  return {
    id: row.id, name: row.name, kind: row.kind, enabled: row.enabled,
    baseUrl: user.permissions.includes('providers.update') ? row.baseUrl : '',
    health: { ok: health.ok === true, checkedAt: typeof health.checkedAt === 'string' ? health.checkedAt : '' },
  }
}

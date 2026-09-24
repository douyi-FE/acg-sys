import { serverRequest } from '../api/session'
import { segment } from '../api/http'
import type { WorkflowHistory, WorkflowRevision } from './versions'
import { applyMapping } from '../providers/comfyui'

interface Snapshot {
  id: string
  workflowId: string
  version: string
  createdAt: string
  apiWorkflowJson: WorkflowRevision['apiWorkflow']
  workflowJson: WorkflowRevision['uiWorkflow']
  mapping: WorkflowRevision['mapping'] | null
}
interface ServerWorkflow {
  version: string
  status: string
  versions: Snapshot[]
}
// The backend has GET/PATCH /workflows/:id, not a /versions controller.
// Every PATCH appends a server-numbered snapshot, including restore/activation.
export async function serverHistory(id: string): Promise<WorkflowHistory> {
  const row = await serverRequest<ServerWorkflow>(`/workflows/${segment(id)}`)
  return {
    workflowId: id,
    activeRevisionId: row.status === 'ACTIVE' ? row.versions.find(v => v.version === row.version)?.id ?? null : null,
    revisions: row.versions.map(v => ({
      id: v.id, workflowId: id, version: v.version, createdAt: v.createdAt,
      note: '后端编号快照', apiWorkflow: v.apiWorkflowJson && Object.keys(v.apiWorkflowJson).length ? v.apiWorkflowJson : null,
      uiWorkflow: v.workflowJson && Array.isArray(v.workflowJson.nodes) ? v.workflowJson : null,
      mapping: v.mapping ?? {},
    })),
  }
}
export async function saveServerSnapshot(id: string, snapshot: Pick<WorkflowRevision, 'apiWorkflow' | 'uiWorkflow' | 'mapping'>, active = false) {
  if (!snapshot.apiWorkflow && !snapshot.uiWorkflow) throw new Error('至少导入 UI Workflow 或 API Workflow')
  if (snapshot.apiWorkflow) applyMapping(snapshot.apiWorkflow, snapshot.mapping, {})
  if (active && (!snapshot.apiWorkflow || !Object.keys(snapshot.mapping).length)) throw new Error('激活需要 API Workflow 与语义 Mapping')
  return serverRequest(`/workflows/${segment(id)}`, 'PATCH', {
    apiWorkflowJson: snapshot.apiWorkflow ?? {}, workflowJson: snapshot.uiWorkflow ?? {},
    mapping: snapshot.mapping, status: active ? 'ACTIVE' : 'DRAFT',
  })
}

import { applyMapping, parseApiWorkflow, type ApiWorkflow, type WorkflowMapping } from '../providers/comfyui'
import type { Workflow } from '../types'

export interface WorkflowRevision {
  id: string
  workflowId: string
  version: string
  createdAt: string
  note: string
  apiWorkflow: ApiWorkflow | null
  uiWorkflow: Record<string, unknown> | null
  mapping: WorkflowMapping
}

export interface WorkflowHistory {
  workflowId: string
  activeRevisionId: string | null
  revisions: WorkflowRevision[]
}

export const VERSION_STORAGE_KEY = 'acg-workflow-versions-v1'
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export function parseWorkflowImport(text: string): {
  kind: 'ui' | 'api'
  value: Record<string, unknown> | ApiWorkflow
} {
  const value: unknown = JSON.parse(text)
  if (!object(value)) throw new Error('Workflow 必须为 JSON 对象')
  if (Array.isArray(value.nodes)) return { kind: 'ui', value }
  return { kind: 'api', value: parseApiWorkflow(value) }
}

export function parseMapping(text: string): WorkflowMapping {
  const value: unknown = JSON.parse(text)
  if (!object(value) || Object.values(value).some((item) => typeof item !== 'string'))
    throw new Error('Mapping 必须为语义参数到 nodeId.inputs.field 的字符串字典')
  return value as WorkflowMapping
}

/** Exported snapshots can be imported without confusing them with an API node graph. */
export function parseWorkflowSnapshot(
  text: string,
): Omit<WorkflowRevision, 'id' | 'workflowId' | 'createdAt'> | null {
  const value: unknown = JSON.parse(text)
  if (!object(value) || !('apiWorkflow' in value) || !('mapping' in value)) return null
  if (typeof value.version !== 'string' || typeof value.note !== 'string')
    throw new Error('Workflow 快照缺少版本号或说明')
  const apiWorkflow = value.apiWorkflow === null ? null : parseApiWorkflow(value.apiWorkflow)
  const uiWorkflow = value.uiWorkflow
  if (uiWorkflow !== null && (!object(uiWorkflow) || !Array.isArray(uiWorkflow.nodes)))
    throw new Error('Workflow 快照中的 UI 画布不合法')
  if (!apiWorkflow && !uiWorkflow) throw new Error('Workflow 快照不包含 API 或 UI 文件')
  const mapping = parseMapping(JSON.stringify(value.mapping))
  if (apiWorkflow) applyMapping(apiWorkflow, mapping, {})
  return { version: value.version, note: value.note, apiWorkflow, uiWorkflow, mapping }
}

/** Immutable snapshots; activating/rolling back changes a pointer, never rewrites history. */
export class WorkflowVersionRegistry {
  constructor(private readonly storage: StoragePort = localStorage) {}

  private read(): WorkflowHistory[] {
    const raw = this.storage.getItem(VERSION_STORAGE_KEY)
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) throw new Error('Workflow 版本存储损坏，请先备份；不会重置数据')
    for (const history of value) {
      if (
        !object(history) ||
        typeof history.workflowId !== 'string' ||
        !(history.activeRevisionId === null || typeof history.activeRevisionId === 'string') ||
        !Array.isArray(history.revisions)
      )
        throw new Error('Workflow 版本记录不合法')
      const ids = new Set<string>()
      for (const revision of history.revisions) {
        if (
          !object(revision) ||
          typeof revision.id !== 'string' ||
          typeof revision.version !== 'string' ||
          typeof revision.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(revision.createdAt)) ||
          typeof revision.note !== 'string' ||
          revision.workflowId !== history.workflowId ||
          !object(revision.mapping) ||
          Object.values(revision.mapping).some((v) => typeof v !== 'string') ||
          (revision.apiWorkflow !== null && !object(revision.apiWorkflow)) ||
          (revision.uiWorkflow !== null && !object(revision.uiWorkflow))
        )
          throw new Error('Workflow 快照不合法')
        if (ids.has(revision.id)) throw new Error('Workflow revision ID 重复')
        if (revision.apiWorkflow) {
          parseApiWorkflow(revision.apiWorkflow)
          applyMapping(revision.apiWorkflow, revision.mapping as WorkflowMapping, {})
        }
        if (revision.uiWorkflow && !Array.isArray(revision.uiWorkflow.nodes))
          throw new Error('Workflow UI 快照缺少 nodes')
        ids.add(revision.id)
      }
      if (history.activeRevisionId && !ids.has(history.activeRevisionId))
        throw new Error('活动版本引用不存在')
    }
    return copy(value as WorkflowHistory[])
  }

  list(workflowId: string): WorkflowHistory {
    return (
      this.read().find((item) => item.workflowId === workflowId) ?? {
        workflowId,
        activeRevisionId: null,
        revisions: [],
      }
    )
  }

  import(
    workflow: Workflow,
    input: Omit<WorkflowRevision, 'id' | 'workflowId' | 'createdAt'>,
  ): WorkflowRevision {
    if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(input.version))
      throw new Error('请输入语义版本号，如 1.0.0')
    if (!input.apiWorkflow && !input.uiWorkflow) throw new Error('至少导入 UI Workflow 或 API Workflow')
    if (input.uiWorkflow && !Array.isArray(input.uiWorkflow.nodes))
      throw new Error('UI Workflow 必须包含 nodes 数组')
    if (input.apiWorkflow) {
      parseApiWorkflow(input.apiWorkflow)
      applyMapping(input.apiWorkflow, input.mapping, {})
    }
    const all = this.read()
    const history = all.find((item) => item.workflowId === workflow.id) ?? {
      workflowId: workflow.id,
      activeRevisionId: null,
      revisions: [],
    }
    if (history.revisions.some((revision) => revision.version === input.version))
      throw new Error('此版本已存在，请创建新版本；历史快照不可覆盖')
    const revision: WorkflowRevision = {
      ...copy(input),
      id: crypto.randomUUID(),
      workflowId: workflow.id,
      createdAt: new Date().toISOString(),
    }
    history.revisions.push(revision)
    if (!all.includes(history)) all.push(history)
    this.storage.setItem(VERSION_STORAGE_KEY, JSON.stringify(all))
    return copy(revision)
  }

  activate(workflowId: string, revisionId: string | null): void {
    const all = this.read()
    const history = all.find((item) => item.workflowId === workflowId)
    if (!history) throw new Error('尚无可激活的 Workflow 版本')
    if (revisionId) {
      const revision = history.revisions.find((item) => item.id === revisionId)
      if (!revision?.apiWorkflow) throw new Error('只有 UI Workflow，不能提交 ComfyUI；请导入 API Workflow')
      if (!Object.keys(revision.mapping).length) throw new Error('请配置语义 Mapping 后再激活')
      applyMapping(revision.apiWorkflow, revision.mapping, {})
    }
    history.activeRevisionId = revisionId
    this.storage.setItem(VERSION_STORAGE_KEY, JSON.stringify(all))
  }

  rollback(workflowId: string, revisionId: string): void {
    this.activate(workflowId, revisionId)
  }

  active(workflowId: string): WorkflowRevision | undefined {
    const history = this.list(workflowId)
    return history.revisions.find((item) => item.id === history.activeRevisionId)
  }
}

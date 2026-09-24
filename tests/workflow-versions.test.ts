import { describe, expect, it } from 'vitest'
import {
  parseMapping,
  parseWorkflowImport,
  parseWorkflowSnapshot,
  WorkflowVersionRegistry,
} from '../src/workflow/versions'
import type { Workflow } from '../src/types'

const workflow: Workflow = {
  id: 'wf-test',
  name: '测试 Workflow',
  type: 'Image to Video',
  provider: 'ComfyUI',
  version: '0.1.0',
  active: false,
  mapping: {},
  history: [],
  description: '',
}
const graph = { nodeA: { class_type: 'TestNode', inputs: { text: '', seed: 1 } } }
const mapping = { prompt: 'nodeA.inputs.text', seed: 'nodeA.seed' }
function create() {
  const values = new Map<string, string>()
  return new WorkflowVersionRegistry({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  })
}

describe('immutable Workflow snapshots', () => {
  it('round-trips exported snapshots and validates embedded graphs', () => {
    const registry = create()
    const revision = registry.import(workflow, {
      version: '1.0.0',
      apiWorkflow: graph,
      uiWorkflow: { nodes: [] },
      mapping,
      note: 'portable',
    })
    const parsed = parseWorkflowSnapshot(JSON.stringify(revision))
    expect(parsed).toMatchObject({ version: '1.0.0', apiWorkflow: graph, mapping })
    expect(create().import(workflow, parsed!)).toMatchObject(parsed!)
    expect(parseWorkflowSnapshot(JSON.stringify(graph))).toBeNull()
    expect(() => parseWorkflowSnapshot(JSON.stringify({ ...revision, apiWorkflow: {} }))).toThrow()
    expect(() => parseWorkflowSnapshot(JSON.stringify({ ...revision, uiWorkflow: [] }))).toThrow()
  })
  it('distinguishes UI/API, blocks UI-only activation and invalid mapping', () => {
    expect(parseWorkflowImport('{"nodes":[]}').kind).toBe('ui')
    expect(parseWorkflowImport(JSON.stringify(graph)).kind).toBe('api')
    expect(() => parseMapping('{"prompt":42}')).toThrow()
    const registry = create()
    const revision = registry.import(workflow, {
      version: '1.0.0',
      apiWorkflow: null,
      uiWorkflow: { nodes: [] },
      mapping: {},
      note: 'UI only',
    })
    expect(() => registry.activate(workflow.id, revision.id)).toThrow(/UI Workflow/)
    expect(() =>
      registry.import(workflow, {
        version: '1.0.1',
        apiWorkflow: graph,
        uiWorkflow: null,
        mapping: { prompt: 'missing.field' },
        note: '',
      }),
    ).toThrow()
  })

  it('activates, rolls back without mutating immutable history, and deactivates', () => {
    const registry = create()
    const first = registry.import(workflow, {
      version: '1.0.0',
      apiWorkflow: graph,
      uiWorkflow: null,
      mapping,
      note: 'first',
    })
    const second = registry.import(workflow, {
      version: '1.0.1',
      apiWorkflow: graph,
      uiWorkflow: { nodes: [] },
      mapping,
      note: 'second',
    })
    registry.activate(workflow.id, second.id)
    expect(registry.active(workflow.id)?.version).toBe('1.0.1')
    registry.rollback(workflow.id, first.id)
    expect(registry.active(workflow.id)?.version).toBe('1.0.0')
    expect(registry.list(workflow.id).revisions).toHaveLength(2)
    expect(() => registry.import(workflow, { ...first })).toThrow(/已存在/)
    first.mapping.prompt = 'evil.invalid'
    expect(registry.active(workflow.id)?.mapping.prompt).toBe('nodeA.inputs.text')
    registry.activate(workflow.id, null)
    expect(registry.active(workflow.id)).toBeUndefined()
  })

  it('never silently replaces corrupt storage', () => {
    const registry = new WorkflowVersionRegistry({
      getItem: () => '{"wrong":true}',
      setItem: () => {
        throw new Error('must not write')
      },
    })
    expect(() => registry.list(workflow.id)).toThrow(/损坏/)
  })
})

import { describe, expect, it } from 'vitest'
import { AssetRegistry } from '../src/orchestrator/asset-registry'
import { createSeed } from '../src/services/seed'
import type { Asset, StageExecution } from '../src/types'

const registry = new AssetRegistry()
const asset = (patch: Partial<Asset> = {}): Asset => ({
  id: 'asset-1',
  name: 'image',
  type: '图片',
  url: 'https://example.com/image.png',
  cover: '',
  tags: ['test', 'test'],
  taskId: 'task-1',
  model: 'asset-model',
  createdAt: '2026-09-23T00:00:00.000Z',
  ...patch,
})
type Snapshot = StageExecution & { modelId?: string; prompt?: string; seed?: number }
const execution = (patch: Partial<Snapshot> = {}): Snapshot => ({
  id: 'execution-1',
  taskId: 'task-1',
  pipelineId: 'pipeline-1',
  stageId: 'IMAGE',
  provider: 'Mock',
  workflowId: 'workflow-1',
  workflowVersion: '1.0',
  status: 'SUCCESS',
  attempt: 1,
  traceId: 'trace-1',
  startedAt: '2026-09-23T00:00:00.000Z',
  input: '',
  output: '',
  logs: [],
  ...patch,
})

describe('AssetRegistry', () => {
  it('deduplicates IDs, tags and identical payloads within an execution', () => {
    const db = createSeed()
    const source = execution()
    const first = registry.register(db, asset(), source)
    expect(registry.register(db, asset(), source)).toEqual(first)
    expect(registry.register(db, asset({ id: 'other' }), source).id).toBe(first.id)
    expect(db.assets).toHaveLength(1)
    expect(db.assets[0]?.tags).toEqual(['test'])
  })

  it('keeps different attempts, tasks and payloads separate', () => {
    const db = createSeed()
    registry.register(db, asset(), execution())
    registry.register(db, asset({ id: 'retry' }), execution({ id: 'retry', attempt: 2 }))
    registry.register(
      db,
      asset({ id: 'task-2', taskId: 'task-2' }),
      execution({ id: 'other', taskId: 'task-2' }),
    )
    registry.register(db, asset({ id: 'different', url: 'https://example.com/other.png' }), execution())
    expect(db.assets).toHaveLength(4)
  })

  it.each([
    { taskId: 'other' },
    { pipelineId: 'other' },
    { stageId: 'other' },
    { provider: 'ComfyUI' as const },
    { workflowVersion: 'other' },
    { executionId: 'other' },
    { workflowId: 'other' },
    { traceId: 'other' },
    { attempt: 2 },
  ])('rejects explicit source conflicts without mutation: %j', (patch) => {
    const db = createSeed()
    expect(() => registry.register(db, asset(patch), execution())).toThrow('来源不一致')
    expect(db.assets).toEqual([])
  })

  it('rejects implicit lookup conflicts and ID reuse across attempts', () => {
    const db = createSeed()
    db.executions = [execution()]
    expect(() => registry.register(db, asset({ executionId: 'execution-1', stageId: 'other' }))).toThrow()
    registry.register(db, asset(), execution())
    expect(() => registry.register(db, asset(), execution({ id: 'retry' }))).toThrow('不能覆盖历史来源')
    expect(db.assets).toHaveLength(1)
  })

  it('rejects conflicting provenance on an existing ID even without an execution', () => {
    const db = createSeed()
    registry.register(db, asset({ provider: 'Mock' }))
    expect(() => registry.register(db, asset({ provider: 'ComfyUI' }))).toThrow('不能覆盖历史来源')
    expect(db.assets[0]?.provider).toBe('Mock')
  })

  it('does not infer legacy sources from executions or current task configuration', () => {
    const db = createSeed()
    db.executions = [execution({ modelId: 'historical', prompt: 'historical', seed: 42 })]
    Object.defineProperty(db, 'tasks', {
      get: () => {
        throw new Error('must not read tasks')
      },
    })
    const legacy = asset()
    const before = JSON.stringify(legacy)
    const result = registry.register(db, legacy)
    expect(result.provenance.status).toBe('legacy unavailable')
    expect(result.provenance.executionId).toBeUndefined()
    expect(result.workflowId).toBeUndefined()
    expect(result.provenance.prompt).toBeUndefined()
    expect(result.provenance.seed).toBeUndefined()
    expect(JSON.stringify(legacy)).toBe(before)
    registry.register(db, asset({ id: 'legacy-2' }))
    expect(db.assets).toHaveLength(2)
  })

  it('associates only the explicit execution, not the newest attempt', () => {
    const db = createSeed()
    db.executions = [execution(), execution({ id: 'retry', workflowVersion: '2.0' })]
    const result = registry.register(db, asset({ executionId: 'execution-1' }))
    expect(result.provenance).toMatchObject({
      status: 'tracked',
      taskId: 'task-1',
      pipelineId: 'pipeline-1',
      stageId: 'IMAGE',
      provider: 'Mock',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      workflowVersion: '1.0',
      traceId: 'trace-1',
    })
    expect(registry.resolve(db, db.assets[0]!)).toEqual(result)
  })

  it('prioritizes direct historical snapshots and preserves empty prompt and zero seed', () => {
    const db = createSeed()
    const source = execution({
      modelId: 'historical-model',
      prompt: '',
      seed: 0,
      input: JSON.stringify({ modelId: 'input-model', prompt: 'input', seed: 123 }),
    })
    db.executions = [source]
    Object.defineProperty(db, 'tasks', {
      get: () => {
        throw new Error('must not read tasks')
      },
    })
    const result = registry.register(db, asset({ prompt: 'asset', seed: 456 }), source)
    expect(result.provenance).toMatchObject({
      model: 'historical-model',
      prompt: '',
      seed: 0,
      sources: { model: 'execution', prompt: 'execution', seed: 'execution' },
    })
    expect(db.assets[0]).toMatchObject({ model: 'historical-model', prompt: '', seed: 0 })
    expect(registry.resolve(db, db.assets[0]!).provenance).toEqual(result.provenance)
  })

  it('falls back to historical JSON input, then existing asset fields', () => {
    const db = createSeed()
    const result = registry.register(
      db,
      asset(),
      execution({
        input: JSON.stringify({ modelId: 'input-model', prompt: 'input', seed: 0 }),
      }),
    )
    expect(result.provenance).toMatchObject({ model: 'input-model', prompt: 'input', seed: 0 })
    const fallback = registry.register(
      db,
      asset({ id: 'fallback', prompt: 'asset', seed: 12 }),
      execution({ id: 'fallback', input: 'not JSON' }),
    )
    expect(fallback.provenance).toMatchObject({
      model: 'asset-model',
      prompt: 'asset',
      seed: 12,
      sources: { model: 'asset', prompt: 'asset', seed: 'asset' },
    })
  })

  it('marks missing or inconsistent execution references unavailable without rewriting assets', () => {
    const db = createSeed()
    db.executions = [execution({ taskId: 'other' })]
    for (const id of ['missing', 'execution-1']) {
      const original = asset({ executionId: id })
      expect(registry.resolve(db, original).provenance.status).toBe('legacy unavailable')
      expect(original.executionId).toBe(id)
    }
  })

  it('checks ID collisions before deduplicating against another output', () => {
    const db = createSeed()
    const source = execution()
    registry.register(db, asset(), source)
    registry.register(db, asset({ id: 'second', url: 'https://example.com/second.png' }), source)
    const before = JSON.stringify(db.assets)
    expect(() => registry.register(
      db, asset({ url: 'https://example.com/second.png' }), source,
    )).toThrow('不能覆盖历史来源')
    expect(JSON.stringify(db.assets)).toBe(before)
  })

  it('keeps distinct inline payloads and rejects same-ID content replacement', () => {
    const db = createSeed()
    const source = execution()
    registry.register(db, asset({ url: '', content: 'first' }), source)
    registry.register(db, asset({ id: 'second', url: '', content: 'second' }), source)
    expect(db.assets).toHaveLength(2)
    expect(() => registry.register(db, asset({ url: '', content: 'changed' }), source)).toThrow()
    expect(db.assets[0]?.content).toBe('first')
  })

  it.each(['null', '[]', '{"modelId":12,"prompt":false,"seed":"0"}'])(
    'ignores invalid historical input fields: %s', (input) => {
      const db = createSeed()
      const result = registry.register(db, asset({ prompt: '', seed: 0 }), execution({ input }))
      expect(result.provenance).toMatchObject({
        model: 'asset-model', prompt: '', seed: 0,
        sources: { model: 'asset', prompt: 'asset', seed: 'asset' },
      })
    },
  )

  it('does not retain caller-owned tags or change them during registration', () => {
    const db = createSeed()
    const original = asset()
    const before = JSON.stringify(original)
    const result = registry.register(db, original, execution())
    expect(JSON.stringify(original)).toBe(before)
    original.tags.push('caller')
    result.tags.push('view')
    expect(db.assets[0]?.tags).toEqual(['test'])
  })
})

import type { Asset, Database, StageExecution } from '../types'

type SnapshotSource = 'execution' | 'input' | 'asset'
export interface AssetProvenance {
  status: 'tracked' | 'legacy unavailable'
  taskId: string
  pipelineId?: string
  stageId?: string
  provider?: Asset['provider']
  executionId?: string
  workflowId?: string
  workflowVersion?: string
  traceId?: string
  attempt?: number
  model: string
  prompt?: string
  seed?: number
  sources: { model?: SnapshotSource; prompt?: SnapshotSource; seed?: SnapshotSource }
}
export type ResolvedAsset = Asset & { provenance: AssetProvenance }

const sourceKeys = [
  'taskId', 'pipelineId', 'stageId', 'provider', 'executionId',
  'workflowId', 'workflowVersion', 'traceId', 'attempt',
] as const

function executionSource(execution: StageExecution) {
  return {
    taskId: execution.taskId,
    pipelineId: execution.pipelineId,
    stageId: execution.stageId,
    provider: execution.provider,
    executionId: execution.id,
    workflowId: execution.workflowId,
    workflowVersion: execution.workflowVersion,
    traceId: execution.traceId,
    attempt: execution.attempt,
  }
}

function matchesSource(asset: Asset, execution: StageExecution): boolean {
  const source = executionSource(execution)
  return sourceKeys.every((key) => asset[key] === undefined || asset[key] === source[key])
}

function historicalInput(execution?: StageExecution): Record<string, unknown> {
  try {
    const input: unknown = JSON.parse(execution?.input ?? '')
    return input !== null && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function snapshot<T extends string | number>(
  direct: T | undefined, input: unknown, fallback: T | undefined, kind: 'string' | 'number',
): { value: T | undefined; source: SnapshotSource | undefined } {
  const valid = (value: unknown): value is T =>
    typeof value === kind && (kind !== 'number' || Number.isFinite(value))
  if (valid(direct)) return { value: direct, source: 'execution' }
  if (valid(input)) return { value: input, source: 'input' }
  return { value: fallback, source: fallback === undefined ? undefined : 'asset' }
}

function resolveSnapshot(asset: Asset, execution?: StageExecution): ResolvedAsset {
  const input = historicalInput(execution)
  const model = snapshot(execution?.modelId, input.modelId, asset.model, 'string')
  const prompt = snapshot(execution?.prompt, input.prompt, asset.prompt, 'string')
  const seed = snapshot(execution?.seed, input.seed, asset.seed, 'number')
  const source = execution ? executionSource(execution) : {
    taskId: asset.taskId,
    pipelineId: asset.pipelineId,
    stageId: asset.stageId,
    provider: asset.provider,
    executionId: asset.executionId,
    workflowId: asset.workflowId,
    workflowVersion: asset.workflowVersion,
    traceId: asset.traceId,
    attempt: asset.attempt,
  }
  return {
    ...asset,
    ...source,
    model: model.value ?? asset.model,
    prompt: prompt.value,
    seed: seed.value,
    tags: [...new Set(asset.tags)],
    provenance: {
      ...source,
      status: execution ? 'tracked' : 'legacy unavailable',
      model: model.value ?? asset.model,
      prompt: prompt.value,
      seed: seed.value,
      sources: { model: model.source, prompt: prompt.source, seed: seed.source },
    },
  }
}

// Presentation fields (name, cover, tags, timestamps) do not identify an output.
function samePayload(left: Asset, right: Asset): boolean {
  return left.type === right.type && left.url === right.url && left.content === right.content
    && left.duration === right.duration && left.resolution === right.resolution
}

function sameHistory(left: Asset, right: Asset): boolean {
  return sourceKeys.every((key) => left[key] === right[key])
    && left.model === right.model && left.prompt === right.prompt && left.seed === right.seed
}

export class AssetRegistry {
  resolve(db: Database, asset: Asset): ResolvedAsset {
    const execution = asset.executionId === undefined
      ? undefined
      : db.executions?.find((entry) => entry.id === asset.executionId)
    // Never guess an execution from the task, stage, or latest attempt.
    return resolveSnapshot(asset, execution && matchesSource(asset, execution) ? execution : undefined)
  }

  register(db: Database, asset: Asset, execution?: StageExecution): ResolvedAsset {
    const source = execution ?? (asset.executionId === undefined
      ? undefined
      : db.executions?.find((entry) => entry.id === asset.executionId))
    if (source && !matchesSource(asset, source)) throw new Error('素材与执行来源不一致')
    const resolved = resolveSnapshot(asset, source)
    // Check ID collisions before payload deduplication, so an existing ID cannot
    // silently point at a different output or attempt. All validation is read-only.
    const existing = db.assets.find((entry) => entry.id === asset.id)
    if (existing) {
      if (!sameHistory(existing, resolved) || !samePayload(existing, resolved))
        throw new Error('素材 ID 不能覆盖历史来源或产物')
      return resolveSnapshot(existing, source)
    }
    if (source) {
      const duplicate = db.assets.find((entry) =>
        entry.executionId === source.id
        && sameHistory(entry, resolved)
        && samePayload(entry, resolved),
      )
      if (duplicate) return resolveSnapshot(duplicate, source)
    }
    // Persist only asset fields, not a derived view or caller-owned arrays.
    const stored: Asset = { ...resolved, tags: [...resolved.tags] }
    delete (stored as Partial<ResolvedAsset>).provenance
    db.assets.push(stored)
    return resolved
  }
}

export const assetRegistry = new AssetRegistry()

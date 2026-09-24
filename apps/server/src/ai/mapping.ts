/** Server-only, pure API graph validation. Never submits editor/UI JSON. */
export const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const unsafe = (s: string) => ['__proto__', 'prototype', 'constructor'].includes(s)
export type Json = null | string | boolean | number | Json[] | { [key: string]: Json }
export const isJson = (v: unknown): v is Json =>
  v === null || typeof v === 'string' || typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isFinite(v)) ||
  (Array.isArray(v) ? v.every(isJson) : record(v) && Object.entries(v).every(([k, x]) => !unsafe(k) && isJson(x)))

export type ApiGraph = Record<string, { class_type: string; inputs: Record<string, Json> }>
export function parseApiWorkflow(value: unknown): ApiGraph {
  if (!record(value) || !Object.keys(value).length || Array.isArray(value.nodes) || Array.isArray(value.links))
    throw new Error('INVALID_WORKFLOW: 必须导入 API JSON，UI JSON 仅可保存不可执行')
  for (const [id, node] of Object.entries(value)) {
    if (unsafe(id) || !record(node) || typeof node.class_type !== 'string' ||
      !node.class_type.trim() || !record(node.inputs) || !isJson(node.inputs))
      throw new Error(`INVALID_WORKFLOW: ${id}`)
  }
  return JSON.parse(JSON.stringify(value)) as ApiGraph
}

export function applyMapping(workflow: unknown, mapping: unknown, values: unknown) {
  const graph = parseApiWorkflow(workflow)
  if (!record(mapping) || !record(values) || !isJson(values)) throw new Error('INVALID_MAPPING')
  const entries = record(mapping.inputs) ? mapping.inputs : mapping
  const targets = new Map<string, { nodeId: string; input: string; type?: string }>()
  const used = new Set<string>()
  for (const [semantic, raw] of Object.entries(entries)) {
    let entry = raw
    if (typeof raw === 'string') {
      const parts = raw.split('.')
      if (parts.length !== 2 && !(parts.length === 3 && parts[1] === 'inputs')) throw new Error('INVALID_MAPPING')
      entry = { nodeId: parts[0], input: parts.at(-1) }
    }
    if (!record(entry) || typeof entry.nodeId !== 'string' || typeof entry.input !== 'string' ||
      [semantic, entry.nodeId, entry.input].some(unsafe)) throw new Error('INVALID_MAPPING')
    const key = JSON.stringify([entry.nodeId, entry.input])
    if (!Object.hasOwn(graph, entry.nodeId) || !Object.hasOwn(graph[entry.nodeId].inputs, entry.input) || used.has(key))
      throw new Error('INVALID_MAPPING: 不存在或重复的目标')
    used.add(key)
    if (entry.required && !Object.hasOwn(values, semantic)) throw new Error(`MISSING_INPUT: ${semantic}`)
    if (entry.type !== undefined && (typeof entry.type !== 'string' || !['string', 'number', 'integer', 'boolean'].includes(entry.type)))
      throw new Error('INVALID_MAPPING_TYPE')
    targets.set(semantic, { nodeId: entry.nodeId, input: entry.input, type: typeof entry.type === 'string' ? entry.type : undefined })
  }
  for (const [semantic, value] of Object.entries(values)) {
    const target = targets.get(semantic)
    if (!target) throw new Error(`UNMAPPED_INPUT: ${semantic}`)
    const type = target.type
    if (type && ((['string', 'number', 'boolean'].includes(type) && typeof value !== type) ||
      (type === 'integer' && !Number.isInteger(value)))) throw new Error(`INVALID_INPUT_TYPE: ${semantic}`)
    graph[target.nodeId].inputs[target.input] = value
  }
  return graph
}

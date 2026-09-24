import type { WorkflowKind } from '../types'

// Metadata is not the demo executor contract (ProviderKind).
export interface MetadataCapability { provider: string; workflowKinds: readonly WorkflowKind[] }
export const kindLabels: Record<WorkflowKind, string> = {
  text: '文本生成', image: '图像生成', video: '视频生成',
  audio: '音频生成', vision: '视觉理解', embedding: '向量嵌入',
}
const allKinds = Object.keys(kindLabels) as WorkflowKind[]
const known: MetadataCapability[] = [
  { provider: 'Mock', workflowKinds: allKinds },
  { provider: 'ComfyUI', workflowKinds: ['image', 'video', 'audio'] },
  { provider: 'OPENAI', workflowKinds: ['text'] },
  { provider: 'OLLAMA', workflowKinds: ['text'] },
]
export function providerLabel(provider: string): string {
  return ({ Mock: 'Mock 模拟服务', ComfyUI: 'ComfyUI引擎', COMFYUI: 'ComfyUI引擎',
    OPENAI: 'OpenAI 兼容文本服务', OLLAMA: 'Ollama 文本服务' })[provider] ?? provider
}
/** Infer output kind only for display/validation; never rewrite persisted metadata. */
export function inferKind(type: string): WorkflowKind | undefined {
  const value = type.trim().toLowerCase()
  const legacy: Record<string, WorkflowKind> = { 'text to text': 'text', 'text to image': 'image',
    'image to video': 'video', 'text to video': 'video', 'text to audio': 'audio' }
  return allKinds.find(kind => kind === value || kindLabels[kind] === type)
    ?? legacy[value]
}
export function typeLabel(type: string): string {
  const kind = inferKind(type)
  return kind ? kindLabels[kind] : type
}
export function metadataCapabilities(demo: boolean, registry?: readonly MetadataCapability[]): MetadataCapability[] {
  const allowed = known.filter(row => demo ? ['Mock', 'ComfyUI'].includes(row.provider) : row.provider !== 'Mock')
  if (registry === undefined) return allowed.map(row => ({
    ...row, provider: !demo && row.provider === 'ComfyUI' ? 'COMFYUI' : row.provider,
  }))
  return allowed.flatMap(row => {
    const match = registry.find(item => item.provider === row.provider || (row.provider === 'ComfyUI' && item.provider === 'COMFYUI'))
    return match ? [{ provider: match.provider, workflowKinds: row.workflowKinds.filter(kind => match.workflowKinds.includes(kind)) }] : []
  }).filter(row => row.workflowKinds.length)
}
export interface MetadataOption { value: string; label: string; disabled?: boolean }
export function retainOption(options: MetadataOption[], value: string, label: string): MetadataOption[] {
  return !value || options.some(option => option.value === value) ? options
    : [{ value, label: `${label}（原值：${value}；保留，不可新选）`, disabled: true }, ...options]
}
export function metadataErrors(
  value: { type: string; provider: string },
  capabilities: readonly MetadataCapability[],
  original?: { type: string; provider: string } | null,
): { type?: string; provider?: string } {
  // Legacy drafts may be edited without losing metadata, but any changed pair must be supported.
  if (original && original.type === value.type && original.provider === value.provider) return {}
  const provider = capabilities.find(row => row.provider === value.provider)
  const kind = inferKind(value.type)
  return {
    provider: provider ? undefined : '请选择当前模式可用的提供方',
    type: kind && provider?.workflowKinds.includes(kind) ? undefined : '请选择此提供方支持的工作流类型；切换提供方不会自动更改原类型',
  }
}

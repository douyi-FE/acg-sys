import { describe, expect, it } from 'vitest'
import {
  inferKind,
  kindLabels,
  metadataCapabilities,
  metadataErrors,
  retainOption,
} from '../src/workflow/metadata'
import { createSeed } from '../src/services/seed'
import { readFileSync } from 'node:fs'

describe('workflow metadata choices without executor enum casts', () => {
  it('uses Ant selects with validation wrappers and original option values', () => {
    const source = readFileSync(new URL('../src/pages/workflows/WorkflowCenter.vue', import.meta.url), 'utf8')
    expect(source).not.toMatch(/<select\b/)
    expect(source).toContain('v-model:value="draft.type"')
    expect(source).toContain('v-model:value="draft.provider"')
    expect(source).toContain('v-field="selectionErrors.type"')
    expect(source).toContain('v-field="selectionErrors.provider"')
    expect(source).toContain('...typeOptions')
    expect(source).toContain('...providerOptions')
  })
  it('uses the actual demo registry and all six supported Mock kinds', () => {
    const rows = metadataCapabilities(true, createSeed().providerRegistry)
    expect(rows.map((row) => row.provider)).toEqual(['Mock', 'ComfyUI'])
    expect(rows[0]!.workflowKinds).toEqual(Object.keys(kindLabels))
    expect(rows[1]!.workflowKinds).toEqual(['image', 'video', 'audio'])
  })
  it('restricts real providers to supported capabilities, excludes Mock, and honors empty registries', () => {
    expect(
      metadataCapabilities(false, [
        { provider: 'Mock', workflowKinds: ['text'] },
        { provider: 'COMFYUI', workflowKinds: ['image', 'text'] },
        { provider: 'OPENAI', workflowKinds: ['text', 'vision', 'embedding'] },
        { provider: 'OLLAMA', workflowKinds: ['text'] },
      ]),
    ).toEqual([
      { provider: 'COMFYUI', workflowKinds: ['image'] },
      { provider: 'OPENAI', workflowKinds: ['text'] },
      { provider: 'OLLAMA', workflowKinds: ['text'] },
    ])
    expect(metadataCapabilities(false, [])).toEqual([])
    expect(metadataCapabilities(false).map((row) => row.provider)).toEqual(['COMFYUI', 'OPENAI', 'OLLAMA'])
  })
  it.each([
    ['Text to Image', 'image'],
    ['Image to Video', 'video'],
    ['Text to Text', 'text'],
    ['Text to Audio', 'audio'],
    ['Vision', 'vision'],
    ['Embedding', 'embedding'],
    ['视频生成', 'video'],
    ['text', 'text'],
    ['custom', undefined],
  ])('infers %s by output, independently of provider, without conversion', (type, expected) => {
    expect(inferKind(type)).toBe(expected)
  })
  it('preserves unknown historical values but rejects changed invalid combinations', () => {
    const original = { provider: 'old-service', type: 'custom' }
    const capabilities = metadataCapabilities(false)
    expect(metadataErrors({ ...original }, capabilities, original)).toEqual({})
    expect(retainOption([], original.type, original.type)).toEqual([
      { value: 'custom', label: 'custom（原值：custom；保留，不可新选）', disabled: true },
    ])
    expect(metadataErrors({ ...original, provider: 'OPENAI' }, capabilities, original).type).toBeTruthy()
    expect(metadataErrors({ provider: 'OPENAI', type: 'image' }, capabilities).type).toBeTruthy()
    expect(metadataErrors({ provider: 'OPENAI', type: 'text' }, capabilities).type).toBeUndefined()
    expect(original).toEqual({ provider: 'old-service', type: 'custom' })
  })
})

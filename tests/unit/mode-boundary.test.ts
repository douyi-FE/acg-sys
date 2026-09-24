import { describe, expect, it } from 'vitest'
import { resolveDevelopmentMockMode } from '../../src/api/mode'

describe('development mode boundary', () => {
  it('never enables demo permissions in production, even when env asks for mock', () => {
    expect(resolveDevelopmentMockMode({ dev: false, apiMode: 'mock', flag: 'demo', query: 'demo' })).toBe(false)
  })
  it('allows explicit development demo and real selection to override .env', () => {
    expect(resolveDevelopmentMockMode({ dev: true, apiMode: 'real', query: 'demo' })).toBe(true)
    expect(resolveDevelopmentMockMode({ dev: true, apiMode: 'mock', query: 'real' })).toBe(false)
  })
  it('supports existing mock regression tests without making production builds mock', () => {
    expect(resolveDevelopmentMockMode({ dev: true, apiMode: 'mock' })).toBe(true)
  })
  it('ignores persisted demo choice in production and defaults real without development opt-in', () => {
    expect(resolveDevelopmentMockMode({ dev: false, stored: 'demo' })).toBe(false)
    expect(resolveDevelopmentMockMode({ dev: true })).toBe(false)
    expect(resolveDevelopmentMockMode({ dev: true, apiMode: 'real', flag: 'demo' })).toBe(true)
    expect(resolveDevelopmentMockMode({ dev: true, apiMode: 'mock', flag: 'real' })).toBe(false)
  })
})

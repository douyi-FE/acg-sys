import { describe, expect, it, vi } from 'vitest'
import { applyMapping, parseApiWorkflow } from '../apps/server/src/ai/mapping'
import { AiError, AiTransport, validateBaseUrl } from '../apps/server/src/ai/transport'
import { AiService } from '../apps/server/src/ai/ai.service'
import type { DatabaseService } from '../apps/server/src/database/database.service'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Prisma } from '@prisma/client'

type Row = Record<string, unknown> & { id: string; status: string }
function database(kind: 'COMFYUI' | 'OPENAI') {
  const order: string[] = []
  const executions = new Map<string, Row>()
  const assets: Record<string, unknown>[] = []
  const service = { id: 's', kind, enabled: true, baseUrl: 'http://fake.test:8188', secretEncrypted: null }
  const db = {
    execution: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string; status?: unknown }; data: Record<string, unknown> }) => {
        if (!where.id) return { count: 0 }
        const row = executions.get(where.id)
        if (!row || row.status === 'CANCELLED' || (typeof where.status === 'string' && row.status !== where.status)) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = executions.get(where.id)
        return row ? { ...row, service } : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        order.push('intent')
        const row = { ...data, id: `e${executions.size}`, status: 'QUEUED' }
        executions.set(row.id, row)
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (data.promptId) order.push('persistPromptId')
        const row = executions.get(where.id)!
        Object.assign(row, data)
        return row
      }),
    },
    task: {
      findUnique: vi.fn(async () => ({ id: 't', userId: 'u' })),
      create: vi.fn(async () => ({ id: 't', userId: 'u' })),
      update: vi.fn(async () => ({})),
    },
    aIService: { findUnique: vi.fn(async () => service), findUniqueOrThrow: vi.fn(async () => service) },
    aIModel: { findUnique: vi.fn(async () => ({ id: 'm', serviceId: 's', enabled: true, remoteId: 'discovered-model' })) },
    workflow: { findUnique: vi.fn(async () => ({
      id: 'w', status: 'ACTIVE', version: '1', instanceId: 's', mapping: { seed: '7.seed' },
      apiWorkflowJson: { '7': { class_type: 'KSampler', inputs: { seed: 1 } } },
    })) },
    asset: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        order.push('asset')
        const asset = { ...data, id: `a${assets.length}` }
        assets.push(asset)
        return asset
      }),
    },
    $transaction: vi.fn(async (arg: unknown) => typeof arg === 'function' ? arg(db) : Promise.all(arg as Promise<unknown>[])),
  }
  return { db: db as unknown as DatabaseService, executions, assets, order }
}

describe('server AI fake HTTP integration (no GPU/device)', () => {
  it.each(['COMFYUI', 'OPENAI'] as const)('%s persists intent, consumes real transport and archives bytes', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'server-ai-test-'))
    vi.stubEnv('AI_ASSET_ROOT', root)
    vi.stubEnv('ALLOWED_AI_HOSTS', 'fake.test:8188')
    const state = database(kind)
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      expect(init?.redirect).toBe('error')
      if (path === '/prompt') {
        state.order.push('submit')
        expect(state.order[0]).toBe('intent')
        return Response.json({ prompt_id: 'p1' })
      }
      if (path === '/history/p1') {
        state.order.push('poll')
        expect(state.executions.get('e0')?.promptId).toBe('p1')
        return Response.json({ p1: { status: { completed: true }, outputs: { '9': { images: [{ filename: 'test.png', type: 'output' }] } } } })
      }
      if (path === '/view') return new Response('media-bytes', { headers: { 'content-type': 'image/png' } })
      if (path === '/chat/completions') return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n')
      throw new Error(`Unexpected fake HTTP path: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const ai = new AiService(state.db)
    try {
      await ai.onModuleInit()
      if (kind === 'COMFYUI') {
        await ai.submit({ id: 'u' }, { taskId: 't', serviceId: 's', workflowId: 'w', input: { seed: 2 } })
        await vi.waitFor(() => expect(state.executions.get('e0')?.status).toBe('SUCCESS'), { timeout: 4000 })
        expect(state.order).toEqual(['intent', 'submit', 'persistPromptId', 'poll', 'asset'])
      } else {
        const delta = vi.fn(async (text: string) => { void text })
        const result = await ai.generate({ id: 'u' }, { serviceId: 's', modelId: 'm', prompt: 'test' }, undefined, delta)
        expect(result.status).toBe('SUCCESS')
        expect(delta).toHaveBeenCalledWith('hello')
        expect((result.output as Prisma.JsonObject).archiveStatus).toBe('SAVED')
      }
      expect(state.assets).toHaveLength(1)
      expect(await readFile(String(state.assets[0].storagePath), 'utf8')).toBe(kind === 'COMFYUI' ? 'media-bytes' : 'hello')
      expect(JSON.stringify(state.executions.get('e0')?.output)).toContain('/api/assets/a0/content')
    } finally { ai.onModuleDestroy(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) }
  })
})

describe('server AI security and workflow contracts', () => {
  const graph = { '7': { class_type: 'KSampler', inputs: { seed: 1, prompt: '' } } }
  it('supports semantic mapping and rejects UI JSON/node assumptions', () => {
    expect(applyMapping(graph, { inputs: { seed: { nodeId: '7', input: 'seed', required: true }, prompt: { nodeId: '7', input: 'prompt' } } }, { seed: 4, prompt: 'x' })['7'].inputs.seed).toBe(4)
    expect(() => parseApiWorkflow({ nodes: [], links: [] })).toThrow('INVALID_WORKFLOW')
    expect(() => applyMapping(graph, { seed: '1.seed' }, { seed: 1 })).toThrow()
    expect(() => applyMapping(graph, { seed: '7.inputs.missing' }, { seed: 1 })).toThrow('INVALID_MAPPING')
  })
  it('requires exact allowlisted host and rejects redirect credentials/query', () => {
    expect(validateBaseUrl('http://comfy.internal:8188', 'comfy.internal:8188').host).toBe('comfy.internal:8188')
    expect(() => validateBaseUrl('http://comfy.internal.evil:8188', 'comfy.internal:8188')).toThrow(AiError)
    expect(() => validateBaseUrl('http://user:pass@comfy.internal:8188', 'comfy.internal:8188')).toThrow()
    expect(() => validateBaseUrl('http://comfy.internal:8188/?token=x', 'comfy.internal:8188')).toThrow()
  })
  it('uses redirect error and never exposes bearer in a request error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const transport = new AiTransport(fetcher)
    await expect(transport.request({ baseUrl: 'http://llm.internal:11434', secretEncrypted: undefined }, '/api/tags')).rejects.toThrow('HOST_NOT_ALLOWED')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('uses uppercase ADMIN only for service configuration and resource manage permissions for overrides', async () => {
    vi.stubEnv('ALLOWED_AI_HOSTS', 'fake.test:8188')
    const service = new AiService({
      aIService: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
      execution: {
        findUnique: vi.fn(async () => ({ id: 'e', userId: 'owner', status: 'QUEUED' })),
      },
    } as unknown as DatabaseService)
    await expect(service.createService(
      { id: 'admin', role: 'admin' },
      { name: 'x', baseUrl: 'http://fake.test:8188', kind: 'OPENAI' },
    )).rejects.toThrow('FORBIDDEN')
    await expect(service.createService(
      { id: 'admin', role: 'ADMIN' },
      { name: 'x', baseUrl: 'http://fake.test:8188', kind: 'OPENAI' },
    )).resolves.toBeDefined()
    await expect(service.getExecution({ id: 'other', role: 'ADMIN' }, 'e')).rejects.toThrow('FORBIDDEN')
    await expect(service.getExecution({ id: 'other', permissions: ['executions.manage'] }, 'e')).resolves.toMatchObject({ id: 'e' })
    vi.unstubAllEnvs()
  })
})

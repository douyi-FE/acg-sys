import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceController } from '../apps/server/src/workspace/workspace.controller'
import { SSE_METADATA } from '@nestjs/common/constants'
import { DataInterceptor } from '../apps/server/src/common/http'
import { assetProjection, serviceProjection, taskProjection, workflowProjection } from '../apps/server/src/common/projections'
import type { RequestUser } from '../apps/server/src/common/permissions'

const guest: RequestUser = {
  id: 'guest', username: 'guest', roleId: 'guest-role', role: 'GUEST',
  permissions: ['tasks.read', 'assets.read', 'workflows.read', 'providers.read'],
  forceChangePassword: false, tokenVersion: 0,
}
const task = {
  id: 'task', userId: 'owner', title: 'public', kind: 'video', status: 'SUCCESS', progress: 100,
  stageIndex: 1, stages: [{ secret: 'hidden' }], request: { prompt: 'hidden' }, metadata: { internal: true },
  modelId: 'model', workflowId: 'workflow', pipelineId: 'pipeline', script: 'hidden', previousScript: '',
  characters: [], shots: [], quality: {}, logs: ['hidden'], cover: '', elapsed: 1, estimated: 1,
  retries: 0, approved: true, error: null, isPublic: true, createdAt: new Date(), updatedAt: new Date(),
}
const asset = {
  id: 'asset', userId: 'owner', taskId: 'task', executionId: 'execution', name: 'file',
  type: 'text', mimeType: 'text/plain', storagePath: '/private/path', metadata: { secret: 'hidden' },
  isPublic: true, createdAt: new Date(),
}
const workflow = {
  id: 'workflow', name: 'public', description: '', provider: 'COMFYUI', type: 'image',
  instanceId: 'service', status: 'ACTIVE', version: '1', workflowJson: { hidden: true },
  apiWorkflowJson: { hidden: true }, mapping: { hidden: true }, metadata: { hidden: true },
  createdAt: new Date(), updatedAt: new Date(),
}

describe('server security projections', () => {
  it('projects only enabled service capabilities and distinguishes missing permission from empty', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'disabled', kind: 'OLLAMA', enabled: false },
      { id: 'enabled', kind: 'OPENAI', enabled: true },
      { id: 'comfy', kind: 'COMFYUI', enabled: true, health: {} },
    ])
    const controller = new WorkspaceController({ aIService: { findMany } } as never)
    const permitted = { user: { ...guest, permissions: ['providers.read'] } }
    expect((await controller.get(permitted as never)).providerRegistry).toEqual([
      { provider: 'OPENAI', workflowKinds: ['text'] },
      { provider: 'COMFYUI', workflowKinds: ['image', 'video', 'audio'] },
    ])
    findMany.mockResolvedValue([])
    expect((await controller.get(permitted as never)).providerRegistry).toEqual([])
    findMany.mockClear()
    expect(await controller.get({ user: { ...guest, permissions: [] } } as never)).not.toHaveProperty('providerRegistry')
    expect(findMany).not.toHaveBeenCalled()
  })
  it('does not expose private task, asset, or workflow payloads to public readers', () => {
    expect(taskProjection(guest, task as never)).toMatchObject({ title: 'public', request: {}, stages: [] })
    expect(taskProjection(guest, task as never)).not.toHaveProperty('request.prompt')
    expect(assetProjection(guest, asset as never)).toMatchObject({ storagePath: null, metadata: {} })
    expect(workflowProjection(guest, workflow as never)).toMatchObject({ workflowJson: null, apiWorkflowJson: null, mapping: null })
  })

  it('only exposes provider base URLs to provider administrators and normalizes health', () => {
    const row = { id: 'service', name: 'provider', kind: 'OPENAI', baseUrl: 'https://internal', enabled: true, health: { ok: true, checkedAt: 'now', secret: 'hidden' } }
    expect(serviceProjection(guest, row)).toEqual({ id: 'service', name: 'provider', kind: 'OPENAI', enabled: true, baseUrl: '', health: { ok: true, checkedAt: 'now' } })
  })

  it('does not wrap Nest SSE MessageEvent values in the normal data envelope', () => {
    const handler = () => undefined
    Reflect.defineMetadata(SSE_METADATA, true, handler)
    const interceptor = new DataInterceptor()
    const stream = { marker: 'sse' }
    const next = { handle: () => stream }
    expect(interceptor.intercept({ getHandler: () => handler } as never, next as never)).toBe(stream)
  })
})

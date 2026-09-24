import { Controller, ForbiddenException, Get, Req, Res } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'
import { GUEST_PERMISSIONS, Public, RequirePermission, RequestUser } from '../common/permissions'
import { assetProjection, serviceProjection, taskProjection, workflowProjection } from '../common/projections'
import type { Request, Response } from 'express'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

@Controller('api/workspace')
export class WorkspaceController {
  constructor(private readonly db: DatabaseService) {}
  @Public() @Get('public')
  async publicWorkspace() {
    const role = await this.db.role.findUnique({ where: { name: 'GUEST' }, include: { permissions: true } })
    if (!role?.enabled) throw new ForbiddenException()
    const permissions = role.permissions.map(p => p.permissionId).filter(p => (GUEST_PERMISSIONS as readonly string[]).includes(p))
    if (!permissions.includes('workspace.read')) throw new ForbiddenException()
    return this.get({ user: { id: '', username: '', roleId: role.id, role: 'GUEST', permissions, forceChangePassword: false, tokenVersion: 0 } } as Request & { user: RequestUser })
  }
  @Get() @RequirePermission('workspace.read')
  async get(@Req() req: Request & { user: RequestUser }) {
    const can = (permission: string) => req.user.permissions.includes(permission)
    const [tasks, assets, workflows, executions, pipelines, models, services, qualityConfigs] = await Promise.all([
      can('tasks.read') ? this.db.task.findMany({ where: can('tasks.manage') ? {} : { OR: [{ userId: req.user.id }, { isPublic: true }] }, orderBy: { updatedAt: 'desc' }, take: 200 }) : [],
      can('assets.read') ? this.db.asset.findMany({ where: can('assets.manage') ? {} : { OR: [{ userId: req.user.id }, { isPublic: true }] }, orderBy: { createdAt: 'desc' }, take: 200 }) : [],
      can('workflows.read') ? this.db.workflow.findMany({ include: { versions: { select: { version: true, createdAt: true } } }, take: 200 }) : [],
      can('executions.read') ? this.db.execution.findMany({ where: can('executions.manage') ? {} : { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 200 }) : [],
      can('pipelines.read') ? this.db.pipeline.findMany({ include: { stages: { orderBy: { position: 'asc' } } }, take: 200 }) : [],
      can('models.read') ? this.db.aIModel.findMany({ include: { service: { select: { kind: true, health: true } } }, take: 500 }) : [],
      can('providers.read') ? this.db.aIService.findMany({ select: { id: true, name: true, kind: true, baseUrl: true, enabled: true, health: true }, take: 200 }) : [],
      can('quality-gates.read') ? this.db.qualityGate.findMany({ take: 500 }) : [],
    ])
    return {
      version: 3,
      tasks: tasks.map(row => taskProjection(req.user, row)).map(task => ({ ...task, modelId: task.modelId || '', workflowId: task.workflowId || '', request: {
        title: task.title, theme: '', type: task.kind, ratio: '16:9', duration: 0, platform: '', style: '', characters: '', modelId: task.modelId || '', workflowId: task.workflowId || '', scenario: 'normal',
        ...record(task.request),
      } })),
      assets: assets.map(row => ({ ...assetProjection(req.user, row), hasContent: !!row.storagePath })).map(asset => ({
        id: asset.id, name: asset.name, type: asset.type, taskId: asset.taskId || '', executionId: asset.executionId,
        createdAt: asset.createdAt, url: asset.hasContent && req.user.id ? `/api/assets/${asset.id}/content` : '',
        cover: '', tags: record(asset.metadata).tags || [], model: record(asset.metadata).model || '',
        metadata: asset.metadata, isPublic: asset.isPublic,
      })),
      workflows: workflows.map(workflow => ({
        ...workflowProjection(req.user, workflow),
        active: workflow.status === 'ACTIVE', mapping: can('workflows.update') ? workflow.mapping || {} : {},
        history: workflow.versions.map(v => ({ version: v.version, time: v.createdAt, description: '' })),
      })),
      models: models.map(model => ({ id: model.id, name: model.name, provider: model.service.kind, capability: record(model.metadata).capability || 'LLM', enabled: model.enabled, connected: record(model.service.health).ok === true, calls: 0, latency: 0, failureRate: 0 })),
      executions: executions.map(e => ({
        ...e, pipelineId: tasks.find(t => t.id === e.taskId)?.pipelineId || 'single-generation',
        stageId: 'single-generation-stage', stageKey: 'GENERATE', stageIndex: 0, attempt: 1, traceId: e.id,
        input: JSON.stringify(e.input), output: e.output ? JSON.stringify(e.output) : '', logs: [],
      })),
      comfyExecutions: executions.filter(e => e.provider === 'COMFYUI').map(e => ({
        ...e, instanceId: e.serviceId, inputs: e.input, files: record(e.output).files || [],
      })),
      comfyInstances: services.map(s => serviceProjection(req.user, s)).filter(s => s.kind === 'COMFYUI').map(s => ({
        ...s, connected: record(s.health).ok === true, health: { status: record(s.health).ok ? 'healthy' : 'unknown', checkedAt: record(s.health).checkedAt || '', simulated: false, message: '' },
      })),
      // Missing permission is unknown, not an authoritative empty capability list.
      ...(can('providers.read') ? { providerRegistry: [...new Set(services.filter(s => s.enabled).map(s => s.kind))].map(provider => ({ provider, workflowKinds: provider === 'COMFYUI' ? ['image', 'video', 'audio'] : ['text'] })) } : {}),
      pipelines: pipelines.map(p => ({
        ...p, metadata: can('pipelines.update') ? p.metadata : null,
        stages: p.stages.map(s => ({ ...s, metadata: can('stages.update') ? s.metadata : null })),
      })),
      qualityConfigs: qualityConfigs.map(q => ({ ...q, criteria: can('quality-gates.update') ? q.criteria : [], metadata: can('quality-gates.update') ? q.metadata : null })),
      traces: [], topics: [], articles: [],
      settings: { threshold: 80, maxRetries: 0, maxIterations: 1, autoRetry: false, stageDuration: 0 },
    }
  }
}

@Controller('api/health')
export class HealthController {
  constructor(private db: DatabaseService) {}
  @Public() @Get()
  async health(@Res({ passthrough: true }) res: Response) {
    const ready = await this.db.check()
    res.status(ready ? 200 : 503)
    return { status: ready ? 'ready' : 'unavailable', backend: 'up', database: ready ? 'up' : 'down',
      dependencies: { comfyui: 'not_checked', llm: 'not_checked' } }
  }
  @Public() @Get('live')
  live() { return { status: 'alive', backend: 'up' } }
}

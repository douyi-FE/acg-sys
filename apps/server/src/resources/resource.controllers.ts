import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { DatabaseService } from '../database/database.service'
import { RequirePermission, RequestUser } from '../common/permissions'
import { assertOwner, bool, json, number, objectBody, text } from '../common/input'
import { AiService } from '../ai/ai.service'
import type { Request } from 'express'
import { assetProjection, serviceProjection, taskProjection, workflowProjection } from '../common/projections'
type R = Request & { user: RequestUser }

@Controller('api/tasks')
export class TasksController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('tasks.read')
  async list(@Req() req: R) {
    const rows = await this.db.task.findMany({ where: req.user.permissions.includes('tasks.manage') ? {} : { OR: [{ userId: req.user.id }, { isPublic: true }] }, orderBy: { updatedAt: 'desc' }, take: 200 })
    return rows.map(row => taskProjection(req.user, row))
  }
  @Get(':id') @RequirePermission('tasks.read')
  async one(@Req() req: R, @Param('id') id: string) {
    const row = await this.db.task.findUnique({ where: { id } })
    assertOwner(req.user, row, 'tasks')
    return taskProjection(req.user, row!)
  }
  @Post() @RequirePermission('tasks.create')
  async create(@Req() req: R, @Body() input: unknown) {
    const body = objectBody(input, ['title', 'kind', 'request', 'modelId', 'workflowId', 'pipelineId'])
    const title = text(body.title, 'title')
    const kind = body.kind === undefined ? 'video' : text(body.kind, 'kind')
    if (!['video', 'article'].includes(kind)) throw new BadRequestException('不支持的任务类型')
    const modelId = body.modelId === undefined ? undefined : text(body.modelId, 'modelId')
    const workflowId = body.workflowId === undefined ? undefined : text(body.workflowId, 'workflowId')
    const pipelineId = body.pipelineId === undefined ? undefined : text(body.pipelineId, 'pipelineId')
    if (modelId && !await this.db.aIModel.findFirst({ where: { id: modelId, enabled: true, service: { enabled: true } } })) throw new BadRequestException('模型不可用')
    if (workflowId && !await this.db.workflow.findFirst({ where: { id: workflowId, status: 'ACTIVE' } })) throw new BadRequestException('工作流不可用')
    if (pipelineId && !await this.db.pipeline.findFirst({ where: { id: pipelineId, enabled: true } })) throw new BadRequestException('流水线不可用')
    return this.db.$transaction(async tx => {
      const task = await tx.task.create({ data: {
        userId: req.user.id, title, kind, request: json(body.request ?? {}), modelId, workflowId, pipelineId,
        stages: [{ key: 'GENERATE', name: '真实生成', status: 'pending', duration: 0, input: '', output: '', prompt: '', model: modelId || '', workflow: workflowId || '', seed: 0 }],
        characters: [], shots: [], logs: [], script: '', previousScript: '',
      } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'tasks.create', targetId: task.id } })
      return task
    })
  }
  @Patch(':id') @RequirePermission('tasks.update')
  async update(@Req() req: R, @Param('id') id: string, @Body() input: unknown) {
    // Status, results, progress, ownership and approval are never client-writable.
    const body = objectBody(input, ['title', 'isPublic'])
    const row = await this.db.task.findUnique({ where: { id } })
    assertOwner(req.user, row, 'tasks', true)
    return this.db.$transaction(async tx => {
      const task = await tx.task.update({ where: { id }, data: {
        ...(body.title === undefined ? {} : { title: text(body.title, 'title') }),
        ...(body.isPublic === undefined ? {} : { isPublic: bool(body.isPublic) }),
      } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'tasks.update', targetId: id } })
      return task
    })
  }
  @Delete(':id') @RequirePermission('tasks.delete')
  async remove(@Req() req: R, @Param('id') id: string) {
    const row = await this.db.task.findUnique({ where: { id } })
    assertOwner(req.user, row, 'tasks', true)
    return this.db.$transaction(async tx => {
      if (await tx.execution.count({ where: { taskId: id } })) throw new ConflictException('有执行记录的任务不可删除')
      await tx.task.delete({ where: { id } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'tasks.delete', targetId: id } })
      return { deleted: true }
    })
  }
}

@Controller('api/assets')
export class AssetsController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('assets.read')
  async list(@Req() req: R) {
    const rows = await this.db.asset.findMany({ where: req.user.permissions.includes('assets.manage') ? {} : { OR: [{ userId: req.user.id }, { isPublic: true }] }, orderBy: { createdAt: 'desc' }, take: 200 })
    return rows.map(row => assetProjection(req.user, row))
  }
  @Get(':id') @RequirePermission('assets.read')
  async one(@Req() req: R, @Param('id') id: string) {
    const row = await this.db.asset.findUnique({ where: { id } })
    assertOwner(req.user, row, 'assets')
    return assetProjection(req.user, row!)
  }
  @Post() @RequirePermission('assets.create')
  async create(@Req() req: R, @Body() input: unknown) {
    // Files/storage paths are exclusively written by the AI archiver, never by clients.
    const body = objectBody(input, ['name', 'type', 'metadata', 'isPublic'])
    return this.db.$transaction(async tx => {
      const asset = await tx.asset.create({ data: { userId: req.user.id, name: text(body.name, 'name'), type: text(body.type, 'type', 50), metadata: json(body.metadata ?? {}), isPublic: body.isPublic === undefined ? false : bool(body.isPublic) } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'assets.create', targetId: asset.id } })
      return asset
    })
  }
  @Patch(':id') @RequirePermission('assets.update')
  async update(@Req() req: R, @Param('id') id: string, @Body() input: unknown) {
    const body = objectBody(input, ['name', 'isPublic'])
    const row = await this.db.asset.findUnique({ where: { id } })
    assertOwner(req.user, row, 'assets', true)
    return this.db.$transaction(async tx => {
      const asset = await tx.asset.update({ where: { id }, data: {
        ...(body.name === undefined ? {} : { name: text(body.name, 'name') }),
        ...(body.isPublic === undefined ? {} : { isPublic: bool(body.isPublic) }),
      } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'assets.update', targetId: id } })
      return asset
    })
  }
  @Delete(':id') @RequirePermission('assets.delete')
  async remove(@Req() req: R, @Param('id') id: string) {
    const row = await this.db.asset.findUnique({ where: { id } })
    assertOwner(req.user, row, 'assets', true)
    return this.db.$transaction(async tx => {
      await tx.asset.delete({ where: { id } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'assets.delete', targetId: id } })
      return { deleted: true }
    })
  }
}

@Controller('api/executions')
export class ExecutionsController {
  constructor(private db: DatabaseService, private ai: AiService) {}
  @Get() @RequirePermission('executions.read')
  list(@Req() req: R) { return this.db.execution.findMany({ where: req.user.permissions.includes('executions.manage') ? {} : { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 200 }) }
  @Get(':id') @RequirePermission('executions.read')
  async one(@Req() req: R, @Param('id') id: string) {
    const row = await this.db.execution.findUnique({ where: { id } })
    assertOwner(req.user, row, 'executions')
    return row
  }
  @Post() @RequirePermission('executions.create')
  async create(@Req() req: R, @Body() input: unknown) {
    const body = objectBody(input, ['taskId', 'serviceId', 'workflowId', 'modelId', 'input'])
    const taskId = text(body.taskId, 'taskId')
    const serviceId = text(body.serviceId, 'serviceId')
    const task = await this.db.task.findUnique({ where: { id: taskId } })
    assertOwner(req.user, task, 'tasks', true)
    const service = await this.db.aIService.findFirst({ where: { id: serviceId, enabled: true } })
    if (!service) throw new BadRequestException('服务不可用')
    const workflowId = body.workflowId === undefined ? undefined : text(body.workflowId, 'workflowId')
    const modelId = body.modelId === undefined ? undefined : text(body.modelId, 'modelId')
    const workflow = workflowId ? await this.db.workflow.findFirst({ where: { id: workflowId, status: 'ACTIVE' } }) : null
    if (workflowId && (!workflow || (workflow.instanceId && workflow.instanceId !== serviceId))) throw new BadRequestException('工作流与服务不匹配')
    if (service.kind === 'COMFYUI' && !workflow) throw new BadRequestException('ComfyUI 必须指定工作流')
    if (modelId && !await this.db.aIModel.findFirst({ where: { id: modelId, serviceId, enabled: true } })) throw new BadRequestException('模型与服务不匹配')
    return this.ai.submit(req.user, { taskId, serviceId, workflowId, modelId, input: json(body.input ?? {}) })
  }
  @Post(':id/cancel') @RequirePermission('executions.cancel')
  async cancel(@Req() req: R, @Param('id') id: string) {
    const row = await this.db.execution.findUnique({ where: { id } })
    assertOwner(req.user, row, 'executions', true)
    return this.ai.cancel(req.user, id)
  }
}

@Controller('api/providers')
export class ProvidersController {
  constructor(private db: DatabaseService, private ai: AiService) {}
  @Get() @RequirePermission('providers.read')
  async list(@Req() req: R) {
    const rows = await this.db.aIService.findMany({ select: { id: true, name: true, kind: true, baseUrl: true, enabled: true, health: true, createdAt: true, updatedAt: true }, take: 200 })
    return rows.map(row => serviceProjection(req.user, row))
  }
  @Post() @RequirePermission('providers.create')
  create(@Req() req: R, @Body() input: unknown) {
    const body = objectBody(input, ['name', 'kind', 'baseUrl', 'enabled', 'secret'])
    const kind = text(body.kind, 'kind')
    if (!['COMFYUI', 'OPENAI', 'OLLAMA'].includes(kind)) throw new BadRequestException('不支持的 provider')
    const data = { name: text(body.name, 'name'), kind, baseUrl: text(body.baseUrl, 'baseUrl', 2000), enabled: body.enabled === undefined ? true : bool(body.enabled), ...(body.secret === undefined ? {} : { secret: text(body.secret, 'secret', 8192) }) }
    return this.ai.createService(req.user, data)
  }
  @Patch(':id') @RequirePermission('providers.update')
  async update(@Req() req: R, @Param('id') id: string, @Body() input: unknown) {
    const body = objectBody(input, ['name', 'baseUrl', 'enabled', 'secret'])
    const data = {
      ...(body.name === undefined ? {} : { name: text(body.name, 'name') }),
      ...(body.baseUrl === undefined ? {} : { baseUrl: text(body.baseUrl, 'baseUrl', 2000) }),
      ...(body.enabled === undefined ? {} : { enabled: bool(body.enabled) }),
      ...(body.secret === undefined ? {} : { secret: text(body.secret, 'secret', 8192) }),
    }
    const service = await this.db.aIService.findUniqueOrThrow({ where: { id }, select: { kind: true } })
    return this.ai.updateService(req.user, id, data, service.kind === 'COMFYUI' ? 'COMFYUI' : 'LLM')
  }
}

@Controller('api/models')
export class ModelsController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('models.read')
  list() { return this.db.aIModel.findMany({ select: { id: true, serviceId: true, remoteId: true, name: true, enabled: true, createdAt: true, updatedAt: true }, take: 500, orderBy: { createdAt: 'desc' } }) }
  @Patch(':id') @RequirePermission('models.update')
  async update(@Req() req: R, @Param('id') id: string, @Body() input: unknown) {
    const body = objectBody(input, ['enabled', 'name'])
    return this.db.$transaction(async tx => {
      const model = await tx.aIModel.update({ where: { id }, data: {
        ...(body.name === undefined ? {} : { name: text(body.name, 'name') }),
        ...(body.enabled === undefined ? {} : { enabled: bool(body.enabled) }),
      } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'models.update', targetId: id } })
      return model
    })
  }
}

@Controller('api/workflows')
export class WorkflowsController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('workflows.read')
  async list(@Req() req: R) {
    const rows = await this.db.workflow.findMany({ take: 200, orderBy: { updatedAt: 'desc' } })
    return rows.map(row => workflowProjection(req.user, row))
  }
  @Get(':id') @RequirePermission('workflows.read')
  async one(@Req() req: R, @Param('id') id: string) {
    const row = await this.db.workflow.findUniqueOrThrow({ where: { id }, include: { versions: true } })
    return { ...workflowProjection(req.user, row), versions: req.user.permissions.includes('workflows.update') ? row.versions : row.versions.map(v => ({ version: v.version, createdAt: v.createdAt })) }
  }
  private data(input: unknown, create = false) {
    const body = objectBody(input, ['name', 'description', 'provider', 'type', 'instanceId', 'status', 'workflowJson', 'apiWorkflowJson', 'mapping', 'metadata'])
    const data: Record<string, unknown> = {}
    for (const key of ['name', 'provider', 'type']) if (create || body[key] !== undefined) data[key] = text(body[key], key)
    if (create || body.description !== undefined) data.description = body.description === undefined || body.description === '' ? '' : text(body.description, 'description', 10000)
    if (body.instanceId !== undefined) data.instanceId = text(body.instanceId, 'instanceId')
    if (body.status !== undefined) {
      const status = text(body.status, 'status')
      if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) throw new BadRequestException('工作流状态不正确')
      data.status = status
    }
    for (const key of ['workflowJson', 'apiWorkflowJson', 'mapping', 'metadata']) if (body[key] !== undefined) data[key] = json(body[key])
    return data
  }
  @Post() @RequirePermission('workflows.create')
  async create(@Req() req: R, @Body() input: unknown) {
    const data = this.data(input, true) as unknown as Prisma.WorkflowUncheckedCreateInput
    return this.db.$transaction(async tx => {
      const workflow = await tx.workflow.create({ data })
      await this.snapshot(tx, workflow)
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'workflows.create', targetId: workflow.id } })
      return workflow
    })
  }
  private async snapshot(tx: Prisma.TransactionClient, row: { id: string; version: string; workflowJson: Prisma.JsonValue; apiWorkflowJson: Prisma.JsonValue; mapping: Prisma.JsonValue; metadata: Prisma.JsonValue }) {
    await tx.workflowVersion.create({ data: {
      workflowId: row.id, version: row.version,
      workflowJson: row.workflowJson ?? Prisma.JsonNull, apiWorkflowJson: row.apiWorkflowJson ?? Prisma.JsonNull,
      mapping: row.mapping ?? Prisma.JsonNull, metadata: row.metadata ?? Prisma.JsonNull,
    } })
  }
  @Patch(':id') @RequirePermission('workflows.update')
  async update(@Req() req: R, @Param('id') id: string, @Body() input: unknown) {
    const data = this.data(input) as Prisma.WorkflowUncheckedUpdateInput
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Workflow WHERE id = ${id} FOR UPDATE`
      const previous = await tx.workflow.findUniqueOrThrow({ where: { id } })
      const version = String((await tx.workflowVersion.count({ where: { workflowId: id } })) + 1)
      const workflow = await tx.workflow.update({ where: { id }, data: { ...data, version: version === previous.version ? `${version}.1` : version } })
      await this.snapshot(tx, workflow)
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'workflows.update', targetId: id } })
      return workflow
    })
  }
  @Delete(':id') @RequirePermission('workflows.delete')
  async remove(@Req() req: R, @Param('id') id: string) {
    return this.db.$transaction(async tx => {
      await tx.workflow.update({ where: { id }, data: { status: 'ARCHIVED' } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'workflows.archive', targetId: id } })
      return { archived: true }
    })
  }
}

@Controller('api/pipelines')
export class PipelinesController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('pipelines.read')
  list() { return this.db.pipeline.findMany({ include: { stages: { orderBy: { position: 'asc' } } }, take: 200 }) }
  @Post() @RequirePermission('pipelines.create')
  async create(@Req() req: R, @Body() input: unknown) {
    const body = objectBody(input, ['name', 'kind', 'metadata'])
    return this.db.$transaction(async tx => {
      const pipeline = await tx.pipeline.create({ data: { name: text(body.name, 'name'), kind: text(body.kind, 'kind'), metadata: json(body.metadata ?? {}) } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'pipelines.create', targetId: pipeline.id } })
      return pipeline
    })
  }
  @Patch(':id') @RequirePermission('pipelines.update')
  async update(@Req() req: R, @Param('id') id: string, @Body() input: unknown) {
    const body = objectBody(input, ['name', 'enabled'])
    return this.db.$transaction(async tx => {
      const row = await tx.pipeline.update({ where: { id }, data: { ...(body.name === undefined ? {} : { name: text(body.name, 'name') }), ...(body.enabled === undefined ? {} : { enabled: bool(body.enabled) }) } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'pipelines.update', targetId: id } })
      return row
    })
  }
}

@Controller('api/stages')
export class StagesController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('stages.read')
  list() { return this.db.stage.findMany({ include: { qualityGate: true }, take: 500, orderBy: { position: 'asc' } }) }
  @Post() @RequirePermission('stages.create')
  async create(@Req() req: R, @Body() input: unknown) {
    const body = objectBody(input, ['pipelineId', 'key', 'name', 'workflowKind', 'workflowId', 'modelId', 'provider', 'metadata'])
    return this.db.$transaction(async tx => {
      const pipelineId = text(body.pipelineId, 'pipelineId')
      await tx.$queryRaw`SELECT id FROM Pipeline WHERE id = ${pipelineId} FOR UPDATE`
      if (await tx.stage.count({ where: { pipelineId } })) throw new ConflictException('当前只支持单真实生成 stage')
      const stage = await tx.stage.create({ data: {
        pipelineId, key: text(body.key, 'key'), name: text(body.name, 'name'), workflowKind: text(body.workflowKind, 'workflowKind'),
        workflowId: body.workflowId === undefined ? undefined : text(body.workflowId, 'workflowId'),
        modelId: body.modelId === undefined ? undefined : text(body.modelId, 'modelId'),
        provider: body.provider === undefined ? undefined : text(body.provider, 'provider'), metadata: json(body.metadata ?? {}),
      } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'stages.create', targetId: stage.id } })
      return stage
    })
  }
}

@Controller('api/quality-gates')
export class QualityGatesController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('quality-gates.read')
  list() { return this.db.qualityGate.findMany({ take: 500 }) }
  @Post() @RequirePermission('quality-gates.create')
  async create(@Req() req: R, @Body() input: unknown) {
    const body = objectBody(input, ['stageId', 'threshold', 'enabled', 'criteria'])
    return this.db.$transaction(async tx => {
      const gate = await tx.qualityGate.create({ data: { stageId: text(body.stageId, 'stageId'), threshold: number(body.threshold ?? 80, 0, 100), enabled: body.enabled === undefined ? true : bool(body.enabled), criteria: json(body.criteria ?? []) } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'quality-gates.create', targetId: gate.id } })
      return gate
    })
  }
  @Patch(':id') @RequirePermission('quality-gates.update')
  async update(@Req() req: R, @Param('id') id: string, @Body() input: unknown) {
    const body = objectBody(input, ['threshold', 'enabled', 'criteria'])
    return this.db.$transaction(async tx => {
      const row = await tx.qualityGate.update({ where: { id }, data: {
        ...(body.threshold === undefined ? {} : { threshold: number(body.threshold, 0, 100) }),
        ...(body.enabled === undefined ? {} : { enabled: bool(body.enabled) }),
        ...(body.criteria === undefined ? {} : { criteria: json(body.criteria) }),
      } })
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'quality-gates.update', targetId: id } })
      return row
    })
  }
}

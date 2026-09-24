import { Inject, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { DatabaseService, isDatabaseUnavailable } from '../database/database.service'
import { AiError, AiTransport, classify, encryptSecret, validateBaseUrl, readBounded } from './transport'
import { applyMapping, isJson, parseApiWorkflow, record } from './mapping'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve, basename, relative, isAbsolute, sep } from 'node:path'
import { LlmProvider } from './llm.provider'
import type { AIService, Execution, Prisma, ServiceKind } from '@prisma/client'
import type { GenerateDto, UpdateServiceDto } from './ai.dto'

type User = { id: string; role?: string; permissions?: string[] }
const admin = (u: User) => u.role === 'ADMIN'
const owner = (u: User, row: { userId: string }, resource: 'tasks' | 'executions' | 'assets') =>
  row.userId === u.id || u.permissions?.includes(`${resource}.manage`) === true
const json = (v: unknown): Prisma.InputJsonObject => JSON.parse(JSON.stringify(v ?? {}))
type Job = Execution & { service: AIService }
type State = { status: string; progress?: number; startedAt?: Date; finishedAt?: Date; error?: { code: string; retrySafe?: boolean }; output?: Prisma.InputJsonObject }
type SubmitInput = { serviceId: string; taskId?: string; workflowId?: string; workflowVersion?: string; modelId?: string; input?: unknown }
type RemoteFile = { nodeId: string; filename: string; subfolder: string; type: string }

@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly transport = new AiTransport()
  private readonly active = new Map<string, AbortController>()
  private readonly queue: string[] = []
  private readonly streams = new Map<string, (text: string) => Promise<void>>()
  private running = 0
  private readonly max = Math.min(16, Math.max(1, Number(process.env.AI_CONCURRENCY) || 1))
  private timer?: NodeJS.Timeout
  private recovered = false
  private stopped = false
  private readonly startup = new Date()
  private nextRecovery = 0
  private nextDrain = 0
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async onModuleInit() { await this.tick() }
  onModuleDestroy() { this.stopped = true; if (this.timer) clearTimeout(this.timer); for (const c of this.active.values()) c.abort() }

  private async tick() {
    try {
      if (this.db.ready !== false) {
        if (!this.recovered && Date.now() >= this.nextRecovery) {
          this.nextRecovery = Date.now() + 5000
          await this.recover()
          this.recovered = true
        }
        if (this.recovered && !this.stopped) await this.drain()
      }
    } catch { /* DB/schema not ready: leave persisted execution states untouched and retry. */ }
    finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.tick(), 250)
        this.timer.unref()
      }
    }
  }

  private async recover() {
    // SUBMITTING without a promptId might already have reached the provider.
    await this.db.execution.updateMany({ where: { createdAt: { lte: this.startup }, status: { in: ['SUBMITTING', 'RUNNING'] }, promptId: null },
      data: { status: 'UNKNOWN_OUTCOME', error: { code: 'RESTART_WITHOUT_RECEIPT', retrySafe: false } } })
    const rows = await this.db.execution.findMany({ where: { OR: [
      { status: 'QUEUED' }, { status: { in: ['SUBMITTED', 'RUNNING', 'POLLING_ERROR'] }, promptId: { not: null } },
    ] } })
    for (const row of rows) if (!this.queue.includes(row.id) && !this.active.has(row.id)) this.queue.push(row.id)
  }
  private async drain() {
    if (Date.now() < this.nextDrain) return
    while (this.running < this.max && this.queue.length) {
      const id = this.queue.shift()!
      if (this.active.has(id)) continue
      this.running++
      void this.execute(id).catch(() => {
        // A failed initial read must not silently drop a persisted queued job.
        if (!this.stopped && !this.queue.includes(id)) this.queue.push(id)
        this.nextDrain = Date.now() + 5000
      }).finally(() => { this.running-- })
    }
  }
  private async execute(id: string) {
    const execution = await this.db.execution.findUnique({ where: { id }, include: { service: true, workflow: true } })
    if (!execution || !execution.service || execution.status === 'CANCELLED') return
    // A read retry after an uncertain write must never resubmit a receipt-less
    // execution that has already left QUEUED.
    if (!execution.promptId && execution.status !== 'QUEUED') return
    const controller = new AbortController(); this.active.set(id, controller)
    try {
      if (!['QUEUED', 'SUBMITTED', 'RUNNING', 'POLLING_ERROR'].includes(execution.status)) return
      if (!await this.setState(execution, { status: execution.promptId ? 'RUNNING' : 'SUBMITTING', startedAt: new Date() })) return
      if (execution.provider === 'COMFYUI') await this.comfy({ ...execution, service: execution.service }, controller)
      else await this.llm({ ...execution, service: execution.service }, controller)
    } catch (error) {
      // Losing the DB is not evidence that a provider failed. Never rewrite an
      // uncertain outcome as FAILED or automatically resubmit it.
      if (isDatabaseUnavailable(error)) return
      const latest = await this.db.execution.findUnique({ where: { id } })
      const code = classify(error)
      const status = latest?.status === 'CANCELLED' ? 'CANCELLED' :
        latest?.promptId && (['TIMEOUT', 'NETWORK_OR_PROTOCOL_ERROR', 'INVALID_PROVIDER_RESPONSE', 'PROVIDER_ERROR'].includes(code) || /^PROVIDER_HTTP_/.test(code)) ? 'POLLING_ERROR' :
        error instanceof AiError && error.outcomeUnknown ? 'UNKNOWN_OUTCOME' : 'FAILED'
      await this.setState(execution, { status, error: { code, retrySafe: false }, finishedAt: new Date() }).catch(() => {})
    } finally { this.active.delete(id) }
  }
  private async setState(e: Pick<Execution, 'id' | 'taskId'>, data: State, expectedStatus?: string) {
    return this.db.$transaction(async tx => {
      const changed = await tx.execution.updateMany({ where: { id: e.id, status: expectedStatus ?? { notIn: ['CANCELLED', 'SUCCESS', 'FAILED', 'UNKNOWN_OUTCOME'] } }, data })
      if (!changed.count) return false
      await tx.task.update({ where: { id: e.taskId }, data: {
        status: data.status, ...(data.progress === undefined ? {} : { progress: data.progress }),
        ...(data.error ? { error: data.error.code } : {}),
      } })
      return true
    })
  }
  private async comfy(e: Job, controller: AbortController) {
    let promptId = e.promptId
    if (!promptId) {
      const prompt = parseApiWorkflow(record(e.input) ? e.input.promptGraph : undefined)
      const response = await this.transport.request(e.service, '/prompt', { body: { prompt, client_id: e.id }, signal: controller.signal })
      if (!record(response)) throw new AiError('INVALID_PROVIDER_RESPONSE', true)
      if (response.error || (record(response.node_errors) && Object.keys(response.node_errors).length)) throw new AiError('INVALID_WORKFLOW')
      if (typeof response.prompt_id !== 'string' || !response.prompt_id) throw new AiError('INVALID_PROVIDER_RESPONSE', true)
      promptId = response.prompt_id
      // First operation after receipt, BEFORE polling or Task updates.
      try {
        // Keep the receipt even if cancellation won, without reviving the job.
        await this.db.execution.update({ where: { id: e.id }, data: { promptId } })
        await this.db.execution.updateMany({ where: { id: e.id, status: { not: 'CANCELLED' } }, data: { status: 'SUBMITTED' } })
      }
      catch { throw new AiError('RECEIPT_PERSIST_FAILED', true) }
    }
    const deadline = Date.now() + (Number(process.env.AI_EXECUTION_TIMEOUT_MS) || 1_800_000)
    while (!controller.signal.aborted) {
      if (Date.now() > deadline) throw new AiError('TIMEOUT')
      const history = await this.transport.request(e.service, `/history/${encodeURIComponent(promptId)}`, { signal: controller.signal })
      const entry = record(history) ? history[promptId] : undefined
      if (record(entry) && record(entry.status) && (entry.status.status_str === 'error' || (Array.isArray(entry.status.messages) && entry.status.messages.some((x: unknown) => Array.isArray(x) && ['execution_error', 'execution_interrupted'].includes(x[0])))))
        throw new AiError(/out of memory|cuda.*oom/i.test(JSON.stringify(entry.status)) ? 'CUDA_OOM' : 'PROVIDER_EXECUTION_ERROR')
      if (record(entry) && record(entry.status) && entry.status.completed === true) {
        const files = this.outputFiles(entry)
        if (!files.length) throw new AiError('NO_MEDIA_OUTPUT')
        if (await this.isCancelled(e.id)) throw new AiError('CANCELLED')
        const assets = []
        for (const f of files) assets.push(await this.archive(e, f, controller.signal))
        if (await this.isCancelled(e.id)) throw new AiError('CANCELLED')
        await this.setState(e, { status: 'SUCCESS', progress: 100, output: { assets, archiveStatus: 'SAVED' }, finishedAt: new Date() })
        return
      }
      if (record(entry) && record(entry.status) && entry.status.status_str === 'error') throw new AiError('PROVIDER_EXECUTION_ERROR')
      await new Promise(r => setTimeout(r, 1000))
    }
    throw new AiError('CANCELLED')
  }
  private async isCancelled(id: string) {
    const row = await this.db.execution.findUnique({ where: { id }, select: { status: true } })
    return row?.status === 'CANCELLED'
  }
  private outputFiles(entry: Record<string, unknown>) {
    const out: RemoteFile[] = []
    for (const [nodeId, value] of Object.entries(record(entry.outputs) ? entry.outputs : {})) {
      if (!record(value)) continue
      for (const type of ['images', 'gifs', 'videos', 'audio']) {
        const files = value[type]
        if (!Array.isArray(files)) continue
        for (const file of files) if (record(file) && typeof file.filename === 'string')
          out.push({ nodeId, filename: file.filename, subfolder: typeof file.subfolder === 'string' ? file.subfolder : '', type: typeof file.type === 'string' ? file.type : 'output' })
      }
    }
    return out
  }
  private async archive(e: Job, file: RemoteFile, signal: AbortSignal) {
    if (file.filename.includes('/') || file.filename.includes('\\') || /(^|[\\/])\.\.([\\/]|$)/.test(file.subfolder) ||
      !['output', 'temp'].includes(file.type)) throw new AiError('INVALID_REMOTE_FILE')
    const existing = await this.db.asset.findFirst({ where: { executionId: e.id, metadata: { path: '$.sourceKey', equals: JSON.stringify(file) } } })
    if (existing) return { id: existing.id, url: `/api/assets/${existing.id}/content` }
    const path = `/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type })}`
    const base = this.assetRoot()
    await mkdir(base, { recursive: true })
    const name = basename(file.filename).replace(/[^a-zA-Z0-9._-]/g, '_')
    const target = join(base, randomUUID())
    const downloaded = await this.transport.request(e.service, path, { signal, timeout: 120_000, consume: async r => ({
      bytes: await readBounded(r, Number(process.env.AI_MAX_ASSET_BYTES) || 128 * 1024 * 1024), mime: r.headers.get('content-type') ?? 'application/octet-stream',
    }) })
    await writeFile(target, downloaded.bytes, { flag: 'wx', mode: 0o600 })
    // A DB failure can have an unknown commit outcome; retain the file for reconciliation.
    const asset = await this.db.asset.create({ data: { userId: e.userId, taskId: e.taskId, executionId: e.id, name,
        type: downloaded.mime.split('/')[0], mimeType: downloaded.mime, storagePath: target,
        metadata: { provider: 'comfyui', sourceKey: JSON.stringify(file), archiveStatus: 'SAVED' }, isPublic: false } })
    return { id: asset.id, url: `/api/assets/${asset.id}/content` }
  }
  private async llm(e: Job, controller: AbortController) {
    const model = e.modelId ? await this.db.aIModel.findUnique({ where: { id: e.modelId } }) : null
    if (!model?.enabled || model.serviceId !== e.serviceId) throw new AiError('MODEL_MUST_BE_DISCOVERED')
    const output = await new LlmProvider(this.transport).generate(e.service, model.remoteId, e.input, controller.signal, this.streams.get(e.id))
    const root = this.assetRoot()
    await mkdir(root, { recursive: true })
    const target = join(root, randomUUID())
    await writeFile(target, output.text, { flag: 'wx', mode: 0o600 })
    const asset = await this.db.asset.create({ data: { userId: e.userId, taskId: e.taskId, executionId: e.id,
        name: record(e.input) && e.input.mode === 'json' ? 'generation.json' : 'generation.txt', type: 'text',
        mimeType: record(e.input) && e.input.mode === 'json' ? 'application/json' : 'text/plain', storagePath: target,
        metadata: { archiveStatus: 'SAVED' }, isPublic: false } })
    if (await this.isCancelled(e.id)) throw new AiError('CANCELLED')
    await this.setState(e, { status: 'SUCCESS', progress: 100, output: { ...json(output),
      archiveStatus: 'SAVED', assets: [{ id: asset.id, url: `/api/assets/${asset.id}/content` }] }, finishedAt: new Date() })
  }
  private assetRoot() {
    return resolve(process.env.AI_ASSET_ROOT ?? join(process.env.STORAGE_PATH ?? './storage', 'assets'))
  }

  listServices(group: 'COMFYUI' | 'LLM') { return this.db.aIService.findMany({ where: { kind: group === 'COMFYUI' ? 'COMFYUI' : { in: ['OPENAI', 'OLLAMA'] } }, select: { id: true, name: true, kind: true, baseUrl: true, enabled: true, health: true } }) }
  private serviceData(input: UpdateServiceDto & { kind?: string }, create: boolean) {
    if ((create || input.name !== undefined) && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200)) throw new AiError('INVALID_NAME')
    if (create && !['COMFYUI', 'OPENAI', 'OLLAMA'].includes(input.kind ?? '')) throw new AiError('INVALID_KIND')
    if (create || input.baseUrl !== undefined) validateBaseUrl(input.baseUrl ?? '')
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new AiError('INVALID_ENABLED')
    if (input.secret !== undefined && (typeof input.secret !== 'string' || input.secret.length > 8192)) throw new AiError('INVALID_SECRET')
    return { ...(input.name === undefined ? {} : { name: input.name }), ...(create ? { kind: input.kind as ServiceKind } : {}),
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.secret === undefined ? {} : { secretEncrypted: input.secret ? encryptSecret(input.secret) : null }) }
  }
  async createService(u: User, input: UpdateServiceDto & { name: string; baseUrl: string; kind: string }) { if (!admin(u)) throw new AiError('FORBIDDEN'); return this.db.aIService.create({ data: { ...this.serviceData(input, true), name: input.name, baseUrl: input.baseUrl, kind: input.kind as ServiceKind }, select: { id: true, name: true, kind: true, baseUrl: true, enabled: true, health: true } }) }
  private async findService(id: string, group?: 'COMFYUI' | 'LLM') {
    const s = await this.db.aIService.findUnique({ where: { id } })
    if (!s || (group && (s.kind === 'COMFYUI') !== (group === 'COMFYUI'))) throw new AiError('NOT_FOUND')
    return s
  }
  async updateService(u: User, id: string, input: UpdateServiceDto, group?: 'COMFYUI' | 'LLM') { if (!admin(u)) throw new AiError('FORBIDDEN'); await this.findService(id, group); const data = this.serviceData(input, false); delete (data as { kind?: ServiceKind }).kind; return this.db.aIService.update({ where: { id }, data, select: { id: true, name: true, kind: true, baseUrl: true, enabled: true, health: true } }) }
  async deleteService(u: User, id: string, group: 'COMFYUI' | 'LLM') {
    if (!admin(u)) throw new AiError('FORBIDDEN')
    await this.findService(id, group)
    return this.db.$transaction(async tx => {
      if (await tx.execution.count({ where: { serviceId: id } }) || await tx.workflow.count({ where: { instanceId: id } }))
        throw new AiError('SERVICE_IN_USE')
      await tx.aIModel.deleteMany({ where: { serviceId: id } })
      await tx.aIService.delete({ where: { id } })
      return { deleted: true }
    })
  }
  async testService(u: User, id: string, group: 'COMFYUI' | 'LLM') {
    if (!admin(u) || !u.permissions?.includes('providers.update')) throw new AiError('FORBIDDEN')
    const s = await this.findService(id, group)
    try {
      const data = await this.transport.request(s, s.kind === 'COMFYUI' ? '/system_stats' : s.kind === 'OLLAMA' ? '/api/tags' : '/models')
      if (s.kind === 'COMFYUI'
        ? !record(data.system) || !Array.isArray(data.devices)
        : !Array.isArray(s.kind === 'OLLAMA' ? data.models : data.data)) throw new AiError('INVALID_PROVIDER_RESPONSE')
      const health = { ok: true, checkedAt: new Date().toISOString() }
      await this.db.aIService.update({ where: { id }, data: { health } })
      return health
    } catch (error) {
      const health = { ok: false, code: classify(error), checkedAt: new Date().toISOString() }
      await this.db.aIService.update({ where: { id }, data: { health } })
      return health
    }
  }
  async syncModels(u: User, id: string, group: 'COMFYUI' | 'LLM') {
    if (!admin(u) || !u.permissions?.includes('providers.update')) throw new AiError('FORBIDDEN')
    const s = await this.findService(id, group)
    const data = await this.transport.request(s, s.kind === 'COMFYUI' ? '/object_info' : s.kind === 'OLLAMA' ? '/api/tags' : '/models')
    if (!record(data)) throw new AiError('INVALID_MODEL_DISCOVERY')
    let names: string[]
    if (s.kind === 'COMFYUI') {
      const found = new Set<string>()
      for (const [node, info] of Object.entries(data)) {
        if (!/loader/i.test(node) || !record(info)) continue
        const input = record(info.input) ? info.input : {}
        for (const spec of Object.values({ ...(record(input.required) ? input.required : {}), ...(record(input.optional) ? input.optional : {}) })) {
          if (Array.isArray(spec) && Array.isArray(spec[0])) for (const option of spec[0]) if (typeof option === 'string') found.add(option)
        }
      }
      names = [...found]
    } else {
      const list = s.kind === 'OLLAMA' ? data.models : data.data
      if (!Array.isArray(list)) throw new AiError('INVALID_MODEL_DISCOVERY')
      names = list.map((m: unknown) => record(m) ? s.kind === 'OLLAMA' ? m.name : m.id : undefined).filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
    }
    names = [...new Set(names)].slice(0, 5000)
    const models = await this.db.$transaction(async tx => {
      await tx.aIModel.updateMany({ where: { serviceId: id }, data: { enabled: false } })
      const result = []
      for (const remoteId of names) result.push(await tx.aIModel.upsert({
        where: { serviceId_remoteId: { serviceId: id, remoteId } },
        create: { serviceId: id, remoteId, name: remoteId, metadata: { discovered: true } },
        update: { enabled: true, metadata: { discovered: true } },
      }))
      return result
    })
    return { availability: models.length ? 'Available' : 'Unavailable', models,
      workflowDiscovery: 'Unavailable: import API/UI JSON explicitly' }
  }
  async importWorkflow(u: User, serviceId: string, input: unknown) {
    if (!admin(u)) throw new AiError('FORBIDDEN')
    const service = await this.db.aIService.findUnique({ where: { id: serviceId } })
    if (service?.kind !== 'COMFYUI') throw new AiError('COMFYUI_SERVICE_REQUIRED')
    if (!record(input) || typeof input.name !== 'string' || !input.name.trim()) throw new AiError('INVALID_NAME')
    if (input.apiWorkflowJson) parseApiWorkflow(input.apiWorkflowJson)
    if (!input.apiWorkflowJson && !record(input.workflowJson)) throw new AiError('WORKFLOW_JSON_REQUIRED')
    return this.db.workflow.create({ data: { name: input.name, description: typeof input.description === 'string' ? input.description : '',
      provider: 'COMFYUI', type: typeof input.type === 'string' ? input.type : 'image', instanceId: serviceId, status: 'DRAFT',
      apiWorkflowJson: input.apiWorkflowJson ? json(input.apiWorkflowJson) : undefined, workflowJson: input.workflowJson ? json(input.workflowJson) : undefined, mapping: json(input.mapping ?? {}), version: '1' } })
  }
  listModels() { return this.db.aIModel.findMany({ where: { enabled: true, service: { enabled: true, kind: { in: ['OPENAI', 'OLLAMA'] } } }, select: { id: true, serviceId: true, remoteId: true, name: true, enabled: true, metadata: true } }) }
  localQueue(u: User) { if (!admin(u)) throw new AiError('FORBIDDEN'); return { running: this.running, queued: this.queue.length, limit: this.max } }
  async submit(u: User, input: SubmitInput, enqueue = true) {
    if (!this.recovered) throw new ServiceUnavailableException({ code: 'EXECUTION_RECOVERY_PENDING' })
    if (typeof input.serviceId !== 'string') throw new AiError('INVALID_INPUT')
    if (input.input !== undefined && (!record(input.input) || !isJson(input.input))) throw new AiError('INVALID_INPUT')
    const task = input.taskId ? await this.db.task.findUnique({ where: { id: input.taskId } }) : null
    if (input.taskId && (!task || !owner(u, task, 'tasks'))) throw new AiError('FORBIDDEN')
    const service = await this.db.aIService.findUnique({ where: { id: input.serviceId } })
    if (!service?.enabled) throw new AiError('SERVICE_DISABLED')
    const workflow = input.workflowId ? await this.db.workflow.findUnique({ where: { id: input.workflowId } }) : null
    if (service.kind === 'COMFYUI' && (workflow?.status !== 'ACTIVE' || !workflow.apiWorkflowJson || !workflow.mapping ||
      (workflow.instanceId && workflow.instanceId !== service.id))) throw new AiError('API_WORKFLOW_AND_MAPPING_REQUIRED')
    if (input.workflowVersion !== undefined && input.workflowVersion !== workflow?.version) throw new AiError('WORKFLOW_VERSION_MISMATCH')
    if (service.kind !== 'COMFYUI') {
      const model = typeof input.modelId === 'string' ? await this.db.aIModel.findUnique({ where: { id: input.modelId } }) : null
      if (!model?.enabled || model.serviceId !== service.id) throw new AiError('MODEL_MUST_BE_DISCOVERED')
      const values: Record<string, unknown> = record(input.input) ? input.input : {}
      if (typeof values.prompt !== 'string' || !values.prompt.trim()) throw new AiError('INVALID_PROMPT')
    }
    const payload = service.kind === 'COMFYUI'
      ? { promptGraph: applyMapping(workflow!.apiWorkflowJson, workflow!.mapping, record(input.input) ? input.input : {}) }
      : json(input.input ?? {})
    const e = await this.db.$transaction(async tx => {
      const t = task ?? await tx.task.create({ data: { userId: u.id, title: 'AI generation', kind: service.kind === 'COMFYUI' ? 'media' : 'text',
        stages: [], request: json(input), script: '', previousScript: '', characters: [], shots: [], logs: [] } })
      if (task && await tx.execution.count({ where: { taskId: t.id, status: { in: ['QUEUED', 'SUBMITTING', 'RUNNING', 'SUBMITTED', 'UNKNOWN_OUTCOME', 'POLLING_ERROR'] } } }))
        throw new AiError('TASK_ALREADY_ACTIVE')
      return tx.execution.create({ data: { taskId: t.id, userId: u.id, provider: service.kind, serviceId: service.id,
        workflowId: workflow?.id, workflowVersion: workflow?.version, modelId: input.modelId, input: payload } })
    })
    if (enqueue) this.queue.push(e.id)
    return { id: e.id, status: e.status }
  }
  async generate(u: User, input: GenerateDto, signal?: AbortSignal, delta?: (text: string) => Promise<void>) {
    if (signal?.aborted) throw new AiError('CANCELLED')
    const service = await this.db.aIService.findUnique({ where: { id: input.serviceId } })
    if (!service || service.kind === 'COMFYUI') throw new AiError('LLM_SERVICE_REQUIRED')
    const e = await this.submit(u, { ...input, input: { prompt: input.prompt, mode: input.mode ?? 'ordinary' } }, false)
    if (delta) this.streams.set(e.id, delta)
    const abort = () => { void this.cancel(u, e.id).catch(() => {}) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    this.queue.push(e.id)
    try {
      while (true) {
        const row = await this.getExecution(u, e.id)
        if (!['QUEUED', 'SUBMITTING', 'RUNNING', 'SUBMITTED'].includes(row.status)) return row
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    } finally { signal?.removeEventListener('abort', abort); this.streams.delete(e.id) }
  }
  async getExecution(u: User, id: string) { const e = await this.db.execution.findUnique({ where: { id } }); if (!e || !owner(u, e, 'executions')) throw new AiError('FORBIDDEN'); return e }
  async cancel(u: User, id: string) {
    const e = await this.getExecution(u, id)
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(e.status)) return { status: e.status }
    if (e.provider === 'COMFYUI' && e.status !== 'QUEUED') {
      if (!e.promptId) throw new AiError('UNKNOWN_OUTCOME_CANCEL_UNSAFE')
      if (!e.serviceId) throw new AiError('NOT_FOUND')
      const service = await this.db.aIService.findUniqueOrThrow({ where: { id: e.serviceId } })
      const queue = await this.transport.request(service, '/queue')
      // /interrupt is global and queue check+interrupt is not atomic in native ComfyUI.
      // Never interrupt a running prompt; deleting a pending prompt by id is scoped.
      if (!record(queue) || !Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new AiError('UNSAFE_QUEUE_STATE')
      if (queue.queue_running.some((x: unknown) => Array.isArray(x) && x[1] === e.promptId)) throw new AiError('GLOBAL_INTERRUPT_UNSAFE')
      if (!queue.queue_pending.some((x: unknown) => Array.isArray(x) && x[1] === e.promptId)) throw new AiError('PROMPT_NOT_PENDING')
      await this.transport.request(service, '/queue', { body: { delete: [e.promptId] } })
    }
    if (!await this.setState(e, { status: 'CANCELLED', finishedAt: new Date(), error: { code: 'CANCELLED' } }, e.status)) throw new AiError('CANCEL_STATE_CHANGED_UNSAFE')
    this.active.get(id)?.abort()
    return { status: 'CANCELLED' }
  }
  async taskEvents(u: User, taskId: string) {
    const task = await this.db.task.findUnique({ where: { id: taskId } })
    if (!task || !owner(u, task, 'tasks')) throw new AiError('FORBIDDEN')
    return this.db.execution.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } })
  }
  async events(u: User, executionId: string) {
    const e = await this.getExecution(u, executionId)
    return { id: e.id, status: e.status, progress: e.progress, promptId: e.promptId, error: e.error, output: e.output }
  }
  async asset(u: User, id: string) {
    const a = await this.db.asset.findUnique({ where: { id } })
    if (!a || (!a.isPublic && !owner(u, a, 'assets'))) throw new AiError('FORBIDDEN')
    if (!a.storagePath) throw new AiError('ASSET_NOT_READY')
    const realRoot = await realpath(this.assetRoot())
    const realFile = await realpath(a.storagePath)
    const rel = relative(realRoot, realFile)
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || !(await stat(realFile)).isFile()) throw new AiError('INVALID_ASSET_PATH')
    return { asset: a, path: realFile }
  }
}

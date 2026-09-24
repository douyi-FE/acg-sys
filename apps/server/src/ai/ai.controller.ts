import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, Res, Sse, MessageEvent } from '@nestjs/common'
import { Observable, interval, from } from 'rxjs'
import { switchMap, distinctUntilChanged, takeWhile, map } from 'rxjs/operators'
import { AiService } from './ai.service'
import { RequirePermission } from '../common/permissions'
import type { Response } from 'express'
import { classify } from './transport'
import { AuthenticatedRequest, CreateInstanceDto, CreateLlmServiceDto, GenerateDto, SubmitDto, UpdateServiceDto } from './ai.dto'

const user = (req: AuthenticatedRequest) => req.user
@Controller('/api/comfyui')
export class ComfyUiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}
  @Get('/instances') @RequirePermission('providers.read') instances() { return this.ai.listServices('COMFYUI') }
  @Post('/instances') @RequirePermission('providers.create') create(@Req() r: AuthenticatedRequest, @Body() b: CreateInstanceDto) { return this.ai.createService(user(r), { ...b, kind: 'COMFYUI' }) }
  @Patch('/instances/:id') @RequirePermission('providers.update') update(@Req() r: AuthenticatedRequest, @Param('id') id: string, @Body() b: UpdateServiceDto) { return this.ai.updateService(user(r), id, b, 'COMFYUI') }
  @Delete('/instances/:id') @RequirePermission('providers.delete') remove(@Req() r: AuthenticatedRequest, @Param('id') id: string) { return this.ai.deleteService(user(r), id, 'COMFYUI') }
  @Post('/instances/:id/test') @RequirePermission('providers.update') test(@Req() r: AuthenticatedRequest, @Param('id') id: string) { return this.ai.testService(user(r), id, 'COMFYUI') }
  @Post('/instances/:id/sync-models') @RequirePermission('providers.update') sync(@Req() r: AuthenticatedRequest, @Param('id') id: string) { return this.ai.syncModels(user(r), id, 'COMFYUI') }
  @Post('/executions/submit') @RequirePermission('executions.create') submit(@Req() r: AuthenticatedRequest, @Body() b: SubmitDto) { return this.ai.submit(user(r), b) }
  @Get('/executions/:id/status') @RequirePermission('executions.read') status(@Req() r: AuthenticatedRequest, @Param('id') id: string) { return this.ai.getExecution(user(r), id) }
  @Sse('/executions/:id/events') @RequirePermission('executions.read') events(@Req() r: AuthenticatedRequest, @Param('id') id: string): Observable<MessageEvent> {
    return interval(500).pipe(switchMap(() => from(this.ai.events(user(r), id))), map(data => ({ data } as MessageEvent)),
      distinctUntilChanged((a, b) => JSON.stringify(a.data) === JSON.stringify(b.data)),
      takeWhile(x => !['SUCCESS', 'FAILED', 'CANCELLED', 'UNKNOWN_OUTCOME'].includes((x.data as { status?: string }).status ?? ''), true))
  }
  @Post('/executions/:id/cancel') @RequirePermission('executions.cancel') cancel(@Req() r: AuthenticatedRequest, @Param('id') id: string) { return this.ai.cancel(user(r), id) }
  @Get('/executions/queue') @RequirePermission('executions.read') queue(@Req() r: AuthenticatedRequest) { return this.ai.localQueue(user(r)) }
}

@Controller('/api/llm')
export class LlmController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}
  @Get('/services') @RequirePermission('providers.read') services() { return this.ai.listServices('LLM') }
  @Post('/services') @RequirePermission('providers.create') create(@Req() r: AuthenticatedRequest, @Body() b: CreateLlmServiceDto) { return this.ai.createService(user(r), b) }
  @Patch('/services/:id') @RequirePermission('providers.update') update(@Req() r: AuthenticatedRequest, @Param('id') id: string, @Body() b: UpdateServiceDto) { return this.ai.updateService(user(r), id, b, 'LLM') }
  @Delete('/services/:id') @RequirePermission('providers.delete') remove(@Req() r: AuthenticatedRequest, @Param('id') id: string) { return this.ai.deleteService(user(r), id, 'LLM') }
  @Post('/services/:id/test') @RequirePermission('providers.update') test(@Req() r: AuthenticatedRequest, @Param('id') id: string) { return this.ai.testService(user(r), id, 'LLM') }
  @Post('/services/:id/sync-models') @RequirePermission('providers.update') sync(@Req() r: AuthenticatedRequest, @Param('id') id: string) { return this.ai.syncModels(user(r), id, 'LLM') }
  @Get('/models') @RequirePermission('models.read') models() { return this.ai.listModels() }
  @Post('/generate') @RequirePermission('executions.create') generate(@Req() r: AuthenticatedRequest, @Body() b: GenerateDto) { return this.ai.generate(user(r), b) }
  @Post('/generate/stream') @RequirePermission('executions.create') async stream(@Req() r: AuthenticatedRequest, @Body() b: GenerateDto, @Res() response: Response) {
    const controller = new AbortController()
    response.on('close', () => controller.abort())
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders()
    const send = async (event: string, data: unknown) => {
      if (controller.signal.aborted) throw new Error('AbortError')
      await new Promise<void>((resolve, reject) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, err => err ? reject(err) : resolve()))
    }
    try {
      const result = await this.ai.generate(user(r), b, controller.signal, text => send('delta', { text, archiveStatus: 'PENDING' }))
      await send('done', result)
    } catch (error) { if (!controller.signal.aborted) await send('error', { code: classify(error), archiveStatus: 'NOT_CONFIRMED' }) }
    finally { response.end() }
  }
}

@Controller('/api/tasks')
export class TaskEventsController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}
  @Sse('/:id/events') @RequirePermission('executions.read') events(@Req() r: AuthenticatedRequest, @Param('id') id: string): Observable<MessageEvent> {
    return interval(500).pipe(switchMap(() => from(this.ai.taskEvents(user(r), id))), map(data => ({ data } as MessageEvent)))
  }
}

@Controller('/api/assets')
export class AssetController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}
  @Get('/:id/content') @RequirePermission('assets.read') async content(@Req() r: AuthenticatedRequest, @Param('id') id: string, @Res() response: Response) {
    const found = await this.ai.asset(user(r), id)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    response.setHeader('Cache-Control', 'private, no-store')
    response.type(found.asset.mimeType ?? 'application/octet-stream')
    response.sendFile(found.path)
  }
  @Get('/:id/download') @RequirePermission('assets.read') async download(@Req() r: AuthenticatedRequest, @Param('id') id: string, @Res() response: Response) {
    const found = await this.ai.asset(user(r), id); response.download(found.path, found.asset.name)
  }
}

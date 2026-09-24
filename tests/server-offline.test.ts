import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseService } from '../apps/server/src/database/database.service'
import { AiService } from '../apps/server/src/ai/ai.service'
import { HealthController } from '../apps/server/src/workspace/workspace.controller'
import { ApiExceptionFilter } from '../apps/server/src/common/http'
import type { Response } from 'express'
import type { ArgumentsHost } from '@nestjs/common'
import { AuthGuard } from '../apps/server/src/auth/guards'
import type { Reflector } from '@nestjs/core'
import type { JwtService } from '@nestjs/jwt'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('offline dependency lifecycle', () => {
  it('production auth ignores frontend bypass headers and mock environment', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VITE_API_MODE', 'mock')
    const guard = new AuthGuard({ getAllAndOverride: () => false } as unknown as Reflector,
      {} as DatabaseService, {} as JwtService)
    const context = { getHandler: () => ({}), getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-dev-mode': 'mock', 'x-auth-bypass': 'true' } }) }) }
    await expect(guard.canActivate(context as never)).rejects.toThrow()
  })
  it('production stays available for offline errors, never fabricates database readiness', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VITE_API_MODE', 'mock')
    const db = new DatabaseService()
    vi.spyOn(db, '$queryRaw').mockRejectedValue(new Error('offline'))
    vi.spyOn(db, '$disconnect').mockResolvedValue()
    await expect(db.onModuleInit()).resolves.toBeUndefined()
    expect(db.ready).toBe(false)
    await db.onModuleDestroy()
  })
  it('starts offline, returns health 503, reconnects without overlap and cleans up', async () => {
    vi.useFakeTimers()
    vi.stubEnv('NODE_ENV', 'development')
    const db = new DatabaseService()
    const query = vi.spyOn(db, '$queryRaw').mockRejectedValue(new Error('private connection detail'))
    vi.spyOn(db, '$disconnect').mockResolvedValue()
    await expect(db.onModuleInit()).resolves.toBeUndefined()
    expect(db.ready).toBe(false)
    const status = vi.fn()
    const health = new HealthController(db)
    expect(await health.health({ status } as unknown as Response)).toMatchObject({ database: 'down', backend: 'up' })
    expect(status).toHaveBeenCalledWith(503)
    query.mockResolvedValue([{ value: 1 }])
    await vi.advanceTimersByTimeAsync(5000)
    expect(db.ready).toBe(true)
    expect(await health.health({ status } as unknown as Response)).toMatchObject({ database: 'up' })
    expect(status).toHaveBeenLastCalledWith(200)
    await db.onModuleDestroy()
    const count = query.mock.calls.length
    await vi.advanceTimersByTimeAsync(15000)
    expect(query).toHaveBeenCalledTimes(count)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not recover while DB is offline; retries recovery and never reclassifies new jobs', async () => {
    vi.useFakeTimers()
    const updateMany = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ count: 0 })
    const findMany = vi.fn().mockResolvedValue([])
    const db = { ready: false, execution: { updateMany, findMany } }
    const service = new AiService(db as unknown as DatabaseService)
    await service.onModuleInit()
    expect(updateMany).not.toHaveBeenCalled()
    db.ready = true
    await vi.advanceTimersByTimeAsync(250)
    expect(updateMany).toHaveBeenCalledTimes(1)
    await expect(service.submit({ id: 'u' }, { serviceId: 's' })).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(5000)
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(updateMany.mock.calls[1]![0].where.createdAt.lte).toBeInstanceOf(Date)
    await vi.advanceTimersByTimeAsync(10000)
    expect(updateMany).toHaveBeenCalledTimes(2)
    service.onModuleDestroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sanitizes Prisma connectivity errors as 503 without exposing secrets', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    new ApiExceptionFilter().catch({ code: 'P1001', message: 'private-url-password' },
      { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json.mock.calls[0]![0].error.code).toBe('DATABASE_UNAVAILABLE')
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('private-url-password')
  })
})

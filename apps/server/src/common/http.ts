import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { map } from 'rxjs/operators'
import type { NextFunction, Request, Response } from 'express'
import { SSE_METADATA } from '@nestjs/common/constants'
import { isDatabaseUnavailable } from '../database/database.service'

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    let status = exception instanceof HttpException ? exception.getStatus() : 500
    const prismaCode = (exception as { code?: string })?.code
    if (prismaCode === 'P2002' || prismaCode === 'P2003' || prismaCode === 'P2034') status = 409
    if (prismaCode === 'P2025') status = 404
    if (isDatabaseUnavailable(exception)) status = 503
    const body = exception instanceof HttpException ? exception.getResponse() : null
    const object = typeof body === 'object' && body ? body as { code?: string; message?: string | string[] } : null
    const codes: Record<number, string> = { 400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMITED' }
    res.status(status).json({ error: {
      code: isDatabaseUnavailable(exception) ? 'DATABASE_UNAVAILABLE' : object?.code || codes[status] || 'INTERNAL_ERROR',
      message: status >= 500 ? '服务暂不可用' : object?.message || (typeof body === 'string' ? body : '请求无法完成'),
    } })
  }
}
@Injectable()
export class DataInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler()) || Reflect.getMetadata(SSE_METADATA, context.getClass())) return next.handle()
    return next.handle().pipe(map(data => ({ data })))
  }
}

export function securityMiddleware(origins: Set<string>) {
  const buckets = new Map<string, { count: number; until: number }>()
  let cleanupAt = 0
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    res.setHeader('Cache-Control', 'no-store')
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    const origin = req.headers.origin
    if ((origin && !origins.has(origin)) || (unsafe && !origin)) {
      res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: '请求来源不受信任' } }); return
    }
    if (unsafe && req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: { code: 'CSRF_REJECTED', message: '禁止跨站请求' } }); return
    }
    const now = Date.now()
    if (now >= cleanupAt) {
      for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key)
      cleanupAt = now + 60000
    }
    const auth = /^\/api\/auth\/(login|refresh)/.test(req.path)
    const key = `${req.ip}:${auth ? 'auth' : 'api'}`
    const bucket = buckets.get(key)
    const current = bucket && bucket.until > now ? bucket : { count: 0, until: now + 60000 }
    if (buckets.size >= 10000 && !buckets.has(key)) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: '请求过于频繁' } }); return
    }
    buckets.set(key, current)
    if (++current.count > (auth ? 15 : 300)) {
      res.setHeader('Retry-After', String(Math.ceil((current.until - now) / 1000)))
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: '请求过于频繁' } }); return
    }
    next()
  }
}

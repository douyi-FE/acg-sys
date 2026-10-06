import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

export function isDatabaseUnavailable(error: unknown) {
  const e = error as { code?: string; name?: string }
  return e?.name === 'PrismaClientInitializationError' ||
    ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(e?.code ?? '')
}

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  ready = false
  configured = Boolean(process.env.DATABASE_URL)
  lastError?: { code: string; message: string }
  private stopped = false
  private timer?: NodeJS.Timeout
  private pending?: Promise<boolean>
  private readonly logger = new Logger(DatabaseService.name)

  constructor() {
    // Bound driver operations, not just a Promise.race that leaves connections running.
    const url = process.env.DATABASE_URL
    const parsed = url ? new URL(url) : undefined
    if (parsed) {
      parsed.searchParams.set('connect_timeout', '2')
      parsed.searchParams.set('pool_timeout', '2')
      parsed.searchParams.set('socket_timeout', '3')
    }
    super(parsed ? { datasources: { db: { url: parsed.toString() } } } : undefined)
  }
  async onModuleInit() {
    if (!await this.check()) this.logger.warn('Database unavailable; readiness and business requests return 503. Authentication remains mandatory.')
  }
  check(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false)
    if (this.pending) return this.pending
    this.pending = (async () => {
      try {
        if (!this.configured) {
          this.ready = false
          this.lastError = {
            code: 'DATABASE_URL_MISSING',
            message: '服务端未配置 DATABASE_URL，请在服务端 .env 中配置 MySQL 连接地址后重启。',
          }
          return false
        }
        await this.$queryRaw`SELECT 1`
        this.ready = !this.stopped
        this.lastError = undefined
      } catch (error) {
        if (this.ready) this.logger.warn('Database unavailable; requests will return 503')
        this.ready = false
        const value = error as { code?: string; message?: string }
        this.lastError = {
          code: value.code ?? 'DATABASE_CONNECTION_FAILED',
          message: '数据库连接失败，请检查 DATABASE_URL、MySQL 状态、账号权限和网络连通性。',
        }
      }
      return this.ready
    })().finally(() => {
      this.pending = undefined
      if (!this.stopped) {
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.check(), 5000)
        this.timer.unref()
      }
    })
    return this.pending
  }
  async onModuleDestroy() {
    this.stopped = true
    this.ready = false
    if (this.timer) clearTimeout(this.timer)
    await this.pending
    await this.$disconnect()
  }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}

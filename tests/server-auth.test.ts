import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { Module, ValidationPipe } from '@nestjs/common'
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import request from 'supertest'
import { hashPassword, redact, tokenHash, validatePassword, verifyPassword } from '../apps/server/src/common/security'
import { assertOwner, objectBody } from '../apps/server/src/common/input'
import { ApiExceptionFilter, DataInterceptor, securityMiddleware } from '../apps/server/src/common/http'
import { RequestUser } from '../apps/server/src/common/permissions'
import { AuthGuard, PermissionGuard } from '../apps/server/src/auth/guards'
import { AuthController } from '../apps/server/src/auth/auth.controller'
import { RolesController, UsersController } from '../apps/server/src/admin/admin.controllers'
import { DatabaseModule, DatabaseService } from '../apps/server/src/database/database.service'

const user: RequestUser = { id: 'owner', username: 'owner', role: 'GUEST', roleId: 'guest', permissions: [], forceChangePassword: false, tokenVersion: 0 }
describe('server security boundaries (no external services)', () => {
  it('uses random salted scrypt, rejects incorrect and malformed passwords', () => {
    const password = randomBytes(18).toString('base64url')
    const hash = hashPassword(password)
    expect(hash).not.toContain(password)
    expect(hashPassword(password)).not.toBe(hash)
    expect(verifyPassword(password, hash)).toBe(true)
    expect(verifyPassword('incorrect', hash)).toBe(false)
    expect(verifyPassword(password, 'not-a-hash')).toBe(false)
  })
  it('enforces password bounds', () => {
    expect(() => validatePassword('short')).toThrow()
    expect(() => validatePassword('x'.repeat(129))).toThrow()
    expect(() => validatePassword('x'.repeat(12))).not.toThrow()
  })
  it('hashes refresh tokens without retaining raw credentials', () => {
    const raw = randomBytes(48).toString('base64url')
    expect(tokenHash(raw)).toHaveLength(64)
    expect(tokenHash(raw)).not.toContain(raw)
  })
  it('rejects ownership injection and unknown fields', () => {
    expect(() => objectBody({ title: 'x', userId: 'victim' }, ['title'])).toThrow()
    expect(() => objectBody([], ['title'])).toThrow()
  })
  it('denies foreign objects, allows public reads but never public writes', () => {
    expect(() => assertOwner(user, { userId: 'victim' }, 'tasks')).toThrow()
    expect(() => assertOwner(user, { userId: 'victim', isPublic: true }, 'tasks')).not.toThrow()
    expect(() => assertOwner(user, { userId: 'victim', isPublic: true }, 'tasks', true)).toThrow()
    expect(() => assertOwner(user, null, 'tasks')).toThrow()
    expect(() => assertOwner({ ...user, permissions: ['tasks.manage'] }, { userId: 'victim' }, 'tasks', true)).not.toThrow()
  })
  it('recursively redacts sensitive audit metadata', () => {
    const result = redact({ password: 'sensitive', child: { accessToken: 'sensitive', apiKey: 'sensitive', action: 'safe' } })
    expect(JSON.stringify(result)).not.toContain('sensitive')
    expect(JSON.stringify(result)).toContain('safe')
  })
  it('requires current permissions, not role-name or stale token claims', () => {
    const reflector = { getAllAndOverride: (key: string) => key === 'permissions' ? ['users.update'] : false }
    const guard = new PermissionGuard(reflector as unknown as Reflector)
    const context = { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => ({ user }) }) }
    expect(() => guard.canActivate(context as never)).toThrow()
  })
  it('re-reads disabled users and rejects their otherwise valid JWT', async () => {
    const guard = new AuthGuard(
      { getAllAndOverride: () => false } as unknown as Reflector,
      { user: { findUnique: async () => ({ ...user, enabled: false, role: { enabled: true } }) } } as unknown as DatabaseService,
      { verifyAsync: async () => ({ sub: 'owner', ver: 0 }) } as unknown as JwtService,
    )
    const context = { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer signed' } }) }) }
    await expect(guard.canActivate(context as never)).rejects.toThrow()
  })
  it('rejects absent and hostile Origins and rate limits authentication', () => {
    const middleware = securityMiddleware(new Set(['http://localhost:5173']))
    let status = 200; let passed = 0
    const res = { setHeader: () => {}, status: (value: number) => { status = value; return res }, json: () => {} }
    const req = { method: 'POST', path: '/api/auth/login', ip: '127.0.0.1', headers: {} as Record<string, string> }
    middleware(req as never, res as never, () => { passed++ })
    expect(status).toBe(403)
    req.headers.origin = 'https://evil.invalid'
    middleware(req as never, res as never, () => { passed++ })
    expect(passed).toBe(0)
    req.headers.origin = 'http://localhost:5173'
    for (let i = 0; i < 16; i++) middleware(req as never, res as never, () => { passed++ })
    expect(passed).toBe(15)
    expect(status).toBe(429)
  })
})

// Opt-in real MySQL integration. A dedicated *_test database is mandatory.
const testUrl = process.env.TEST_DATABASE_URL
const integration = testUrl ? describe : describe.skip
integration('real Nest HTTP + MySQL authentication and RBAC', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>
  let db: DatabaseService
  let adminId: string; let guestId: string; let adminRoleId: string; let guestRoleId: string
  let access: string; let guestAccess: string; let refreshCookie: string
  const prefix = `test_${randomUUID().slice(0, 8)}`
  const password = randomBytes(24).toString('base64url')
  const replacement = randomBytes(24).toString('base64url')
  const origin = 'http://localhost:5173'
  beforeAll(async () => {
    const url = new URL(testUrl!)
    if (!url.pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must reference a dedicated *_test database')
    process.env.DATABASE_URL = testUrl
    // Vitest/esbuild does not emit design:paramtypes; production tsc does.
    Reflect.defineMetadata('design:paramtypes', [DatabaseService, JwtService], AuthController)
    Reflect.defineMetadata('design:paramtypes', [DatabaseService], UsersController)
    Reflect.defineMetadata('design:paramtypes', [DatabaseService], RolesController)
    Reflect.defineMetadata('design:paramtypes', [Reflector, DatabaseService, JwtService], AuthGuard)
    Reflect.defineMetadata('design:paramtypes', [Reflector], PermissionGuard)
    @Module({
      imports: [DatabaseModule, JwtModule.register({ secret: randomBytes(48).toString('hex') })],
      controllers: [AuthController, UsersController, RolesController],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: PermissionGuard }],
    })
    class TestApp {}
    app = await NestFactory.create(TestApp, { logger: false })
    app.use(securityMiddleware(new Set([origin])))
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new ApiExceptionFilter())
    app.useGlobalInterceptors(new DataInterceptor())
    await app.init()
    db = app.get(DatabaseService)
    const adminRole = await db.role.upsert({ where: { name: 'ADMIN' }, create: { name: 'ADMIN', builtIn: true }, update: {} })
    adminRoleId = adminRole.id
    for (const permissionId of ['users.read', 'users.create', 'users.update', 'roles.update']) {
      await db.permission.upsert({ where: { id: permissionId }, create: { id: permissionId, description: permissionId }, update: {} })
      await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: adminRole.id, permissionId } }, create: { roleId: adminRole.id, permissionId }, update: {} })
    }
    const guestRole = await db.role.create({ data: { name: `${prefix}_GUEST` } }); guestRoleId = guestRole.id
    const admin = await db.user.create({ data: { username: `${prefix}_admin`, passwordHash: hashPassword(password), roleId: adminRole.id, forceChangePassword: true } }); adminId = admin.id
    const guest = await db.user.create({ data: { username: `${prefix}_guest`, passwordHash: hashPassword(password), roleId: guestRole.id, forceChangePassword: false } }); guestId = guest.id
  }, 30000)
  afterAll(async () => {
    if (db) {
      await db.auditLog.deleteMany({ where: { userId: { in: [adminId, guestId].filter(Boolean) } } })
      await db.user.deleteMany({ where: { id: { in: [adminId, guestId].filter(Boolean) } } })
      if (guestRoleId) await db.role.delete({ where: { id: guestRoleId } })
    }
    if (app) await app.close()
  })
  it('authenticates, returns no password hash, and sets HttpOnly cookie', async () => {
    const result = await request(app.getHttpServer()).post('/api/auth/login').set('Origin', origin).send({ username: `${prefix}_admin`, password }).expect(201)
    expect(result.body.data.forceChangePassword).toBe(true)
    expect(JSON.stringify(result.body)).not.toContain('passwordHash')
    access = result.body.data.accessToken
    refreshCookie = result.headers['set-cookie'][0].split(';')[0]
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(result.headers['set-cookie'][0]).toContain('SameSite=Strict')
    const session = await db.refreshSession.findFirstOrThrow({ where: { userId: adminId } })
    expect(session.tokenHash).toBe(tokenHash(refreshCookie.slice('acg_refresh='.length)))
  })
  it('enforces force-change and allows only me/password endpoints', async () => {
    await request(app.getHttpServer()).get('/api/users').auth(access, { type: 'bearer' }).expect(403)
    await request(app.getHttpServer()).get('/api/auth/me').auth(access, { type: 'bearer' }).expect(200)
    await request(app.getHttpServer()).post('/api/auth/change-password').set('Origin', origin).auth(access, { type: 'bearer' }).send({ oldPassword: password, newPassword: replacement }).expect(201)
    await request(app.getHttpServer()).get('/api/auth/me').auth(access, { type: 'bearer' }).expect(401)
  })
  it('rotates refresh once and revokes family on replay', async () => {
    const login = await request(app.getHttpServer()).post('/api/auth/login').set('Origin', origin).send({ username: `${prefix}_admin`, password: replacement }).expect(201)
    access = login.body.data.accessToken
    const old = login.headers['set-cookie'][0].split(';')[0]
    const rotated = await request(app.getHttpServer()).post('/api/auth/refresh').set('Origin', origin).set('Cookie', old).expect(201)
    const next = rotated.headers['set-cookie'][0].split(';')[0]
    expect(next).not.toBe(old)
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Origin', origin).set('Cookie', old).expect(401)
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Origin', origin).set('Cookie', next).expect(401)
  })
  it('rejects unknown login fields and guest privilege escalation', async () => {
    await request(app.getHttpServer()).post('/api/auth/login').set('Origin', origin).send({ username: `${prefix}_guest`, password, role: 'ADMIN' }).expect(400)
    const login = await request(app.getHttpServer()).post('/api/auth/login').set('Origin', origin).send({ username: `${prefix}_guest`, password }).expect(201)
    guestAccess = login.body.data.accessToken
    await request(app.getHttpServer()).patch(`/api/users/${guestId}`).set('Origin', origin).auth(guestAccess, { type: 'bearer' }).send({ roleId: adminRoleId }).expect(403)
  })
  it('reflects permission revocation and account disabling immediately', async () => {
    await request(app.getHttpServer()).get('/api/users').auth(access, { type: 'bearer' }).expect(200)
    await db.user.update({ where: { id: guestId }, data: { enabled: false } })
    await request(app.getHttpServer()).get('/api/auth/me').auth(guestAccess, { type: 'bearer' }).expect(401)
  })
  it('protects the last enabled administrator inside a transaction', async () => {
    const admins = await db.user.count({ where: { enabled: true, roleId: adminRoleId } })
    if (admins !== 1) throw new Error('Dedicated test DB must not contain other enabled administrators')
    await request(app.getHttpServer()).patch(`/api/users/${adminId}`).set('Origin', origin).auth(access, { type: 'bearer' }).send({ enabled: false }).expect(409)
    expect((await db.user.findUniqueOrThrow({ where: { id: adminId } })).enabled).toBe(true)
  })
})

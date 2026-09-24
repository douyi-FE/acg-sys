import { Body, Controller, Get, Patch, Post, Req, Res, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator'
import { randomBytes, randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { DatabaseService } from '../database/database.service'
import { AllowPasswordChange, Public, RequestUser } from '../common/permissions'
import { hashPassword, tokenHash, validatePassword, verifyPassword } from '../common/security'

export class LoginDto {
  @IsString() @Length(1, 100) @Matches(/^[a-zA-Z0-9_.@-]+$/) username!: string
  @IsString() @Length(1, 128) password!: string
}
export class ChangePasswordDto {
  @IsString() @Length(1, 128) oldPassword!: string
  @IsString() @Length(12, 128) newPassword!: string
}
export class ProfileDto {
  @IsOptional() @IsString() @Length(1, 100) nickname?: string
  @IsOptional() @IsEmail() @Length(3, 254) email?: string
}
export function cookieSecure() {
  const value = process.env.COOKIE_SECURE
  if (value !== undefined && value !== 'true' && value !== 'false') throw new Error('COOKIE_SECURE must be true or false')
  return value === undefined ? process.env.NODE_ENV === 'production' : value === 'true'
}
const dummyHash = hashPassword(randomBytes(32).toString('hex'))
type AuthRequest = Request & { user: RequestUser }
export function readRefreshCookie(req: Request) {
  return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('acg_refresh='))?.slice(12)
}

@Controller('api/auth')
export class AuthController {
  constructor(private db: DatabaseService, private jwt: JwtService) {}
  private cookie(res: Response, value: string, clear = false) {
    res.cookie('acg_refresh', value, {
      httpOnly: true, secure: cookieSecure(), sameSite: 'strict',
      path: '/api/auth', maxAge: clear ? 0 : 7 * 86400000,
    })
    res.setHeader('Cache-Control', 'no-store')
  }
  private async access(user: { id: string; tokenVersion: number }) {
    return this.jwt.signAsync({ sub: user.id, ver: user.tokenVersion }, { expiresIn: '15m', issuer: 'acg', audience: 'acg-web', algorithm: 'HS256' })
  }
  @Public() @Post('login')
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
    const user = await this.db.user.findUnique({ where: { username: body.username }, include: { role: true } })
    const valid = verifyPassword(body.password, user?.passwordHash || dummyHash)
    if (!valid || !user?.enabled || !user.role.enabled) {
      await this.db.auditLog.create({ data: { action: 'auth.login', result: 'FAILURE', ip: req.ip?.slice(0, 45) } })
      throw new UnauthorizedException('用户名或密码不正确')
    }
    const token = randomBytes(48).toString('base64url')
    await this.db.$transaction([
      this.db.refreshSession.create({ data: { userId: user.id, tokenHash: tokenHash(token), familyId: randomUUID(), expiresAt: new Date(Date.now() + 7 * 86400000) } }),
      this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.db.auditLog.create({ data: { userId: user.id, action: 'auth.login', ip: req.ip?.slice(0, 45) } }),
    ])
    this.cookie(res, token)
    return { accessToken: await this.access(user), forceChangePassword: user.forceChangePassword }
  }
  @Public() @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req)
    if (!token || token.length > 200) throw new UnauthorizedException()
    const session = await this.db.refreshSession.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: { include: { role: true } } } })
    if (!session) throw new UnauthorizedException()
    if (session.revokedAt) {
      await this.db.refreshSession.updateMany({ where: { familyId: session.familyId }, data: { revokedAt: new Date() } })
      this.cookie(res, '', true)
      throw new UnauthorizedException('刷新凭证已失效')
    }
    if (session.expiresAt <= new Date() || !session.user.enabled || !session.user.role.enabled) throw new UnauthorizedException()
    const next = randomBytes(48).toString('base64url')
    const currentUser = await this.db.$transaction(async tx => {
      // Serialize refresh with logout's user update before consuming or minting sessions.
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${session.userId} FOR UPDATE`
      const current = await tx.user.findUniqueOrThrow({ where: { id: session.userId }, include: { role: true } })
      if (!current.enabled || !current.role.enabled || current.tokenVersion !== session.user.tokenVersion) throw new UnauthorizedException()
      const consumed = await tx.refreshSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } })
      if (consumed.count !== 1) throw new UnauthorizedException()
      await tx.refreshSession.create({ data: { userId: session.userId, familyId: session.familyId, tokenHash: tokenHash(next), expiresAt: session.expiresAt } })
      return current
    })
    this.cookie(res, next)
    return { accessToken: await this.access(currentUser), forceChangePassword: currentUser.forceChangePassword }
  }
  @Public() @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req)
    const ids = new Set<string>()
    if (token && token.length <= 200) {
      const session = await this.db.refreshSession.findUnique({ where: { tokenHash: tokenHash(token) } })
      if (session && !session.revokedAt && session.expiresAt > new Date()) ids.add(session.userId)
    }
    const bearer = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '')
    if (bearer) {
      try {
        const claims = await this.jwt.verifyAsync<{ sub: string; ver: number }>(bearer[1], { algorithms: ['HS256'], issuer: 'acg', audience: 'acg-web' })
        if (typeof claims.sub === 'string' && Number.isInteger(claims.ver)) {
          const user = await this.db.user.findUnique({ where: { id: claims.sub } })
          if (user?.tokenVersion === claims.ver) ids.add(user.id)
        }
      } catch { /* Logout remains idempotent for expired/invalid access tokens. */ }
    }
    for (const id of [...ids].sort()) await this.db.$transaction(async tx => {
      // Account-wide logout deliberately invalidates every outstanding access JWT.
      await tx.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } })
      await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
      await tx.auditLog.create({ data: { userId: id, action: 'auth.logout', ip: req.ip?.slice(0, 45) } })
    })
    this.cookie(res, '', true)
    return { loggedOut: true }
  }
  @AllowPasswordChange() @Get('me')
  me(@Req() req: AuthRequest) { return req.user }

  @Patch('profile')
  async profile(@Req() req: AuthRequest, @Body() body: ProfileDto) {
    return this.db.user.update({
      where: { id: req.user.id },
      data: { nickname: body.nickname, email: body.email },
      select: { id: true, username: true, nickname: true, email: true, lastLoginAt: true },
    })
  }
  @AllowPasswordChange() @Post('change-password')
  async change(@Req() req: AuthRequest, @Body() body: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    validatePassword(body.newPassword)
    const user = await this.db.user.findUniqueOrThrow({ where: { id: req.user.id } })
    if (!verifyPassword(body.oldPassword, user.passwordHash)) throw new UnauthorizedException('原密码不正确')
    if (body.oldPassword === body.newPassword) throw new BadRequestException('新旧密码不得相同')
    await this.db.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash: hashPassword(body.newPassword), forceChangePassword: false, tokenVersion: { increment: 1 } },
      })
      if (updated.count !== 1) throw new UnauthorizedException()
      await tx.refreshSession.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } })
      await tx.auditLog.create({ data: { userId: user.id, action: 'auth.change-password', ip: req.ip?.slice(0, 45) } })
    })
    this.cookie(res, '', true)
    return { loginRequired: true }
  }
}

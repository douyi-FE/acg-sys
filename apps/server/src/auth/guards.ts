import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { DatabaseService } from '../database/database.service'
import { RequestUser } from '../common/permissions'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private db: DatabaseService, private jwt: JwtService) {}
  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride('public', targets)) return true
    const req = context.switchToHttp().getRequest()
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '')
    if (!match) throw new UnauthorizedException()
    let claims: { sub: string; ver: number }
    try { claims = await this.jwt.verifyAsync(match[1], { algorithms: ['HS256'], issuer: 'acg', audience: 'acg-web' }) }
    catch { throw new UnauthorizedException() }
    if (typeof claims.sub !== 'string' || !claims.sub || !Number.isInteger(claims.ver)) throw new UnauthorizedException()
    const user = await this.db.user.findUnique({ where: { id: claims.sub }, include: { role: { include: { permissions: true } } } })
    if (!user || !user.enabled || !user.role.enabled || user.tokenVersion !== claims.ver) throw new UnauthorizedException()
    req.user = {
      id: user.id, username: user.username, roleId: user.roleId, role: user.role.name,
      forceChangePassword: user.forceChangePassword, tokenVersion: user.tokenVersion,
      nickname: user.nickname, email: user.email, lastLoginAt: user.lastLoginAt,
      permissions: user.role.permissions.map(p => p.permissionId),
    } satisfies RequestUser
    if (user.forceChangePassword && !this.reflector.getAllAndOverride('allowPasswordChange', targets))
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: '请先修改初始密码' })
    return true
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride('public', targets)) return true
    const permissions = this.reflector.getAllAndOverride<string[]>('permissions', targets) || []
    const user = context.switchToHttp().getRequest().user as RequestUser
    if (!user || !permissions.every(p => user.permissions.includes(p))) throw new ForbiddenException()
    return true
  }
}

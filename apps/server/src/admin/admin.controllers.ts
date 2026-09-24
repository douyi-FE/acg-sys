import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { DatabaseService } from '../database/database.service'
import { GUEST_PERMISSIONS, PERMISSIONS, RequirePermission, RequestUser } from '../common/permissions'
import { hashPassword, redact, validatePassword } from '../common/security'
import { bool, objectBody, requireAdmin, safeUserSelect, text } from '../common/input'
import type { Request } from 'express'
type R = Request & { user: RequestUser }

// All identity mutations acquire the same row lock, preventing concurrent last-admin removal.
async function lockIdentity(tx: Prisma.TransactionClient, actor: RequestUser) {
  await tx.$queryRaw`SELECT id FROM Role WHERE name = 'ADMIN' FOR UPDATE`
  const current = await tx.user.findUnique({ where: { id: actor.id }, include: { role: { include: { permissions: true } } } })
  if (!current?.enabled || !current.role.enabled || current.role.name !== 'ADMIN' ||
    current.forceChangePassword || current.tokenVersion !== actor.tokenVersion ||
    !actor.permissions.every(p => current.role.permissions.some(grant => grant.permissionId === p))) {
    throw new ForbiddenException('管理员身份或授权已变更')
  }
}
function assertGrant(actor: RequestUser, permissions: string[]) {
  if (permissions.some(p => !actor.permissions.includes(p))) throw new ForbiddenException('不能授予自身未拥有的权限')
}
async function audit(tx: Prisma.TransactionClient, userId: string, action: string, targetId: string) {
  await tx.auditLog.create({ data: { userId, action, targetId } })
}

@Controller('api/users')
export class UsersController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('users.read')
  list() { return this.db.user.findMany({ select: safeUserSelect, take: 500, orderBy: { createdAt: 'desc' } }) }
  @Post() @RequirePermission('users.create')
  async create(@Req() req: R, @Body() input: unknown) {
    requireAdmin(req.user)
    const body = objectBody(input, ['username', 'password', 'roleId'])
    const username = text(body.username, 'username', 100)
    if (!/^[a-zA-Z0-9_.@-]+$/.test(username)) throw new BadRequestException('用户名格式不正确')
    validatePassword(body.password)
    const passwordHash = hashPassword(body.password)
    const roleId = text(body.roleId, 'roleId')
    return this.db.$transaction(async tx => {
      await lockIdentity(tx, req.user)
      const role = await tx.role.findUniqueOrThrow({ where: { id: roleId }, include: { permissions: true } })
      if (!role.enabled) throw new BadRequestException('角色已禁用')
      assertGrant(req.user, role.permissions.map(p => p.permissionId))
      const user = await tx.user.create({ data: { username, passwordHash, roleId, forceChangePassword: true }, select: safeUserSelect })
      await audit(tx, req.user.id, 'users.create', user.id)
      return user
    })
  }
  @Patch(':id') @RequirePermission('users.update')
  async update(@Req() req: R, @Param('id') id: string, @Body() input: unknown) {
    requireAdmin(req.user)
    const body = objectBody(input, ['enabled', 'roleId'])
    const data = {
      ...(body.enabled !== undefined ? { enabled: bool(body.enabled) } : {}),
      ...(body.roleId !== undefined ? { roleId: text(body.roleId, 'roleId') } : {}),
      tokenVersion: { increment: 1 },
    }
    return this.db.$transaction(async tx => {
      await lockIdentity(tx, req.user)
      const target = await tx.user.findUniqueOrThrow({ where: { id }, include: { role: true } })
      if (data.roleId) {
        const role = await tx.role.findUniqueOrThrow({ where: { id: data.roleId }, include: { permissions: true } })
        if (!role.enabled) throw new BadRequestException('角色已禁用')
        assertGrant(req.user, role.permissions.map(p => p.permissionId))
      }
      if (target.enabled && target.role.name === 'ADMIN' && (data.enabled === false || (data.roleId && data.roleId !== target.roleId))) {
        const count = await tx.user.count({ where: { enabled: true, role: { name: 'ADMIN', enabled: true } } })
        if (count <= 1) throw new ConflictException('不能禁用或降级最后一个管理员')
      }
      const user = await tx.user.update({ where: { id }, data, select: safeUserSelect })
      await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
      await audit(tx, req.user.id, 'users.update', id)
      return user
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  }
  @Delete(':id') @RequirePermission('users.delete')
  async remove(@Req() req: R, @Param('id') id: string) {
    // Soft delete retains production records and audit attribution.
    await this.update(req, id, { enabled: false })
    return { deleted: true, softDeleted: true }
  }
}

@Controller('api/roles')
export class RolesController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('roles.read')
  list() { return this.db.role.findMany({ include: { permissions: true }, take: 500 }) }
  private parse(input: unknown, create: boolean) {
    const body = objectBody(input, ['name', 'description', 'enabled', 'permissions'])
    const data: { name?: string; description?: string; enabled?: boolean } = {}
    if (create || body.name !== undefined) {
      data.name = text(body.name, 'name', 100)
      if (['ADMIN', 'GUEST'].includes(data.name.toUpperCase())) throw new BadRequestException('保留角色名')
    }
    if (body.description !== undefined) data.description = text(body.description, 'description', 500)
    if (body.enabled !== undefined) data.enabled = bool(body.enabled)
    let permissions: string[] | undefined
    if (body.permissions !== undefined) {
      if (!Array.isArray(body.permissions) || body.permissions.length > PERMISSIONS.length || body.permissions.some(p => typeof p !== 'string' || !(PERMISSIONS as readonly string[]).includes(p))) throw new BadRequestException('未知权限')
      permissions = [...new Set(body.permissions)] as string[]
    }
    return { data, permissions }
  }
  @Post() @RequirePermission('roles.create')
  async create(@Req() req: R, @Body() input: unknown) {
    requireAdmin(req.user)
    const { data, permissions } = this.parse(input, true)
    assertGrant(req.user, permissions || [])
    return this.db.$transaction(async tx => {
      await lockIdentity(tx, req.user)
      const role = await tx.role.create({ data: { ...data, name: data.name!, permissions: { create: (permissions || []).map(permissionId => ({ permissionId })) } }, include: { permissions: true } })
      await audit(tx, req.user.id, 'roles.create', role.id)
      return role
    })
  }
  @Patch(':id') @RequirePermission('roles.update')
  async update(@Req() req: R, @Param('id') id: string, @Body() input: unknown) {
    requireAdmin(req.user)
    const { data, permissions } = this.parse(input, false)
    assertGrant(req.user, permissions || [])
    return this.db.$transaction(async tx => {
      await lockIdentity(tx, req.user)
      const existing = await tx.role.findUniqueOrThrow({ where: { id } })
      const guest = existing.name === 'GUEST'
      if ((existing.builtIn && !guest) || existing.name.toUpperCase() === 'ADMIN') throw new ConflictException('内置角色不可修改')
      if (guest && (data.name !== undefined || permissions?.some(p => !(GUEST_PERMISSIONS as readonly string[]).includes(p)))) throw new BadRequestException('访客仅允许安全只读权限且不可重命名')
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } })
        await tx.rolePermission.createMany({ data: permissions.map(permissionId => ({ roleId: id, permissionId })) })
      }
      const role = await tx.role.update({ where: { id }, data, include: { permissions: true } })
      await audit(tx, req.user.id, 'roles.update', id)
      return role
    })
  }
  @Delete(':id') @RequirePermission('roles.delete')
  async remove(@Req() req: R, @Param('id') id: string) {
    requireAdmin(req.user)
    return this.db.$transaction(async tx => {
      await lockIdentity(tx, req.user)
      const role = await tx.role.findUniqueOrThrow({ where: { id } })
      if (role.builtIn || ['ADMIN', 'GUEST'].includes(role.name.toUpperCase()) || await tx.user.count({ where: { roleId: id } })) throw new ConflictException('内置或使用中的角色不可删除')
      await tx.role.delete({ where: { id } })
      await audit(tx, req.user.id, 'roles.delete', id)
      return { deleted: true }
    })
  }
}
@Controller('api/permissions')
export class PermissionsController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('permissions.read')
  list() { return this.db.permission.findMany({ orderBy: { id: 'asc' } }) }
}
@Controller('api/audit-logs')
export class AuditLogsController {
  constructor(private db: DatabaseService) {}
  @Get() @RequirePermission('audit-logs.read')
  async list() {
    const rows = await this.db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })
    return rows.map(row => ({ ...row, metadata: redact(row.metadata) }))
  }
}

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { RequestUser } from './permissions'

export function objectBody(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('请求体必须为对象')
  const data = body as Record<string, unknown>
  if (Object.keys(data).some(k => !allowed.includes(k))) throw new BadRequestException('包含不支持的字段')
  return data
}
export function text(value: unknown, name: string, max = 255): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequestException(`${name} 格式不正确`)
  return value.trim()
}
export function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException('必须为布尔值')
  return value
}
export function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new BadRequestException('数值超出范围')
  return value
}
export function json(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined || typeof value === 'function') throw new BadRequestException('JSON 不可为空')
  try {
    const encoded = JSON.stringify(value)
    if (encoded.length > 1024 * 1024) throw new Error()
    return JSON.parse(encoded)
  } catch { throw new BadRequestException('JSON 无效或过大') }
}
export function assertOwner(user: RequestUser, row: { userId: string; isPublic?: boolean } | null, resource: string, write = false) {
  if (!row) throw new NotFoundException()
  if (row.userId === user.id || user.permissions.includes(`${resource}.manage`) || (!write && row.isPublic)) return
  throw new NotFoundException()
}
export function requireAdmin(user: RequestUser) {
  if (user.role !== 'ADMIN') throw new ForbiddenException('仅管理员可管理身份和授权')
}
export const safeUserSelect = {
  id: true, username: true, enabled: true, forceChangePassword: true, roleId: true,
  nickname: true, email: true, lastLoginAt: true, createdAt: true, updatedAt: true,
} as const

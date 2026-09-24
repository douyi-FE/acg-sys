import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
export function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, key] = stored.split(':')
  if (algorithm !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'hex')
  const actual = scryptSync(password, salt, 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw new BadRequestException('密码须为 12–128 个字符')
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 100).map(v => redact(v, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, /password|secret|token|authorization|cookie|api.?key|prompt|input|output/i.test(k) ? '[redacted]' : redact(v, depth + 1)]),
  )
  return typeof value === 'string' ? value.slice(0, 500) : value
}

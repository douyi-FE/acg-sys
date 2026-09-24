import { PrismaClient } from '@prisma/client'
import { GUEST_PERMISSIONS, PERMISSIONS } from '../apps/server/src/common/permissions'
import { hashPassword, validatePassword } from '../apps/server/src/common/security'

const db = new PrismaClient()
async function seed() {
  const username = process.env.INITIAL_ADMIN_USERNAME || 'alex'
  if (!/^[a-zA-Z0-9_.-]{3,100}$/.test(username)) throw new Error('Invalid initial administrator username')
  const existing = await db.user.findUnique({ where: { username } })
  const password = process.env.INITIAL_ADMIN_PASSWORD
  if (!existing) validatePassword(password)
  await db.$transaction(async tx => {
    for (const id of PERMISSIONS) await tx.permission.upsert({ where: { id }, create: { id, description: id }, update: {} })
    const admin = await tx.role.upsert({ where: { name: 'ADMIN' }, create: { name: 'ADMIN', builtIn: true, description: '系统管理员' }, update: {} })
    const guest = await tx.role.upsert({ where: { name: 'GUEST' }, create: {
      name: 'GUEST', builtIn: true, description: '只读访客（仅公开资源与本人资源）',
      permissions: { create: GUEST_PERMISSIONS.map(permissionId => ({ permissionId })) },
    }, update: {} })
    await tx.rolePermission.deleteMany({ where: { roleId: guest.id } })
    await tx.rolePermission.createMany({ data: GUEST_PERMISSIONS.map(permissionId => ({ roleId: guest.id, permissionId })) })
    for (const permissionId of PERMISSIONS) await tx.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: admin.id, permissionId } },
      create: { roleId: admin.id, permissionId }, update: {},
    })
    if (!existing) await tx.user.upsert({
      where: { username }, update: {},
      create: { username, roleId: admin.id, passwordHash: hashPassword(password!), forceChangePassword: true },
    })
    await tx.pipeline.upsert({
      where: { id: 'single-generation' }, update: {},
      create: { id: 'single-generation', name: '单阶段真实生成', kind: 'video', stages: { create: { id: 'single-generation-stage', key: 'GENERATE', name: '真实生成', workflowKind: 'image', qualityGate: { create: { threshold: 80, enabled: false, criteria: [] } } } } },
    })
  }, { timeout: 30000 })
}
seed().catch(() => { console.error('Seed failed. Verify database connectivity and INITIAL_ADMIN_PASSWORD (12–128 characters on first initialization).'); process.exitCode = 1 }).finally(() => db.$disconnect())

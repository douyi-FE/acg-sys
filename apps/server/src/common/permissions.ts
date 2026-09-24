import { SetMetadata } from '@nestjs/common'

export const PERMISSIONS = [
  'workspace.read', 'users.read', 'users.create', 'users.update', 'users.delete',
  'roles.read', 'roles.create', 'roles.update', 'roles.delete', 'permissions.read',
  'audit-logs.read', 'tasks.read', 'tasks.create', 'tasks.update', 'tasks.delete',
  'tasks.manage', 'executions.read', 'executions.create', 'executions.cancel',
  'executions.manage', 'assets.read', 'assets.create', 'assets.update', 'assets.delete',
  'assets.manage', 'workflows.read', 'workflows.create', 'workflows.update', 'workflows.delete',
  'providers.read', 'providers.create', 'providers.update', 'providers.delete',
  'models.read', 'models.create', 'models.update', 'models.delete',
  'pipelines.read', 'pipelines.create', 'pipelines.update', 'pipelines.delete',
  'stages.read', 'stages.create', 'stages.update', 'stages.delete',
  'quality-gates.read', 'quality-gates.create', 'quality-gates.update', 'quality-gates.delete',
] as const
// Anonymous workspace access never inherits management/identity grants, even if the DB is misconfigured.
export const GUEST_PERMISSIONS = [
  'workspace.read', 'tasks.read', 'assets.read', 'workflows.read', 'models.read', 'providers.read',
  'pipelines.read', 'stages.read', 'quality-gates.read',
] as const
export const RequirePermission = (...permissions: string[]) => SetMetadata('permissions', permissions)
export const Public = () => SetMetadata('public', true)
export const AllowPasswordChange = () => SetMetadata('allowPasswordChange', true)
export interface RequestUser {
  id: string
  username: string
  roleId: string
  role: string
  permissions: string[]
  forceChangePassword: boolean
  tokenVersion: number
  nickname?: string | null
  email?: string | null
  lastLoginAt?: Date | null
}

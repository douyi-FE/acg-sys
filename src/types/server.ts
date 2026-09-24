/** 会话信封；不复用旧 Mock 用户/角色模型。 */
export interface SessionUser {
  id: string
  username: string
  displayName?: string
  nickname?: string | null
  email?: string | null
  mustChangePassword?: boolean
}
export interface Session {
  user: SessionUser | null
  role: { id: string; name: string } | null
  permissions: string[]
  token?: string
}

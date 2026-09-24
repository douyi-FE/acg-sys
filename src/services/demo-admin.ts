import { isMockMode } from '../api/mode'
import { serverRequest } from '../api/session'

// Isolated, ephemeral demo administration. Never stored as real credentials or
// used to authorize backend requests. Reloading resets this sample database.
type Row = Record<string, unknown> & { id: string }
const tables: Record<string, Row[]> = {
  users: [{ id: 'demo-user', username: 'Mock 内容主理人', roleId: 'demo-role', enabled: true, forceChangePassword: false }],
  roles: [{ id: 'demo-role', name: 'Mock 管理员', enabled: true, permissions: [] }],
  permissions: [{ id: 'workspace.read', description: 'Mock 工作区读取' }],
  'audit-logs': [{ id: 'demo-audit', action: 'Mock 演示启动（非真实审计）', createdAt: new Date().toISOString() }],
  services: [{ id: 'demo-service', name: 'Mock LLM（未连接）', kind: 'OPENAI', baseUrl: 'mock://local', enabled: true }],
}
export async function adminRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!isMockMode) return serverRequest<T>(path, method, body)
  const parts = path.split('/').filter(Boolean)
  const table = parts[0] === 'llm' || parts[0] === 'comfyui' ? 'services' : parts[0]!
  const offset = table === 'services' ? 2 : 1
  const id = parts[offset] ? decodeURIComponent(parts[offset]!) : undefined
  const rows = tables[table]
  if (!rows) throw new Error('此操作没有 Mock 实现，未执行')
  if (parts[offset + 1]) throw new Error('Mock 不执行连接测试或模型发现；请切换真实模式')
  if (method === 'GET') return structuredClone(rows) as T
  const values = { ...(body as Record<string, unknown>) }
  delete values.password
  delete values.secret
  if (method === 'POST') rows.push({ ...values, id: crypto.randomUUID() })
  else {
    const index = rows.findIndex(row => row.id === id)
    if (index < 0) throw new Error('Mock 记录不存在')
    if (method === 'DELETE') rows.splice(index, 1)
    else Object.assign(rows[index]!, values)
  }
  return { simulated: true } as T
}

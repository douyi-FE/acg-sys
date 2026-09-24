/** 菜单与路由共享同一权限映射，永不按角色名推断权限。 */
export function routePermission(path: string): string | undefined {
  if (['/login', '/profile', '/change-password', '/access-denied'].includes(path)) return undefined
  const resource = path.split('/')[1] || 'dashboard'
  const resources: Record<string, string> = {
    dashboard: 'workspace', video: 'tasks', engine: 'providers', comfyui: 'executions',
    'hot-topics': 'workspace', articles: 'workspace', publishing: 'workspace',
    settings: 'providers', 'ai-services': 'providers', analytics: 'workspace',
  }
  return `${resources[resource] ?? resource}.read`
}

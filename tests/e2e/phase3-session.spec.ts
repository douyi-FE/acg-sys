import { expect, test, type Page } from '@playwright/test'
test.beforeEach(({ page }, info) => { void page; test.skip(info.config.metadata.apiMode !== 'real', 'Requires the separate real-mode config') })

// 传输层契约 fixture，不代表 MySQL / AI 服务集成测试。
const workspace = {
  version: 3, tasks: [], topics: [], articles: [], assets: [], workflows: [], models: [],
  settings: { threshold: 80, maxRetries: 0, maxIterations: 1, autoRetry: false, stageDuration: 0 },
}
async function setup(page: Page, permissions: string[], mustChangePassword = false) {
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { data: { accessToken: 'fixture-token' } } }))
  await page.route('**/api/auth/me', route => route.fulfill({
    json: { data: { id: 'test-user', username: 'test', forceChangePassword: mustChangePassword, role: '自定义数据库角色', permissions } },
  }))
  await page.route('**/api/workspace', route => route.fulfill({ json: { data: workspace } }))
}
test('real 后端失败不会显示 Mock 工作台', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { message: '测试后端不可用' } } }))
  await page.goto('/')
  await expect(page.getByText('模拟引擎 · 本地演示')).toHaveCount(0)
  await expect(page.getByText('林墨')).toHaveCount(0)
  await expect(page).not.toHaveURL(/engine|video|tasks/)
})
test('账户权限由 me 驱动；菜单和直接导航同时拦截', async ({ page }) => {
  await setup(page, ['workspace.read'])
  await page.goto('/')
  await expect(page.getByText('后端接口 · 真实模式')).toBeVisible()
  await expect(page.getByRole('button', { name: '用户管理', exact: true })).toHaveCount(0)
  await page.goto('/users')
  await expect(page).toHaveURL(/access-denied/)
})
test('不依赖角色名，自定义权限可打开审计移动卡片', async ({ page }) => {
  await setup(page, ['workspace.read', 'audit-logs.read'])
  await page.route('**/api/audit-logs', route => route.fulfill({ json: { data: [{ id: 'audit-1', action: 'auth.login', userId: 'user-1', createdAt: '2026-09-23T00:00:00Z' }] } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/audit-logs')
  await expect(page.getByRole('heading', { name: 'auth.login' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
test('强制改密拦截业务路由', async ({ page }) => {
  await setup(page, ['workspace.read', 'tasks.read'], true)
  await page.goto('/video/new')
  await expect(page).toHaveURL(/change-password/)
  await expect(page.getByText('当前账户必须修改密码后才能继续使用。')).toBeVisible()
})
test('真实创作只向后端发现数据，不使用本地演示模型', async ({ page, baseURL }) => {
  await setup(page, ['workspace.read', 'tasks.read', 'executions.create'])
  await page.route('**/api/llm/services', route => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/llm/models', route => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/workflows', route => route.fulfill({ json: { data: [] } }))
  const external: string[] = []
  page.on('request', request => { if (new URL(request.url()).origin !== baseURL) external.push(request.url()) })
  await page.goto('/video/new')
  await expect(page.getByRole('heading', { name: '真实内容创作' })).toBeVisible()
  await expect(page.getByText('无可用语义字段；请在后端配置工作流映射，不自动猜测节点。')).toBeVisible()
  expect(external).toEqual([])
})

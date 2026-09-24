import { expect, test } from '@playwright/test'

test('development demo exposes actual pages and admin samples without backend requests or login', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
  })
  await page.route(/\/api\/(?!.*\.ts)/, route => route.abort('connectionrefused'))
  await page.goto('/?devMode=demo')
  await expect(page.getByTestId('development-mode')).toContainText('免登录')
  for (const path of ['/video', '/video/new', '/tasks', '/hot-topics', '/articles', '/publishing',
    '/assets', '/workflows', '/comfyui', '/engine', '/models', '/analytics', '/settings',
    '/users', '/roles', '/audit-logs', '/ai-services']) {
    await page.goto(path)
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.getByTestId('development-mode')).toContainText('DEVELOPMENT DEMO')
    expect(new URL(page.url()).pathname).toBe(path)
  }
  expect(requests).toEqual([])
  await expect(page.getByRole('heading', { name: 'Mock LLM（未连接）' })).toBeVisible()
  await page.getByRole('button', { name: '后端连接测试' }).click()
  await expect(page.getByText('Mock 不执行连接测试或模型发现；请切换真实模式')).toBeVisible()
})

test('explicit real mode fails offline; switching to demo clears real state and grants only local access', async ({ page }) => {
  await page.route(/\/api\/(?!.*\.ts)/, route => route.fulfill({ status: 503, json: { error: { message: 'Offline', code: 'DATABASE_UNAVAILABLE' } } }))
  await page.goto('/tasks?devMode=real')
  await expect(page.getByRole('heading', { name: '应用暂时不可用' })).toBeVisible()
  await page.getByRole('button', { name: '选择 Mock 演示' }).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByTestId('development-mode')).toContainText('DEVELOPMENT DEMO')
  await page.getByRole('button', { name: '切换真实模式' }).click()
  await expect(page.getByRole('heading', { name: '应用暂时不可用' })).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveCount(0)
})

import { expect, test } from '@playwright/test'

test('real mode 503 renders offline shell, explicit empty preview, and retries without mock auth', async ({ page }) => {
  let available = false
  const requests: string[] = []
  await page.route(/\/api\/(?!.*\.ts)/, async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    if (path === '/api/health') return route.fulfill({
      status: available ? 200 : 503, json: { data: { backend: 'up', database: available ? 'up' : 'down' } },
    })
    if (available && path.startsWith('/api/auth/')) return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED' } } })
    if (available && path === '/api/workspace/public') return route.fulfill({ status: 403, json: { error: { message: '公开数据未开放' } } })
    return route.fulfill({ status: 503, json: { error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂不可用' } } })
  })
  await page.goto('/tasks?devMode=real')
  await expect(page.getByRole('heading', { name: '应用暂时不可用' })).toBeVisible()
  await expect(page.getByText('数据库：未就绪 (503)')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '系统页面' })).toHaveCount(0)
  await page.getByRole('button', { name: '选择浏览离线布局预览' }).click()
  await page.getByRole('button', { name: '用户与权限', exact: true }).click()
  await expect(page.getByRole('heading', { name: '用户与权限' })).toBeVisible()
  await expect(page.getByText('离线 / 只读布局预览 · 未登录')).toBeVisible()
  expect(requests.some(path => path.includes('/users') || path === '/api/workspace')).toBe(false)
  expect(await page.evaluate(() => localStorage.getItem('acg-api-mode'))).toBeNull()
  available = true
  await page.getByRole('button', { name: '重试连接' }).click()
  await expect(page).toHaveURL(/\/public$/)
  await expect(page.getByRole('heading', { name: '应用暂时不可用' })).toHaveCount(0)
})

test('unreachable backend stays visible with unknown database status', async ({ page }) => {
  await page.route(/\/api\/(?!.*\.ts)/, route => route.abort('connectionrefused'))
  await page.goto('/?devMode=real')
  await expect(page.getByRole('heading', { name: '应用暂时不可用' })).toBeVisible()
  await expect(page.getByText('数据库：未知（后端不可连接）')).toBeVisible()
  await page.getByRole('button', { name: '重试连接' }).click()
  await expect(page.getByRole('heading', { name: '应用暂时不可用' })).toBeVisible()
})

import { expect, test } from '@playwright/test'

test('demo account: hover, keyboard, outside click and no account network', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/auth/')) requests.push(request.url()) })
  await page.goto('/?devMode=demo')
  const trigger = page.getByRole('button', { name: '账户菜单' })
  await trigger.hover()
  await expect(page.getByRole('menu')).toBeVisible()
  await trigger.focus()
  await trigger.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: '切换真实模式' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await trigger.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toHaveCount(0)
  await page.locator('.breadcrumbs').click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.goto('/profile?devMode=demo')
  await expect(page.getByText('Mock 演示账户不是真实身份，不读取或修改真实资料。')).toBeVisible()
  expect(requests).toEqual([])
})

test('mobile account opens and closes by tap', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  try {
    await page.goto('http://127.0.0.1:15174/?devMode=demo')
    const trigger = page.getByRole('button', { name: '账户菜单' })
    await trigger.tap()
    await expect(page.getByRole('menu')).toBeVisible()
    await trigger.tap()
    await expect(page.getByRole('menu')).toHaveCount(0)
  } finally { await context.close() }
})

test('real own profile without admin permissions, truthful failed logout and no refresh', async ({ page }) => {
  let nickname = '真实昵称'
  let logoutCount = 0
  let refreshCount = 0
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/')) { await route.continue(); return }
    const data = path === '/api/auth/refresh' ? (refreshCount++, { accessToken: 'fixture' }) :
      path === '/api/auth/me' ? { id: 'u1', username: 'owner', nickname, email: 'owner@example.com', role: '普通成员', permissions: [] } :
      path === '/api/auth/profile' ? { nickname: nickname = route.request().postDataJSON().nickname, email: 'owner@example.com' } : {}
    if (path === '/api/auth/logout') {
      logoutCount++
      await route.fulfill({ status: 503, json: { error: { message: 'offline' } } }); return
    }
    await route.fulfill({ json: { data } })
  })
  await page.goto('/profile?devMode=real')
  await expect(page.getByRole('heading', { name: '个人资料' })).toBeVisible()
  await page.getByLabel('昵称', { exact: true }).fill('新昵称')
  await page.getByRole('button', { name: '保存资料' }).click()
  await expect(page.getByText('资料已保存')).toBeVisible()
  const trigger = page.getByRole('button', { name: '账户菜单' })
  await trigger.focus(); await trigger.press('ArrowDown')
  await expect(page.getByRole('menu').getByText('新昵称', { exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('alert')).toContainText('无法确认服务器退出成功')
  expect(logoutCount).toBe(1)
  expect(refreshCount).toBe(1)
})

test('profile errors stay errors and forced password change wins over own-profile access', async ({ page }) => {
  let forced = false
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/')) return route.continue()
    if (path === '/api/auth/profile') return route.fulfill({ status: 400, json: { error: { message: '邮箱已被使用' } } })
    return route.fulfill({ json: { data: path === '/api/auth/refresh' ? { accessToken: 'fixture' } :
      { id: 'owner', username: 'owner', nickname: '昵称', role: '成员', permissions: [], forceChangePassword: forced } } })
  })
  await page.goto('/profile?devMode=real')
  await page.getByLabel('邮箱', { exact: true }).fill('used@example.com')
  await page.getByRole('button', { name: '保存资料' }).click()
  await expect(page.getByRole('alert')).toHaveText('邮箱已被使用')
  await expect(page.getByText('资料已保存')).toHaveCount(0)
  forced = true
  await page.reload()
  await expect(page).toHaveURL(/change-password/)
  await expect(page.getByText('当前账户必须修改密码后才能继续使用。')).toBeVisible()
})

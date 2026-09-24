import { expect, test } from '@playwright/test'

const sizes = [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 414, height: 896 }, { width: 768, height: 1024 }, { width: 1024, height: 900 }, { width: 1280, height: 900 }, { width: 1440, height: 900 }]
const routes = ['/', '/video', '/video/new', '/video/library/scripts', '/video/library/characters', '/video/library/storyboards', '/hot-topics', '/articles', '/publishing', '/tasks', '/assets', '/workflows', '/models', '/analytics', '/settings']

for (const size of sizes) {
  test(`${size.width}px 全页面可访问且无横向溢出`, async ({ page }) => {
    await page.setViewportSize(size)
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))
    for (const path of routes) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.locator('.ant-spin-spinning')).toHaveCount(0)
      const width = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, expected: innerWidth }))
      expect(width.actual, `${path} at ${size.width}px`).toBeLessThanOrEqual(width.expected + 1)
    }
    expect(errors).toEqual([])
  })
}

test('移动端导航抽屉与工作台截图', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '打开导航' }).click()
  await expect(page.locator('.sidebar')).toHaveClass(/open/)
  await page.locator('nav').getByRole('button', { name: 'AI 视频工厂' }).click()
  await expect(page).toHaveURL(/\/video$/)
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/)
  await page.goto('/')
  await page.getByRole('button', { name: '体验示例流水线' }).click()
  await expect(page.locator('.activity-item').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.screenshot({ path: 'test-results/dashboard-tablet.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true })
})

test('离线提示及未知路由', async ({ page, context }) => {
  await page.goto('/')
  await context.setOffline(true)
  await expect(page.getByRole('alert').filter({ hasText: '网络连接已断开' })).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByRole('alert').filter({ hasText: '网络连接已断开' })).toHaveCount(0)
  await page.goto('/missing-page')
  await expect(page.getByRole('heading', { name: '页面没有找到' })).toBeVisible()
})

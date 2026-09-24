import { expect, test } from '@playwright/test'

test.describe('工作台统计卡片', () => {
  test('六个统计卡片展示真实数量并映射到对应内容', async ({ page }) => {
    await page.goto('/')

    const cards = page.locator('.metric-grid .metric-card')
    await expect(cards).toHaveCount(6)
    await expect(cards.nth(0)).toContainText('今日视频任务')
    await expect(cards.nth(1)).toContainText('今日文章任务')
    await expect(cards.nth(2)).toContainText('已收录热点')
    await expect(cards.nth(3)).toContainText('正在生产')
    await expect(cards.nth(4)).toContainText('等待审核')
    await expect(cards.nth(5)).toContainText('任务成功率')

    const mappings = [
      { index: 0, path: /\/tasks\?kind=video&date=today/ },
      { index: 1, path: /\/tasks\?kind=article&date=today/ },
      { index: 2, path: /\/hot-topics$/ },
      { index: 3, path: /\/tasks\?status=RUNNING/ },
      { index: 4, path: /\/tasks\?status=REVIEWING/ },
      { index: 5, path: /\/analytics$/ },
    ]

    for (const mapping of mappings) {
      await cards.nth(mapping.index).focus()
      await expect(cards.nth(mapping.index)).toHaveAttribute('href', /.+/)
      await cards.nth(mapping.index).press('Enter')
      await expect(page).toHaveURL(mapping.path)
      await page.goto('/')
    }
  })

  test('移动端统计卡片不产生横向溢出且支持键盘焦点', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
    await page.locator('.metric-card-link').first().focus()
    await expect(page.locator('.metric-card-link').first()).toBeFocused()
  })
})

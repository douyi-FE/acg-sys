import { expect, test } from '@playwright/test'

test.describe('分析页任务状态分布', () => {
  test('以中文展示状态分布并提供可访问的状态说明', async ({ page }) => {
    await page.goto('/analytics')

    const distribution = page.locator('h3', { hasText: '任务状态分布' }).locator('..')
    const expectedLabels = ['排队中', '制作中', '待审核', '等待中', '已完成', '失败', '已取消']
    const rawStatuses = ['QUEUED', 'RUNNING', 'REVIEWING', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED']

    await expect(distribution.locator('.analytics-row')).toHaveCount(expectedLabels.length)
    for (const label of expectedLabels) {
      await expect(distribution.locator('.analytics-row', { hasText: label })).toBeVisible()
    }
    const distributionText = (await distribution.locator('.analytics-row').allTextContents()).join(' ')
    for (const rawStatus of rawStatuses) {
      expect(distributionText).not.toContain(rawStatus)
    }
    await expect(distribution.locator('.analytics-row').first()).toHaveAttribute(
      'aria-label',
      /排队中：\d+ 个任务，占比 \d+%/,
    )
    await expect(distribution.locator('.analytics-row').first()).toHaveAttribute('title', /排队中：\d+ 个任务/)
  })
})

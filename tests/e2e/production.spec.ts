import { expect, test, type Page } from '@playwright/test'
import type { Database } from '../../src/types'

async function initialize(page: Page) {
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('acg-content-factory-db'))).toBe(true)
  // Only reduce mock execution latency; task creation and mutations below use the UI.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('acg-content-factory-db')!) as Database
    db.settings.stageDuration = 350
    db.settings.autoRetry = false
    localStorage.setItem('acg-content-factory-db', JSON.stringify(db))
  })
  await page.reload()
}

async function createVideo(page: Page, scenario = 'normal') {
  await page.goto('/video/new')
  await page.getByPlaceholder('为这次创作命名').fill('验收 · 程序员的转折')
  await page.getByPlaceholder('描述故事背景、核心冲突、情绪和结局…').fill('35岁程序员收到裁员通知后，重新开始自己的生活。')
  await page.getByPlaceholder('人物身份、外貌特征、关系与性格；无人物可填写“无角色”').fill('陈默，35岁中国男性，短黑发')
  if (scenario !== 'normal') {
    const field = page.locator('.ant-form-item').filter({ hasText: '异常模拟场景' })
    await field.locator('.ant-select').click()
    await page.getByTitle(scenario === 'system' ? '系统异常' : scenario === 'timeout' ? '生成超时' : '质量未达标', { exact: true }).click()
  }
  await page.getByRole('button', { name: /AI\s*自动创作/ }).click()
  await expect(page).toHaveURL(/\/tasks\/video-/)
}

test('创建 → 暂停 → 编辑 → 恢复 → 人工审核 → 资产导出与持久化', async ({ page }) => {
  await initialize(page)
  await createVideo(page)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(page.locator('.overview .status-badge')).toHaveText('已暂停')
  await page.locator('#script-editor').fill('人工调整：陈默决定给自己一次新的机会。')
  await page.getByRole('button', { name: '保存创作内容' }).click()
  await expect(page.locator('#script-editor')).toHaveValue('人工调整：陈默决定给自己一次新的机会。')
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('button', { name: '人工通过', exact: true })).toBeEnabled({ timeout: 15000 })
  await page.getByRole('button', { name: '人工通过', exact: true }).click()
  await expect(page.locator('.overview .status-badge')).toHaveText('已完成')
  await expect(page.locator('#script-editor')).toHaveValue('人工调整：陈默决定给自己一次新的机会。')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/task-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出制作包', exact: true }).click()
  expect((await downloadEvent).suggestedFilename()).toMatch(/\.json$/)
  await page.reload()
  await expect(page.locator('.overview .status-badge')).toHaveText('已完成')
  await page.goto('/assets')
  await expect(page.getByText('验收 · 程序员的转折-script.txt', { exact: true })).toBeVisible()
})

test('系统失败 → 重试 → 取消终态', async ({ page }) => {
  await initialize(page)
  await createVideo(page, 'system')
  await expect(page.locator('.overview .status-badge')).toHaveText('失败', { timeout: 10000 })
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '取消任务', exact: true }).click()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.locator('.overview .status-badge')).toHaveText('已取消')
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.locator('.overview .status-badge')).toHaveText('已取消')
})

test('质量失败保留细则，不能直接越过审核', async ({ page }) => {
  await initialize(page)
  await createVideo(page, 'quality')
  await expect(page.locator('.overview .status-badge')).toHaveText('失败', { timeout: 15000 })
  await expect(page.getByRole('button', { name: '人工通过', exact: true })).toBeDisabled()
  await expect(page.getByText('Quality Gate', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeEnabled()
})

test('热点分析 → 创建文章 → AI建议保存 → 刷新不丢稿', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await initialize(page)
  await page.goto('/hot-topics')
  await page.getByRole('button', { name: '选择热点并创建文章' }).first().click()
  await expect(page.getByRole('heading', { name: 'AI 推断', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '创建热点文章并进入编辑器' }).click()
  await expect(page).toHaveURL(/\/articles\/article-/)
  await expect(page.getByRole('heading', { name: /AI 写作助手/ })).toBeVisible()
  await page.getByPlaceholder('开始写作…').fill('这是人工核实前的测试草稿，事实结论需要查阅原始来源。')
  await page.getByRole('button', { name: '保存文章', exact: true }).click()
  await expect(page.getByText('文章已保存', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByPlaceholder('开始写作…')).toHaveValue('这是人工核实前的测试草稿，事实结论需要查阅原始来源。')
  await page.getByRole('button', { name: '生成建议', exact: true }).click()
  await expect(page.getByRole('button', { name: '应用并保存', exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '应用并保存', exact: true }).click()
  await expect(page.getByText('AI 建议已应用并保存', { exact: true })).toBeVisible()
  await page.locator('.safety .ant-select').first().click()
  await page.getByTitle('通过', { exact: true }).click()
  await page.getByPlaceholder('填写判断依据、来源链接与时间，或授权凭据；不适用时说明原因。').fill('此为本地测试制作稿，不包含新闻结论；已人工检查示例文字。')
  await page.getByRole('checkbox', { name: /我已逐项人工核验/ }).check()
  await page.getByRole('button', { name: '确认并保存人工核验' }).click()
  await expect(page.getByText('人工核验结果已保存，请到关联任务详情完成质量检查与最终审核', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/article-mobile.png', fullPage: true })
  await page.getByRole('link', { name: '关联任务详情' }).click()
  if (await page.getByRole('button', { name: '继续', exact: true }).isEnabled()) {
    await page.getByRole('button', { name: '继续', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '人工通过', exact: true })).toBeEnabled({ timeout: 15000 })
  await page.getByRole('button', { name: '人工通过', exact: true }).click()
  await expect(page.locator('.overview .status-badge')).toHaveText('已完成')
  await page.goto('/publishing')
  await expect(page.getByRole('button', { name: '导出 Markdown' })).toBeVisible()
})

test('超时后继续等待以及配置恢复', async ({ page }) => {
  await initialize(page)
  await createVideo(page, 'timeout')
  await expect(page.locator('.overview .status-badge')).toHaveText('失败', { timeout: 10000 })
  await page.getByRole('button', { name: '超时后继续等待' }).click()
  await expect(page.getByRole('button', { name: '超时后继续等待' })).toBeDisabled()
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(page.locator('.overview .status-badge')).toHaveText('已暂停')
  await page.getByRole('button', { name: '更换模型 / 重新执行' }).click()
  await page.locator('.config-fields .ant-select').nth(2).click()
  await page.getByTitle('服务正常（模拟故障已恢复）', { exact: true }).click()
  await page.getByRole('button', { name: '保存并重新执行' }).click()
  await expect(page.getByRole('button', { name: '人工通过', exact: true })).toBeEnabled({ timeout: 15000 })
})

import { expect, test } from '@playwright/test'

test('Workflow API snapshot imports, activates, exports and deactivates without execution', async ({
  page,
}) => {
  await page.goto('/workflows')
  await page.getByRole('button', { name: '导入工作流版本', exact: true }).click()
  const drawer = page.locator('.ant-drawer-content')
  await drawer.getByPlaceholder('1.0.0', { exact: true }).fill('1.2.3')
  await drawer
    .getByPlaceholder('ComfyUI API Format，不是画布 nodes/links JSON')
    .fill(JSON.stringify({ testNode: { class_type: 'TestNode', inputs: { text: '' } } }))
  await drawer
    .getByPlaceholder('{"prompt":"实际节点.inputs.text"}', { exact: true })
    .fill('{"prompt":"testNode.inputs.text"}')
  await drawer.getByRole('button', { name: '保存不可变版本' }).click()
  const revision = page.locator('.revision').filter({ hasText: 'V1.2.3' })
  await expect(revision).toBeVisible()
  await revision.getByRole('button', { name: '激活', exact: true }).click()
  await expect(revision.getByText('Active', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await revision.getByRole('button', { name: '导出', exact: true }).click()
  expect((await download).suggestedFilename()).toContain('1.2.3-snapshot.json')
  await page.reload()
  await expect(revision.getByText('Active', { exact: true })).toBeVisible()
  await revision.getByRole('button', { name: '停用', exact: true }).click()
  await expect(revision.getByText('Active', { exact: true })).toHaveCount(0)
  expect(
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('acg-content-factory-db')!)
      return db.comfyExecutions?.length ?? 0
    }),
  ).toBe(0)
})

test('mobile Workflow JSON editor explains desktop-only editing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/workflows')
  await page.getByRole('button', { name: '导入工作流版本', exact: true }).click()
  await expect(
    page.getByText('JSON 编辑为 PC 优先能力。请在桌面端导入或调整，手机仍可查看、审批与下载。'),
  ).toBeVisible()
  await expect(page.locator('.desktop-editor')).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

import { test, expect } from '@playwright/test'

test('实例创建、编辑与删除保留；Mock 明确拒绝探测且不发送 AI 请求', async ({ page }) => {
  let probes = 0
  await page.route('https://engine.test/**', async (route) => {
    probes++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"system":{},"devices":[]}',
      headers: { 'access-control-allow-origin': '*' },
    })
  })
  await page.goto('/engine')
  await page.getByRole('button', { name: '创建实例', exact: true }).click()
  await page.getByPlaceholder('例如 Local ComfyUI').fill('UI Test Engine')
  await page.getByPlaceholder('http://localhost:8188').fill('https://engine.test')
  const drawer = page.locator('.ant-drawer-content')
  const enabled = drawer.getByRole('switch', { name: '启用配置' })
  const connectionConsent = drawer.getByRole('checkbox', { name: '允许连接此地址' })
  await expect(enabled).toBeVisible()
  await expect(connectionConsent).toBeVisible()
  await expect(drawer.locator('.field-toggle .field-help')).toContainText('保存实例的启用设置')
  await expect(drawer.locator('.field-consent .field-help')).toContainText('明确授权')
  await expect(drawer.locator('label label, label [role="switch"]')).toHaveCount(0)
  await connectionConsent.check()
  await page.getByRole('button', { name: '保存实例', exact: true }).click()
  const card = page.locator('.instance-card').filter({ hasText: 'UI Test Engine' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '真实 HTTP 探测' }).click()
  await expect(
    page.getByText('Mock 模式禁止真实探测，请切换 real 并配置后端', { exact: true }).first(),
  ).toBeVisible()
  await expect(card).not.toContainText('HTTP 健康探测通过')
  expect(probes).toBe(0)
  await card.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByPlaceholder('例如 Local ComfyUI').fill('Renamed Engine')
  await page.getByRole('button', { name: '保存实例', exact: true }).click()
  const renamed = page.locator('.instance-card').filter({ hasText: 'Renamed Engine' })
  await expect(renamed).toBeVisible()
  await renamed.getByRole('switch').click()
  await expect(renamed.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await renamed.getByRole('button', { name: '删除', exact: true }).click()
  await page
    .locator('.ant-popconfirm')
    .getByRole('button', { name: /OK|确 定|确定/ })
    .click()
  await expect(renamed).toHaveCount(0)
  expect(probes).toBe(0)
})

for (const viewport of [
  { name: '桌面端', width: 1440, height: 900 },
  { name: '移动端', width: 390, height: 844 },
]) {
  test(`${viewport.name}创建实例抽屉的配置开关与网络授权布局`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/engine')
    await page.getByRole('button', { name: '创建实例', exact: true }).click()

    const drawer = page.locator('.ant-drawer-content')
    const toggleField = drawer.locator('.field-toggle')
    const consentField = drawer.locator('.field-consent')
    await expect(drawer.getByRole('switch', { name: '启用配置' })).toHaveAttribute('aria-checked', 'true')
    await expect(drawer.getByRole('checkbox', { name: '允许连接此地址' })).not.toBeChecked()
    await expect(toggleField.locator('.field-help')).toBeVisible()
    await expect(consentField.locator('.field-help')).toBeVisible()
    await expect(drawer.locator('.field-consent label')).toHaveCount(1)
    await expect(drawer.locator('label label, label [role="switch"]')).toHaveCount(0)
    await expect(drawer.locator('.field')).toHaveCount(4)
    const enabled = drawer.getByRole('switch', { name: '启用配置', exact: true })
    const consent = drawer.getByRole('checkbox', { name: '允许连接此地址', exact: true })
    const labelBox = (await toggleField.locator('label').boundingBox())!
    const switchBox = (await enabled.boundingBox())!
    expect(switchBox.width).toBeLessThanOrEqual(60)
    expect(Math.abs(labelBox.y + labelBox.height / 2 - switchBox.y - switchBox.height / 2)).toBeLessThan(2)
    expect((await toggleField.locator('.field-help').boundingBox())!.y).toBeGreaterThan(
      switchBox.y + switchBox.height,
    )
    expect((await consentField.locator('.field-help').boundingBox())!.y).toBeGreaterThan(
      (await consentField.locator('label').boundingBox())!.y +
        (await consentField.locator('label').boundingBox())!.height,
    )
    await toggleField.locator('label').click()
    await expect(enabled).not.toBeChecked()
    await enabled.press('Space')
    await expect(enabled).toBeChecked()
    await consentField.getByText('允许连接此地址', { exact: true }).click()
    await expect(consent).toBeChecked()
    await consent.press('Space')
    await expect(consent).not.toBeChecked()
    await expect(enabled).toBeChecked()
    expect(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await testInfo.attach('engine-drawer', { body: await drawer.screenshot(), contentType: 'image/png' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  })
}

test('移动端状态 Drawer、网络同意门禁与未配置反馈', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/comfyui')
  await page.getByRole('button', { name: /AI 引擎/ }).click()
  await expect(page.getByText('全局 AI 引擎状态', { exact: true })).toBeVisible()
  await page.locator('.ant-drawer-close').click()
  await page.getByRole('button', { name: '提交并执行' }).click()
  await expect(page.getByText('请明确同意真实网络请求', { exact: true })).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '提交并执行' }).click()
  await expect(page.getByText('请填写实例', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.goto('/comfyui/executions/not-found')
  await expect(page.getByText('执行不存在或已被移除', { exact: true })).toBeVisible()
})

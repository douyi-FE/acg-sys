import { expect, test } from '@playwright/test'

test('metadata dropdowns create, validate provider switches, and preserve existing drafts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/workflows?devMode=demo')
  await page.getByRole('button', { name: '创建工作流', exact: true }).click()
  const drawer = page.locator('.ant-drawer-content').filter({ hasText: '工作流元数据' })
  const type = drawer.getByRole('combobox', { name: '工作流类型' })
  const provider = drawer.getByRole('combobox', { name: '工作流提供方' })
  const selectedType = type
    .locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]')
    .locator('.ant-select-selection-item')
  const selectedProvider = provider
    .locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]')
    .locator('.ant-select-selection-item')
  await expect(page.locator('select')).toHaveCount(0)
  await expect(provider).toBeVisible()
  await selectedProvider.click()
  await expect(
    page.locator(
      '.ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)',
    ),
  ).toHaveText(['Mock 模拟服务', 'ComfyUI引擎'])
  await provider.press('Escape')
  await selectedType.click()
  await expect(
    page.locator(
      '.ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)',
    ),
  ).toHaveText(['文本生成', '图像生成', '视频生成', '音频生成', '视觉理解', '向量嵌入'])
  await type.press('Escape')
  await drawer.getByLabel('名称', { exact: true }).fill('下拉回归')
  await drawer.getByLabel('描述', { exact: true }).fill('保留描述')
  await drawer.getByLabel('参数映射（JSON）', { exact: true }).fill('{"prompt":"node.inputs.text"}')
  await selectedProvider.click()
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: 'ComfyUI' })
    .click()
  await expect(selectedType).toContainText('文本生成')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await selectedType.click()
  await expect(
    page.locator(
      '.ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)',
    ),
  ).toHaveText(['图像生成', '视频生成', '音频生成'])
  await type.press('Escape')
  await drawer.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(type).toHaveAttribute('aria-invalid', 'true')
  await expect(
    drawer.getByText('请选择此提供方支持的工作流类型；切换提供方不会自动更改原类型', { exact: true }),
  ).toBeVisible()
  await selectedType.click()
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: '视频生成' })
    .click()
  await drawer.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(drawer).toBeHidden()
  await page.reload()
  const row = page.locator('.workflow').filter({ hasText: '下拉回归' })
  await row.getByRole('button', { name: '编辑 / 版本', exact: true }).click()
  await expect(selectedType).toHaveText('视频生成')
  await expect(selectedProvider).toHaveText('ComfyUI引擎')
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('acg-content-factory-db')!).workflows.find(
      (w: { name: string }) => w.name === '下拉回归',
    ),
  )
  expect(saved).toMatchObject({ type: 'video', provider: 'ComfyUI' })
  await expect(drawer.getByLabel('描述', { exact: true })).toHaveValue('保留描述')
  await expect(drawer.getByLabel('参数映射（JSON）', { exact: true })).toHaveValue(
    '{\n  "prompt": "node.inputs.text"\n}',
  )
})

test('legacy type is descriptive, disabled and saved unchanged', async ({ page }) => {
  await page.goto('/workflows?devMode=demo')
  await page
    .locator('.workflow')
    .filter({ hasText: 'MiniMax H3 Mock' })
    .getByRole('button', { name: '编辑 / 版本' })
    .click()
  const drawer = page.locator('.ant-drawer-content').filter({ hasText: '工作流元数据' })
  const type = drawer.getByRole('combobox', { name: '工作流类型' })
  const selected = type
    .locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]')
    .locator('.ant-select-selection-item')
  await expect(selected).toContainText('Image to Video')
  await selected.click()
  await expect(
    page
      .locator('.ant-select-dropdown:visible .ant-select-item-option-disabled')
      .filter({ hasText: 'Image to Video' }),
  ).toBeVisible()
  await type.press('Escape')
  await drawer.getByLabel('描述', { exact: true }).fill('仅改描述')
  await drawer.getByLabel('版本号', { exact: true }).fill('0.0.1')
  await drawer.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(drawer).toBeHidden()
  await page.reload()
  await expect(page.locator('.workflow').filter({ hasText: 'MiniMax H3 Mock' })).toContainText('仅改描述')
  await page
    .locator('.workflow')
    .filter({ hasText: 'MiniMax H3 Mock' })
    .getByRole('button', { name: '编辑 / 版本' })
    .click()
  await expect(selected).toContainText('Image to Video')
  await expect(drawer.getByLabel('描述', { exact: true })).toHaveValue('仅改描述')
})

for (const width of [390, 1440]) {
  test(`Chinese navigation, breadcrumbs, engine drawer and account menu at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/workflows?devMode=demo')
    if (width === 390) await page.getByRole('button', { name: '打开导航', exact: true }).click()
    const nav = page.locator('.sidebar')
    await expect(nav.getByRole('button', { name: '工作流', exact: true })).toBeVisible()
    await nav.getByRole('button', { name: 'ComfyUI引擎', exact: true }).click()
    await expect(page.locator('.breadcrumbs')).toContainText('ComfyUI引擎')
    for (const surface of ['.sidebar', '.topbar', '.tabs'])
      await expect(page.locator(surface)).not.toContainText(/Workflow|Engine/)
    await page.getByRole('button', { name: '工作流注册表', exact: true }).click()
    await expect(page.getByRole('heading', { name: '工作流文件与版本', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /AI 引擎/ }).click()
    const drawer = page.locator('.ant-drawer-content').filter({ hasText: '全局 AI 引擎状态' })
    await expect(drawer).not.toContainText(/Workflow|Engine/)
    await drawer.getByRole('button', { name: '打开引擎中心', exact: true }).click()
    await expect(page.locator('.breadcrumbs')).toContainText('引擎中心')
    await page.getByRole('button', { name: '账户菜单', exact: true }).click()
    await expect(page.getByRole('menu', { name: '账户操作' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '切换真实模式' })).toBeVisible()
  })
}

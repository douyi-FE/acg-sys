import { expect, test, type Locator, type Page } from '@playwright/test'

// Actual browser-workspace acceptance. No fake routes, network fulfillment,
// injected executions, skip or expected failures. Mock production is labelled.
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
]

async function fitsViewport(page: Page, surface?: Locator) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(1)
  if (surface) {
    await expect(surface).toBeVisible()
    await expect.poll(async () => {
      const box = await surface.boundingBox()
      const viewport = page.viewportSize()
      return !!box && !!viewport && box.x >= -1 && box.x + box.width <= viewport.width + 1
    }).toBe(true)
  }
}

function drawer(page: Page, title: string) {
  return page.locator('.ant-drawer-content').filter({ hasText: title })
}

async function initialized(page: Page, path: string) {
  await page.goto(path)
  // Read-only readiness check: never alter the workspace or accelerate stages.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('acg-content-factory-db') !== null)).toBe(true)
}

for (const viewport of viewports) {
  test.describe(`${viewport.width}px 当前 Phase 2`, () => {
    test.use({ viewport })

    test('全局 Engine Drawer 在业务页面可关闭并进入 Engine Center', async ({ page }) => {
      for (const path of ['/', '/tasks', '/assets', '/workflows']) {
        await initialized(page, path)
        const trigger = page.getByRole('button', { name: /AI 引擎/ })
        await trigger.click()
        const panel = drawer(page, '全局 AI 引擎状态')
        await expect(panel.locator('.engine-status-row')).toHaveCount(5)
        await expect(panel.locator('.engine-status-row').filter({ hasText: 'GPU / VRAM' })).toContainText('不可用')
        await expect(panel.locator('.engine-status-row').filter({ hasText: 'LLM' })).toContainText('Mock')
        await fitsViewport(page, panel)
        await panel.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(panel).toBeHidden()
      }
      await page.getByRole('button', { name: /AI 引擎/ }).click()
      await drawer(page, '全局 AI 引擎状态').getByRole('button', { name: '打开引擎中心' }).click()
      await expect(page).toHaveURL(/\/engine$/)
      await expect(page.getByRole('heading', { name: '引擎中心', exact: true })).toBeVisible()
      await expect(drawer(page, '全局 AI 引擎状态')).toBeHidden()
      await fitsViewport(page)
    })

    test('Instance 是部署配置：创建、刷新、编辑，不把允许连接当作健康', async ({ page }) => {
      await initialized(page, '/engine')
      await expect(page.getByText('暂无实例；不创建虚构的 Local ComfyUI。', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '创建实例', exact: true }).click()
      const form = drawer(page, '创建 ComfyUI 实例')
      await form.getByPlaceholder('例如 Local ComfyUI').fill('E2E 未探测部署服务')
      // Reserved documentation address; no network probe or prompt is submitted.
      await form.getByPlaceholder('http://localhost:8188').fill('http://192.0.2.1:8188')
      await fitsViewport(page, form)
      await form.getByRole('button', { name: '保存实例', exact: true }).click()
      await expect(form).toBeHidden()
      const card = page.locator('.instance-card').filter({ hasText: 'E2E 未探测部署服务' })
      await expect(card).toContainText('http://192.0.2.1:8188')
      await expect(card).toContainText('未允许')
      await expect(card).toContainText('尚未探测')
      await expect(card.locator('.health-grid')).not.toContainText('Healthy')
      await fitsViewport(page, card)
      await page.reload()
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: '编辑', exact: true }).click()
      const edit = drawer(page, '编辑 ComfyUI 实例')
      await edit.getByPlaceholder('例如 Local ComfyUI').fill('E2E 已编辑部署服务')
      await edit.getByRole('button', { name: '保存实例', exact: true }).click()
      await expect(edit).toBeHidden()
      await page.reload()
      await expect(page.locator('.instance-card')).toHaveCount(1)
      await expect(page.locator('.instance-card')).toContainText('E2E 已编辑部署服务')
      await expect(page.locator('.instance-card')).toContainText('未允许')
      await fitsViewport(page)
    })

    test('ComfyUI Queue 与 Registry 真实空态、实例入口和未知作业详情', async ({ page }) => {
      await initialized(page, '/comfyui')
      await expect(page.getByRole('heading', { name: 'ComfyUI引擎', exact: true })).toBeVisible()
      await expect(page.locator('.execution-card')).toHaveCount(0)
      // Missing collection and an initialized empty collection are both honest,
      // distinct UI states. Neither proves that an external job has run.
      await expect(page.locator('.execution-list .empty-state')).toHaveText(
        /^(Unavailable：store 未提供执行队列接口|暂无匹配执行记录)$/,
      )
      await fitsViewport(page)
      await page.getByRole('button', { name: '工作流注册表', exact: true }).click()
      await expect(page.getByRole('heading', { name: '工作流注册表', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: '工作流文件与版本', exact: true })).toBeVisible()
      await fitsViewport(page)
      await page.getByRole('button', { name: '打开工作流中心', exact: true }).click()
      await expect(page).toHaveURL(/\/workflows$/)
      await expect(page.getByRole('heading', { name: '工作流中心', exact: true })).toBeVisible()
      await page.goto('/comfyui')
      await page.getByRole('link', { name: '实例与健康', exact: true }).click()
      await expect(page).toHaveURL(/\/engine$/)
      await page.getByRole('button', { name: '查看队列', exact: true }).click()
      await expect(page).toHaveURL(/\/comfyui$/)
      // Explicit negative test, not a fictitious existing job.
      await page.goto('/comfyui/executions/e2e-does-not-exist')
      await expect(page.getByRole('heading', { name: '执行详情', exact: true })).toBeVisible()
      await expect(page.locator('.page-stack > .empty-state')).toHaveText(
        /^(执行不存在或已被移除|Unavailable：执行详情接口未接入)$/,
      )
      await expect(page.locator('.log-row')).toHaveCount(0)
      await fitsViewport(page)
      await page.getByRole('button', { name: '返回队列', exact: true }).click()
      await expect(page).toHaveURL(/\/comfyui$/)
    })

    test('Workflow 文件入口区分 UI 画布和 API，手机明确 PC 编辑边界', async ({ page }) => {
      await initialized(page, '/workflows')
      await expect(page.getByRole('heading', { name: '工作流文件与版本' })).toBeVisible()
      await page.getByRole('button', { name: '导入工作流版本' }).click()
      const panel = drawer(page, '导入版本 · 画布 / API / 参数映射')
      await fitsViewport(page, panel)
      if (viewport.width < 768) {
        await expect(panel.locator('.mobile-editor-note')).toBeVisible()
        await expect(panel.getByRole('button', { name: '保存不可变版本' })).toBeHidden()
      } else {
        // Actual UI import validation; this graph is never sent to a Provider.
        await panel.getByPlaceholder('ComfyUI API Format，不是画布 nodes/links JSON').fill('{"nodes":[],"links":[]}')
        await panel.getByRole('button', { name: '保存不可变版本' }).click()
        await expect(panel.getByText('请填写 API 格式工作流', { exact: true })).toBeVisible()
      }
      await panel.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(panel).toBeHidden()
      await expect(page.locator('.revision')).toHaveCount(0)
    })

    test('UI 创建 Mock 任务产生 Workflow/Stage Trace，刷新保留且可导出', async ({ page }) => {
      await initialized(page, '/video/new')
      await page.getByPlaceholder('为这次创作命名').fill('Phase2 浏览器 Trace 验收')
      await page.getByPlaceholder('描述故事背景、核心冲突、情绪和结局…').fill('明确标注为 Mock 的本地编排验收，不生成真实视频。')
      await page.getByPlaceholder('人物身份、外貌特征、关系与性格；无人物可填写“无角色”').fill('无角色')
      await page.getByRole('button', { name: /AI\s*自动创作/ }).click()
      await expect(page).toHaveURL(/\/tasks\/video-/)
      const trace = page.locator('.production-trace')
      await expect(trace.getByRole('heading', { name: 'Production Trace', exact: true })).toBeVisible()
      const script = trace.locator('.trace-rail button').filter({ hasText: 'SCRIPT' })
      await expect(script).toContainText('SUCCESS', { timeout: 15000 })
      await page.getByRole('button', { name: '暂停', exact: true }).click()
      await script.click()
      await expect(trace.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Provider$/ }) })).toContainText('Mock')
      const expectedWorkflow = await page.evaluate(() => {
        const db = JSON.parse(localStorage.getItem('acg-content-factory-db')!) as {
          executions: { taskId: string; stageId: string; workflowId: string }[]
        }
        const taskId = location.pathname.split('/').at(-1)
        // Compare the actual persisted attempt, not Task's media workflow:
        // SCRIPT can legitimately select a text workflow by stage capability.
        return db.executions.find(e => e.taskId === taskId && e.stageId === 'SCRIPT')?.workflowId
      })
      expect(expectedWorkflow).toBeTruthy()
      await expect(trace.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^工作流$/ }) }).locator('dd')).toHaveText(expectedWorkflow!)
      const executionId = await trace.locator('dl > div').filter({ hasText: 'Execution ID' }).locator('dd').innerText()
      expect(executionId).toMatch(/^execution-/)
      await fitsViewport(page, trace)
      await page.reload()
      await script.click()
      await expect(trace.locator('dl > div').filter({ hasText: 'Execution ID' }).locator('dd')).toHaveText(executionId)
      await expect(trace).toContainText('阶段完成')
      const download = page.waitForEvent('download')
      await trace.getByRole('button', { name: '导出追踪记录' }).click()
      const file = await download
      expect(file.suggestedFilename()).toMatch(/^production-trace-video-.+\.json$/)
      const stream = await file.createReadStream()
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      const exported = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        taskId: string
        executions: { id: string; traceId: string }[]
        traces: { id: string; executionId: string }[]
      }
      expect(new URL(page.url()).pathname).toBe(`/tasks/${exported.taskId}`)
      const recorded = exported.executions.find(item => item.id === executionId)
      expect(recorded).toMatchObject({ taskId: exported.taskId, stageId: 'SCRIPT', provider: 'Mock', status: 'SUCCESS', attempt: 1 })
      expect(exported.traces.find(item => item.id === recorded?.traceId)).toMatchObject({
        executionId, taskId: exported.taskId, provider: 'Mock',
      })
      await fitsViewport(page)
    })
  })
}

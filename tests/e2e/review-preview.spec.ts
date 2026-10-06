import { expect, test } from '@playwright/test'
import { createDemoSeed, createSeed, createTask, createStages } from '../../src/services/seed'
import { advanceTask } from '../../src/services/pipeline'

test('manual review: pipeline reaches review, preview precedes enabled controls, approve and reject persist', async ({ page }) => {
  const { db, task } = videoTask()
  task.status = 'QUEUED'
  task.stageIndex = 0
  task.quality = null
  db.tasks = [task]
  let time = Date.parse(task.updatedAt)
  for (let i = 0; i < 11; i++) advanceTask(db, task, time += db.settings.stageDuration)
  expect(task.status).toBe('REVIEWING')
  await page.addInitScript(value => {
    if (!localStorage.getItem('acg-content-factory-db'))
      localStorage.setItem('acg-content-factory-db', value)
  }, JSON.stringify(db))
  await page.goto(`/tasks/${task.id}?devMode=demo`)
  const approve = page.getByRole('button', { name: '人工通过', exact: true })
  const preview = page.getByTestId('task-review-preview')
  await expect(preview).toContainText('ACTUAL SAVED SCRIPT')
  await expect(approve).toBeEnabled()
  await expect(page.getByTestId('task-delivery')).toHaveCount(0)
  expect(await page.evaluate(() => {
    const preview = document.querySelector('#review-preview')!
    return !!(preview.compareDocumentPosition(document.querySelector('[data-testid="manual-review"]')!) & Node.DOCUMENT_POSITION_FOLLOWING)
  })).toBe(true)
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await approve.click()
  await expect(page.locator('#approve-reason')).toContainText('SUCCESS')
  await expect(approve).toBeDisabled()
  const delivery = page.getByTestId('task-delivery')
  await expect(delivery).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await delivery.getByRole('button', { name: '下载制作资料（JSON）', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toBe(`${task.id}-deliverable.json`)
  const videoDownload = page.waitForEvent('download')
  await delivery.getByRole('button', { name: '下载 Mock 示例视频', exact: true }).click()
  expect((await videoDownload).suggestedFilename()).toMatch(/\.mp4$/)
  await page.reload()
  await expect(page.locator('#approve-reason')).toContainText('SUCCESS')
  await page.evaluate(value => localStorage.setItem('acg-content-factory-db', value), JSON.stringify(db))
  await page.reload()
  await page.getByRole('button', { name: '驳回', exact: true }).click()
  await page.locator('.ant-popconfirm').getByRole('button', { name: /确\s*定/ }).click()
  await expect(page.locator('#approve-reason')).toContainText('FAILED')
  await expect(preview).toContainText('ACTUAL SAVED SCRIPT')
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeEnabled()
  await expect(page.locator('#logs')).toContainText('人工操作：reject')
})

test('real review explains missing permission and unsupported endpoint without a mutation', async ({ page }) => {
  const { db, task } = videoTask()
  db.tasks = [task]
  let canUpdate = false
  const mutations: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/tasks/')) mutations.push(request.url())
  })
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { data: { accessToken: 'review-token' } } }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { data: {
    id: 'review-user', username: 'test', role: 'reviewer',
    permissions: ['workspace.read', 'tasks.read', ...(canUpdate ? ['tasks.update'] : [])],
  } } }))
  await page.route('**/api/workspace', route => route.fulfill({ json: { data: db } }))
  await page.goto(`/tasks/${task.id}?devMode=real`)
  await expect(page.locator('#approve-reason')).toContainText('tasks.update')
  await expect(page.getByRole('button', { name: '人工通过', exact: true })).toBeDisabled()
  canUpdate = true
  await page.reload()
  await expect(page.locator('#approve-reason')).toContainText('后端尚未提供任务审核接口')
  await expect(page.getByRole('button', { name: '驳回', exact: true })).toBeDisabled()
  expect(mutations).toEqual([])
})

test('hotspot creation → full saved article → editor return → changed review', async ({ page }) => {
  await page.goto('/?devMode=demo')
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('acg-content-factory-db'))).toBe(true)
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('acg-content-factory-db')!)
    db.settings.stageDuration = 100
    localStorage.setItem('acg-content-factory-db', JSON.stringify(db))
  })
  await page.reload()
  await page.goto('/hot-topics')
  await page.getByRole('button', { name: '选择热点并创建文章' }).first().click()
  await page.getByRole('button', { name: '创建热点文章并进入编辑器' }).click()
  const body = `# Persisted title\n\n## Saved body\n\nA **bold statement** and *emphasis*.\n\n- First item\n- Second item\n\n> Saved quote\n\n| Column | Value |\n| --- | --- |\n| ${'wide-cell-'.repeat(50)} | Actual data |\n\n\`\`\`js\n${'longCode'.repeat(100)}\n\`\`\`\n\n[External](https://example.com) ![Tracking](https://tracker.invalid/pixel)\n\n${'Full persisted paragraph.\n\n'.repeat(100)}<img src=x onerror=alert(1)>\nEND OF ARTICLE`
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.getByPlaceholder('开始写作…').fill(body)
  await page
    .locator('label')
    .filter({ hasText: /^标题$/ })
    .locator('input')
    .fill('Persisted title')
  await page.getByRole('button', { name: '保存文章', exact: true }).click()
  await expect(page.getByText('文章已保存', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '关联任务详情' }).click()
  const preview = page.getByTestId('task-review-preview')
  if (await page.getByRole('button', { name: '继续', exact: true }).isEnabled())
    await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.locator('.overview .status-badge')).toHaveText('待审核', { timeout: 15000 })
  await expect(preview.getByRole('heading', { name: 'Persisted title', exact: true })).toBeVisible()
  const rendered = page.getByTestId('article-full-body')
  await expect(rendered.getByRole('heading', { name: 'Saved body' })).toBeVisible()
  await expect(rendered.locator('strong')).toHaveText('bold statement')
  await expect(rendered.locator('em')).toHaveText('emphasis')
  await expect(rendered.locator('ul > li')).toHaveCount(2)
  await expect(rendered.locator('table th')).toHaveCount(2)
  await expect(rendered.locator('table')).toContainText('Actual data')
  await expect(rendered.locator('blockquote')).toHaveText('Saved quote')
  await expect(rendered.locator('pre code')).toHaveText('longCode'.repeat(100))
  await expect(rendered.getByRole('link', { name: 'External' })).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(rendered.getByRole('link', { name: 'External' })).toHaveAttribute('target', '_blank')
  await expect(rendered).toContainText('END OF ARTICLE')
  await expect(rendered.locator('h1')).toHaveCount(0)
  expect(await rendered.locator('p').filter({ hasText: 'Full persisted paragraph.' }).count()).toBe(100)
  await expect(preview.locator('img')).toHaveCount(0)
  await preview.getByRole('link', { name: '打开文章与事实核验' }).click()
  await expect(page.getByPlaceholder('开始写作…')).toHaveValue(body)
  await page.getByPlaceholder('开始写作…').fill(`${body}\nSAVED EDIT`)
  await page.getByRole('button', { name: '保存文章', exact: true }).click()
  await expect(page.getByText('文章已保存', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回任务审核预览' }).click()
  await expect(rendered).toContainText('SAVED EDIT')
  await expect(page.getByRole('button', { name: '人工通过', exact: true })).toBeDisabled()
  await expect(preview).toContainText('当前内容尚无有效质量评分')
  await page.reload()
  await expect(rendered).toContainText('SAVED EDIT')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  for (const selector of ['pre', '.markdown-table-scroll']) {
    const dimensions = await rendered.locator(selector).evaluate((el) => ({
      width: el.clientWidth,
      scroll: el.scrollWidth,
      right: el.getBoundingClientRect().right,
    }))
    expect(dimensions.scroll).toBeGreaterThan(dimensions.width)
    expect(dimensions.right).toBeLessThanOrEqual(390)
  }
  expect(requests.some((url) => url.includes('tracker.invalid'))).toBe(false)
})

function videoTask() {
  const db = createSeed()
  const task = createTask({
    title: 'Review video',
    theme: 'Actual saved script',
    type: '短剧',
    ratio: '16:9',
    duration: 30,
    platform: 'test',
    style: 'test',
    characters: 'test',
    modelId: db.models[0]!.id,
    workflowId: db.workflows[0]!.id,
    scenario: 'normal',
  })
  task.status = 'REVIEWING'
  task.quality = { score: 96, threshold: 80, passed: true, criteria: [], suggestions: [] }
  task.script = 'ACTUAL SAVED SCRIPT'
  task.stageIndex = task.stages.length - 1
  return { db, task }
}

test('approved article offers copy and Markdown/HTML delivery without external publishing', async ({ page }) => {
  const { db, task } = videoTask()
  task.kind = 'article'
  task.stages = createStages('article')
  task.stageIndex = task.stages.length - 1
  task.modelId = 'qwen-max'
  task.workflowId = 'article-text'
  task.status = 'SUCCESS'
  task.approved = true
  task.progress = 100
  db.tasks = [task]
  db.articles = [{
    id: 'delivery-article', taskId: task.id, topicId: db.topics[0]!.id,
    title: '交付文章', body: '## 正文\n\n**审核内容**', outline: '', platform: '测试平台',
    status: 'approved', updatedAt: task.updatedAt,
    safety: [{ name: '来源', status: '通过', reason: '人工核查' }],
  }]
  await page.addInitScript(value => {
    localStorage.setItem('acg-content-factory-db', value)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => { sessionStorage.setItem('copied-text', text) } },
    })
  }, JSON.stringify(db))
  await page.goto(`/tasks/${task.id}?devMode=demo`)
  const delivery = page.getByTestId('task-delivery')
  await expect(delivery).toBeVisible()
  await delivery.getByRole('button', { name: '复制正文', exact: true }).click()
  expect(await page.evaluate(() => sessionStorage.getItem('copied-text'))).toBe(db.articles[0]!.body)
  for (const [label, extension] of [['下载 Markdown', 'md'], ['下载 HTML', 'html']]) {
    const download = page.waitForEvent('download')
    await delivery.getByRole('button', { name: label, exact: true }).click()
    expect((await download).suggestedFilename()).toBe(`delivery-article.${extension}`)
  }
  await expect(delivery.getByRole('button', { name: '下载 Mock 示例视频' })).toHaveCount(0)
})

test('task list opens inline review and delivery actions', async ({ page }) => {
  const { db, task } = videoTask()
  task.characters = [{
    id: 'review-character', name: '角色', age: 30, gender: '未设定', identity: '虚构角色',
    appearance: '测试外观', outfit: '测试服装', expression: '自然', pose: '站立',
  }]
  task.shots = [{
    id: 'review-shot', start: 0, end: 30, description: '测试分镜', character: '角色',
    camera: '固定', action: '动作', emotion: '自然', sound: '环境音',
    firstPrompt: '首帧', lastPrompt: '尾帧', bridge: '连续', continuity: '一致',
  }]
  db.tasks = [task]
  await page.addInitScript(value => localStorage.setItem('acg-content-factory-db', value), JSON.stringify(db))
  await page.goto('/tasks?devMode=demo')
  const row = page.locator('.task-row').first()
  await expect(row).toContainText('Review video')
  await row.getByRole('button', { name: '预览' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByTestId('mock-video-preview')).toBeVisible()
  await expect(modal.getByTestId('task-review-preview')).not.toContainText('ACTUAL SAVED SCRIPT')
  await expect(modal.locator('.storyboard-grid')).toHaveCount(0)
  await expect(modal.getByTestId('task-delivery')).toHaveCount(0)
  const videoScroll = await page.evaluate(() => ({
    documentScroll: getComputedStyle(document.body).overflow !== 'hidden',
    wrapScroll: getComputedStyle(document.querySelector('.video-preview-modal')!).overflowY,
    bodyScroll: document.querySelector('.video-preview-modal .ant-modal-body')!.scrollHeight
      > document.querySelector('.video-preview-modal .ant-modal-body')!.clientHeight,
  }))
  expect(videoScroll.documentScroll).toBe(false)
  expect(videoScroll.wrapScroll).toBe('hidden')
  expect(videoScroll.bodyScroll).toBe(false)
  await expect(modal.getByTestId('list-review-actions')).toHaveCount(0)
  await modal.getByRole('button', { name: 'Close', exact: true }).click()
  await row.getByRole('button', { name: '人工审批' }).click()
  await expect(page.getByRole('dialog').getByTestId('list-review-actions')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '人工通过', exact: true }).click()
  await expect(page.locator('.task-row')).toContainText('已完成')
  await expect(page.getByRole('dialog').getByTestId('task-delivery')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await row.getByRole('button', { name: '下载', exact: true }).click()
  await expect(modal.getByTestId('video-review-preview')).toHaveCount(0)
  const download = page.waitForEvent('download')
  await modal.getByRole('button', { name: '下载制作资料（JSON）', exact: true }).click()
  expect((await download).suggestedFilename()).toBe(`${task.id}-deliverable.json`)
})

test('demo article review previews generated illustration, approves, copies and downloads', async ({ page }) => {
  const db = createDemoSeed(createSeed())
  db.tasks = db.tasks.filter((task) => task.kind === 'article')
  db.tasks[0]!.createdAt = db.tasks[0]!.updatedAt = new Date().toISOString()
  await page.addInitScript((value) => {
    localStorage.setItem('acg-content-factory-db', value)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => sessionStorage.setItem('copied-text', text) },
    })
  }, JSON.stringify(db))
  await page.goto('/tasks?devMode=demo')

  const row = page.locator('.task-row').first()
  await expect(row).toContainText('图文示例')
  await row.getByRole('button', { name: '预览', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByTestId('article-full-body')).toContainText('从选题到交付')
  await expect(modal.locator('.article-illustration img')).toHaveAttribute(
    'src',
    '/mock-assets/mock-article-fact-check-v1.png',
  )
  const articleScroll = await page.evaluate(() => ({
    documentScroll: getComputedStyle(document.body).overflow !== 'hidden',
    bodyScroll: document.querySelector('.article-preview-modal .ant-modal-body')!.scrollHeight
      > document.querySelector('.article-preview-modal .ant-modal-body')!.clientHeight,
  }))
  expect(articleScroll.documentScroll).toBe(false)
  expect(articleScroll.bodyScroll).toBe(true)
  await expect(modal.getByTestId('task-delivery')).toHaveCount(0)
  await modal.getByRole('button', { name: 'Close', exact: true }).click()

  await row.getByRole('button', { name: '人工审批', exact: true }).click()
  const reviewModal = page.getByRole('dialog')
  await expect(reviewModal.getByTestId('list-review-actions')).toBeVisible()
  await reviewModal.getByRole('button', { name: '人工通过', exact: true }).click()
  await expect(row).toContainText('已完成')
  await expect(reviewModal.getByTestId('task-delivery')).toBeVisible()

  await reviewModal.getByRole('button', { name: '复制正文', exact: true }).click()
  expect(await page.evaluate(() => sessionStorage.getItem('copied-text'))).toContain('从选题到交付')
  for (const [label, extension] of [['下载 Markdown', 'md'], ['下载 HTML', 'html'], ['下载制作资料（JSON）', 'json']]) {
    const download = page.waitForEvent('download')
    await reviewModal.getByRole('button', { name: label, exact: true }).click()
    expect((await download).suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`))
  }
})

test('demo manual review honestly has no playable MP4', async ({ page }) => {
  const { db, task } = videoTask()
  db.tasks = [task]
  await page.addInitScript(
    (value) => localStorage.setItem('acg-content-factory-db', value),
    JSON.stringify(db),
  )
  await page.goto(`/tasks/${task.id}?devMode=demo`)
  const preview = page.getByTestId('task-review-preview')
  await expect(preview).toContainText('用户提供的 Mock 示例视频')
  await expect(preview).toContainText('ACTUAL SAVED SCRIPT')
  await expect(preview.getByTestId('mock-video-preview').locator('video')).toHaveAttribute(
    'src',
    '/mock-assets/f2f33158052b4d898f47826dcd166892.mp4',
  )
  const mockVideo = preview.getByTestId('mock-video-preview').locator('video')
  await expect.poll(() => mockVideo.evaluate((element) => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1)
  const videoShape = await mockVideo.evaluate((element) => {
    const video = element as HTMLVideoElement
    const box = video.getBoundingClientRect()
    return { sourceRatio: video.videoWidth / video.videoHeight, boxRatio: box.width / box.height }
  })
  expect(videoShape.sourceRatio).toBeGreaterThan(0)
  expect(Math.abs(videoShape.sourceRatio - videoShape.boxRatio)).toBeLessThan(0.02)
  const pipeline = page.getByTestId('production-pipeline')
  await expect(pipeline.locator('.ant-progress')).toBeVisible()
  await expect(pipeline.getByRole('navigation', { name: '生产阶段' }).locator('button')).toHaveCount(
    task.stages.length,
  )
  await pipeline.locator('.stage-button').first().click()
  await expect(pipeline.locator('.stage-button').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#stage-inspector h2')).toHaveText(task.stages[0]!.name)
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const borders = await preview.evaluate((el) => {
      const css = getComputedStyle(el)
      return [
        css.borderTopWidth,
        css.borderRightWidth,
        css.borderBottomWidth,
        css.borderLeftWidth,
        css.borderRadius,
      ]
    })
    expect(borders.every((value) => parseFloat(value) > 0)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
})

test('real registered execution assets use same-origin bearer/blob; unavailable assets have no fallback', async ({
  page,
}) => {
  const { db, task } = videoTask()
  db.tasks = [task]
  db.executions = [
    {
      id: 'execution-1',
      taskId: task.id,
      pipelineId: 'pipeline',
      stageId: 'COMPOSE',
      provider: 'ComfyUI',
      workflowId: '',
      workflowVersion: '1',
      status: 'SUCCESS',
      attempt: 1,
      traceId: 'trace',
      startedAt: task.updatedAt,
      input: '',
      output: '',
      logs: [],
    },
  ]
  db.assets = [
    {
      id: 'actual-video',
      taskId: '',
      executionId: 'execution-1',
      type: '视频',
      name: 'Final video',
      url: 'https://provider.invalid/fake.mp4',
      cover: 'https://provider.invalid/fake.jpg',
      tags: [],
      model: '',
      createdAt: task.updatedAt,
    },
    {
      id: 'actual-image',
      taskId: task.id,
      type: '图片',
      name: 'Frame',
      url: 'https://provider.invalid/frame.png',
      cover: '',
      tags: [],
      model: '',
      createdAt: task.updatedAt,
    },
    {
      id: 'denied-image',
      taskId: task.id,
      type: '图片',
      name: 'Unavailable frame',
      url: '',
      cover: '',
      tags: [],
      model: '',
      createdAt: task.updatedAt,
    },
    {
      id: 'markdown-asset',
      taskId: task.id,
      type: '文章',
      name: 'Saved notes.md',
      url: '',
      cover: '',
      tags: [],
      model: '',
      createdAt: task.updatedAt,
    },
    {
      id: 'plain-asset',
      taskId: task.id,
      type: '文章',
      name: 'Literal notes.txt',
      url: '',
      cover: '',
      tags: [],
      model: '',
      createdAt: task.updatedAt,
    },
    {
      id: 'empty-asset',
      taskId: task.id,
      type: '文章',
      name: 'Empty.txt',
      url: '',
      cover: '',
      tags: [],
      model: '',
      createdAt: task.updatedAt,
    },
  ]
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { data: { accessToken: 'review-token' } } }),
  )
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        data: {
          id: 'review-user',
          username: 'test',
          role: 'reviewer',
          permissions: ['workspace.read', 'tasks.read', 'assets.read'],
        },
      },
    }),
  )
  await page.route('**/api/workspace', (route) => route.fulfill({ json: { data: db } }))
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.route('**/api/assets/*/content', async (route) => {
    expect(new URL(route.request().url()).origin).toBe(new URL(page.url()).origin)
    expect(route.request().headers().authorization).toBe('Bearer review-token')
    if (route.request().url().includes('markdown-asset')) {
      await route.fulfill({
        contentType: 'text/markdown; charset=utf-8',
        body: '# Authorized notes\n\n**Saved bold**\n\n- Saved item\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![track](https://tracker.invalid/asset-pixel)\n\n<script>alert(1)</script>',
      })
    } else if (route.request().url().includes('plain-asset')) {
      await route.fulfill({ contentType: 'text/plain', body: '# Literal text\n\n**Not formatting**' })
    } else if (route.request().url().includes('empty-asset')) {
      await route.fulfill({ contentType: 'text/plain', body: '' })
    } else if (route.request().url().includes('denied-image')) {
      await route.fulfill({ status: 403, body: 'Forbidden' })
    } else if (route.request().url().includes('actual-image')) {
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64',
        ),
      })
    } else {
      // Generate a real playable browser media fixture, not a provider URL or fake MP4.
      await route.fulfill({ contentType: 'video/webm', body: media })
    }
  })
  // Record a tiny valid WebM using Chromium itself.
  await page.goto('/?devMode=real')
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(10)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    const result = new Promise<number[]>((resolve) => {
      recorder.ondataavailable = (e) => chunks.push(e.data)
      recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())))
    })
    recorder.start()
    ctx.fillRect(0, 0, 32, 32)
    await new Promise((resolve) => setTimeout(resolve, 250))
    recorder.stop()
    stream.getTracks().forEach((track) => track.stop())
    return result
  })
  const media = Buffer.from(bytes)
  await page.goto(`/tasks/${task.id}?devMode=real`)
  const preview = page.getByTestId('task-review-preview')
  const video = preview.locator('video')
  await expect(video).toHaveAttribute('src', /^blob:/)
  await expect
    .poll(() => video.evaluate((el) => (el as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(1)
  await video.evaluate(async (el) => {
    await (el as HTMLVideoElement).play()
  })
  await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0)
  await expect(preview.locator('img')).toHaveAttribute('src', /^blob:/)
  await expect(preview).toContainText('资产读取失败：HTTP 403')
  await expect(preview.getByRole('heading', { name: 'Authorized notes' })).toBeVisible()
  await expect(preview.locator('.authorized-asset strong')).toHaveText('Saved bold')
  await expect(preview.locator('.authorized-asset table')).toContainText('1')
  await expect(preview.locator('.authorized-asset pre')).toHaveText('# Literal text\n\n**Not formatting**')
  await expect(preview).toContainText('资产为空或格式不支持内联预览')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  expect(requests.some((url) => url.includes('provider.invalid'))).toBe(false)
  expect(requests.some((url) => url.includes('tracker.invalid'))).toBe(false)
})

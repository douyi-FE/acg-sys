import { expect, test, type Page } from '@playwright/test'

test.beforeEach(({ page }, info) => {
  void page
  test.skip(info.config.metadata.apiMode !== 'real', 'Requires the separate real-mode config')
})

const baseWorkspace = {
  version: 3,
  tasks: [],
  topics: [],
  articles: [],
  assets: [],
  workflows: [],
  models: [],
  settings: { threshold: 80, maxRetries: 0, maxIterations: 1, autoRetry: false, stageDuration: 0 },
}

async function auth(page: Page, permissions: string[], workspace: unknown = baseWorkspace) {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { data: { accessToken: 'fixture-token' } } }),
  )
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        data: {
          id: 'test-user',
          username: 'test',
          forceChangePassword: false,
          role: '自定义数据库角色',
          permissions,
        },
      },
    }),
  )
  await page.route('**/api/workspace', (route) => route.fulfill({ json: { data: workspace } }))
}

test('real metadata choices use enabled registry and send server values without administrative fetches', async ({
  page,
}) => {
  await auth(page, ['workspace.read', 'workflows.read', 'workflows.create'], {
    ...baseWorkspace,
    providerRegistry: [
      { provider: 'COMFYUI', workflowKinds: ['image', 'video', 'audio'] },
      { provider: 'OPENAI', workflowKinds: ['text'] },
      { provider: 'OLLAMA', workflowKinds: ['text'] },
    ],
  })
  const requests: string[] = []
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  const writes: unknown[] = []
  await page.route('**/api/workflows', async (route) => {
    writes.push(route.request().postDataJSON())
    await route.fulfill({ json: { data: { id: 'created' } } })
  })
  await page.goto('/workflows')
  await page.getByRole('button', { name: '创建工作流', exact: true }).click()
  const drawer = page.locator('.ant-drawer-content').filter({ hasText: '工作流元数据' })
  const provider = drawer.getByLabel('工作流提供方', { exact: true })
  const type = drawer.getByLabel('工作流类型', { exact: true })
  const providerSelect = provider.locator('xpath=ancestor::div[contains(@class,"ant-select")]')
  const typeSelect = type.locator('xpath=ancestor::div[contains(@class,"ant-select")]')
  await providerSelect.click()
  await expect(
    page.locator(
      '.ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)',
    ),
  ).toHaveText(['ComfyUI引擎', 'OpenAI 兼容文本服务', 'Ollama 文本服务'])
  await expect(
    page.locator('.ant-select-dropdown:visible .ant-select-item-option[aria-label="Mock 模拟服务"]'),
  ).toHaveCount(0)
  await provider.press('Escape')
  await drawer.getByLabel('名称', { exact: true }).fill('真实文本元数据')
  await providerSelect.click()
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: 'OpenAI' })
    .click()
  await expect(type).toHaveValue('image')
  await drawer.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(type).toHaveAttribute('aria-invalid', 'true')
  expect(writes).toEqual([])
  await typeSelect.click()
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: '文本生成' })
    .click()
  await providerSelect.click()
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: 'Ollama' })
    .click()
  await expect(type).toHaveValue('text')
  await drawer.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(drawer).toBeHidden()
  expect(writes).toEqual([
    {
      name: '真实文本元数据',
      description: '',
      provider: 'OLLAMA',
      type: 'text',
      mapping: {},
      status: 'DRAFT',
    },
  ])
  expect(requests.filter((path) => /^\/api\/(providers|llm|comfyui|ai-services)/.test(path))).toEqual([])
})

test('real historical unsupported provider and type survive metadata-only edits', async ({ page }) => {
  const workflow = {
    id: 'legacy',
    name: '历史配置',
    provider: 'retired',
    type: 'old-kind',
    description: '',
    version: '1',
    mapping: { prompt: 'old.node' },
    history: [],
    active: false,
  }
  await auth(page, ['workspace.read', 'workflows.read', 'workflows.update'], {
    ...baseWorkspace,
    workflows: [workflow],
    providerRegistry: [],
  })
  const writes: unknown[] = []
  await page.route('**/api/workflows/legacy', async (route) => {
    if (route.request().method() === 'PATCH') writes.push(route.request().postDataJSON())
    await route.fulfill({ json: { data: { ...workflow, versions: [] } } })
  })
  await page.goto('/workflows')
  await page.getByRole('button', { name: '编辑 / 版本' }).click()
  const drawer = page.locator('.ant-drawer-content').filter({ hasText: '工作流元数据' })
  await expect(drawer.getByLabel('工作流类型', { exact: true })).toHaveValue('old-kind')
  await expect(drawer.getByLabel('工作流提供方', { exact: true })).toHaveValue('retired')
  await expect(drawer.getByRole('status')).toContainText('已原样保留')
  await drawer.getByLabel('描述', { exact: true }).fill('历史说明')
  await drawer.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(drawer).toBeHidden()
  expect(writes).toEqual([
    {
      name: '历史配置',
      description: '历史说明',
      provider: 'retired',
      type: 'old-kind',
      mapping: { prompt: 'old.node' },
      status: 'DRAFT',
    },
  ])
})

test('real missing capabilities explains fallback without Mock or administrative requests', async ({
  page,
}) => {
  await auth(page, ['workspace.read', 'workflows.read', 'workflows.create'])
  await page.goto('/workflows')
  await page.getByRole('button', { name: '创建工作流', exact: true }).click()
  const drawer = page.locator('.ant-drawer-content').filter({ hasText: '工作流元数据' })
  await expect(drawer.getByText(/未获得能力注册信息/)).toBeVisible()
  const providerSelect = drawer
    .getByLabel('工作流提供方', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"ant-select")]')
  await providerSelect.click()
  await expect(
    page.locator(
      '.ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)',
    ),
  ).toHaveText(['ComfyUI引擎', 'OpenAI 兼容文本服务', 'Ollama 文本服务'])
})

test('real asset preview uses authorized blob content and never workspace URL', async ({ page }) => {
  const workspace = {
    ...baseWorkspace,
    assets: [
      {
        id: 'asset-1',
        name: '安全文本资产',
        type: '文章' as const,
        taskId: '',
        executionId: undefined,
        createdAt: '2026-09-23T00:00:00Z',
        url: 'https://untrusted.example/asset.txt',
        cover: '',
        tags: [],
        model: '',
        content: undefined,
      },
    ],
  }
  await auth(page, ['workspace.read', 'assets.read'], workspace)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.route('**/api/assets/asset-1/content', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'authorized blob payload',
    }),
  )
  await page.goto('/assets')
  await page.getByRole('button', { name: '预览 安全文本资产' }).click()
  await expect(page.getByText('authorized blob payload', { exact: true })).toBeVisible()
  expect(requests.some((url) => url === 'https://untrusted.example/asset.txt')).toBe(false)
})

test('real workflow snapshots use existing PATCH contract instead of missing versions endpoints', async ({
  page,
}) => {
  const workflow = {
    id: 'workflow-1',
    name: '后端工作流',
    description: '',
    provider: 'COMFYUI',
    type: 'image',
    instanceId: null,
    status: 'DRAFT',
    version: '1',
    mapping: {},
    history: [],
  }
  const snapshot = {
    id: 'revision-1',
    workflowId: 'workflow-1',
    version: '1',
    createdAt: '2026-09-23T00:00:00Z',
    workflowJson: null,
    apiWorkflowJson: { node: { class_type: 'TestNode', inputs: { text: '' } } },
    mapping: { prompt: 'node.inputs.text' },
    metadata: {},
  }
  await auth(page, ['workspace.read', 'workflows.read', 'workflows.update'], {
    ...baseWorkspace,
    workflows: [workflow],
  })
  const methods: string[] = []
  const paths: string[] = []
  const writes: Record<string, unknown>[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/workflows/')) paths.push(new URL(request.url()).pathname)
  })
  let status = 'DRAFT'
  let versions = [snapshot]
  await page.route('**/api/workflows/workflow-1', async (route) => {
    methods.push(route.request().method())
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      writes.push(body)
      status = body.status
      const previous = versions[versions.length - 1]!
      versions = [
        ...versions,
        { ...previous, ...body, id: `revision-${versions.length + 1}`, version: String(versions.length + 1) },
      ]
      await route.fulfill({ json: { data: workflow } })
      return
    }
    await route.fulfill({
      json: { data: { ...workflow, status, version: String(versions.length), versions } },
    })
  })
  await page.goto('/workflows')
  await page.getByRole('button', { name: '导入工作流版本', exact: true }).click()
  const drawer = page.locator('.ant-drawer-content')
  await drawer
    .getByPlaceholder('ComfyUI API Format，不是画布 nodes/links JSON')
    .fill(JSON.stringify(snapshot.apiWorkflowJson))
  await drawer
    .getByPlaceholder('{"prompt":"实际节点.inputs.text"}', { exact: true })
    .fill(JSON.stringify(snapshot.mapping))
  await drawer.getByRole('button', { name: '保存不可变版本' }).click()
  await expect(page.locator('.revision').filter({ hasText: 'V2' })).toBeVisible()
  await page
    .locator('.revision')
    .filter({ hasText: 'V2' })
    .getByRole('button', { name: '激活', exact: true })
    .click()
  await expect(
    page.locator('.revision').filter({ hasText: 'V3' }).getByText('Active', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.locator('.revision').filter({ hasText: 'V3' }).getByText('Active', { exact: true }),
  ).toBeVisible()
  await page
    .locator('.revision')
    .filter({ hasText: 'V3' })
    .getByRole('button', { name: '停用', exact: true })
    .click()
  await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
  expect(writes[0]).toEqual({
    apiWorkflowJson: snapshot.apiWorkflowJson,
    workflowJson: {},
    mapping: snapshot.mapping,
    status: 'DRAFT',
  })
  expect(writes[1]).toMatchObject({ status: 'ACTIVE', apiWorkflowJson: snapshot.apiWorkflowJson })
  expect(writes[2]).toEqual({ status: 'DRAFT' })
  expect(methods).toContain('PATCH')
  expect(methods).not.toContain('POST')
  expect(paths.every((path) => path === '/api/workflows/workflow-1')).toBe(true)
})

test('flat auth contract forces password change, sends bearer, and returns to login', async ({ page }) => {
  await auth(page, ['workspace.read'])
  const calls: { path: string; auth?: string; body: unknown }[] = []
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ json: { data: { accessToken: 'login-token', forceChangePassword: true } } }),
  )
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        data: {
          id: 'u1',
          username: 'operator',
          role: 'CUSTOM',
          permissions: ['workspace.read'],
          forceChangePassword: true,
        },
      },
    }),
  )
  await page.route('**/api/auth/change-password', (route) => {
    calls.push({
      path: new URL(route.request().url()).pathname,
      auth: route.request().headers().authorization,
      body: route.request().postDataJSON(),
    })
    return route.fulfill({ json: { data: { loginRequired: true } } })
  })
  await page.goto('/login')
  await page.getByLabel('用户名').fill('operator')
  await page.getByLabel('密码', { exact: true }).fill('old-password')
  await page.getByRole('button', { name: '提交', exact: true }).click()
  await expect(page).toHaveURL(/change-password/)
  await page.getByLabel('当前密码').fill('old-password')
  await page.getByLabel('新密码').fill('new-password-123')
  await page.getByRole('button', { name: '提交', exact: true }).click()
  await expect(page).toHaveURL(/login/)
  expect(calls).toEqual([
    {
      path: '/api/auth/change-password',
      auth: 'Bearer login-token',
      body: { oldPassword: 'old-password', newPassword: 'new-password-123' },
    },
  ])
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
    'login-token',
  )
})

test('guest uses public endpoint rather than fabricated guest permissions', async ({ page }) => {
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'No session' } } }),
  )
  await page.route('**/api/public', (route) => route.fulfill({ json: { data: { tasks: [], assets: [] } } }))
  await page.goto('/')
  await expect(page).toHaveURL(/public/)
  await expect(page.getByRole('heading', { name: '公开内容' })).toBeVisible()
  await page.goto('/users')
  await expect(page).toHaveURL(/login/)
})

test('fetch SSE handles UTF-8 split frames and rejects JSON responses', async ({ page }) => {
  await page.goto('/login')
  const result = await page.evaluate(async () => {
    const path = '/src/api/stream.ts'
    const { readEventStream } = await import(/* @vite-ignore */ path)
    const original = window.fetch
    const events: unknown[] = []
    const bytes = new TextEncoder().encode(
      'event: delta\r\ndata: 中文\r\ndata: 第二行\r\n\r\nevent: done\ndata: {"id":"execution-1","status":"SUCCESS"}\n\n',
    )
    window.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    try {
      await readEventStream(
        '/api/llm/generate/stream',
        (event: unknown) => events.push(event),
        new AbortController().signal,
      )
      window.fetch = async () =>
        new Response('{"data":{}}', { headers: { 'Content-Type': 'application/json' } })
      let error = ''
      try {
        await readEventStream('/api/llm/generate/stream', () => {}, new AbortController().signal)
      } catch (cause) {
        error = String(cause)
      }
      return { events, error }
    } finally {
      window.fetch = original
    }
  })
  expect(result.events).toEqual([
    { event: 'delta', data: '中文\n第二行', id: undefined },
    { event: 'done', data: '{"id":"execution-1","status":"SUCCESS"}', id: undefined },
  ])
  expect(result.error).toContain('后端未返回 SSE')
})

import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TaskReviewPreview from '../../src/components/TaskReviewPreview.vue'
import { useFactoryStore } from '../../src/stores/factory'
import { createMockApi } from '../../src/services/mock'
import { assetBlob, clearToken, setToken } from '../../src/api/session'

afterEach(() => {
  vi.unstubAllGlobals()
  clearToken()
})

describe('saved review material', () => {
  it('uses the full persisted linked article, escapes HTML, and invalidates changed reviews', async () => {
    const data = new Map<string, string>()
    let time = Date.now()
    const api = createMockApi({
      storage: {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
          data.set(key, value)
        },
      },
      clock: () => time,
    })
    api.saveSettings({ ...api.getDb().settings, stageDuration: 10 })
    const article = api.createArticle(api.getDb().topics[0]!.id)
    for (let i = 0; i < 15; i++) {
      time += 10
      api.tick()
    }
    const before = api.getDb().tasks.find((t) => t.id === article.taskId)!
    expect(before.status).toBe('REVIEWING')
    expect(before.quality).not.toBeNull()
    article.title = 'Saved full title'
    article.body = `<script>alert(1)</script>\n\n${'Complete paragraph.\n\n'.repeat(300)}END OF ARTICLE`
    api.saveArticle(article)
    const db = api.getDb()
    const task = db.tasks.find((t) => t.id === article.taskId)!
    expect(task.quality).toBeNull()
    expect(task.approved).toBe(false)
    expect(task.status).toBe('WAITING')
    expect(
      db.articles.find((a) => a.id === article.id)?.safety.every((check) => check.status === '待核实'),
    ).toBe(true)
    task.script = 'STALE MOCK SCRIPT MUST NOT APPEAR'
    const pinia = createPinia()
    const store = useFactoryStore(pinia)
    store.db = db
    const app = createSSRApp(TaskReviewPreview, { task, dirty: true })
    app.use(pinia)
    app.component('RouterLink', { template: '<span><slot /></span>' })
    const html = await renderToString(app)
    expect(html).toContain('class="panel review-preview"')
    expect(html).toContain('aria-labelledby="review-heading"')
    expect(html).toContain('id="review-heading"')
    expect(html).toContain(article.title)
    expect(html).toContain('END OF ARTICLE')
    expect(html.match(/Complete paragraph/g)).toHaveLength(300)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('STALE MOCK SCRIPT')
    expect(html).toContain('有未保存修改')
    expect(html).toContain('纯文字文章无需配图')
    store.dispose()
  })
  it('fetches actual asset bytes only through same-origin bearer with redirects rejected', async () => {
    setToken('test-token')
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('actual bytes', { headers: { 'Content-Type': 'video/mp4' } }))
    vi.stubGlobal('fetch', fetcher)
    const blob = await assetBlob('asset/with?special')
    expect(blob.type).toBe('video/mp4')
    expect(await blob.text()).toBe('actual bytes')
    const [path, init] = fetcher.mock.calls[0]!
    expect(path).toBe('/api/assets/asset%2Fwith%3Fspecial/content')
    expect(init.credentials).toBe('same-origin')
    expect(init.redirect).toBe('error')
    expect(init.headers.get('Authorization')).toBe('Bearer test-token')
  })
})

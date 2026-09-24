import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { isReactive } from 'vue'
import { mockApi, STORAGE_KEY } from '../../src/services/mock'
import { MOCK_LATENCY, useFactoryStore } from '../../src/stores/factory'
import type { VideoRequest } from '../../src/types'
import { useAuthStore } from '../../src/stores/auth'

const request: VideoRequest = {
  title: 'Store',
  theme: '异步契约',
  type: '短剧',
  ratio: '9:16',
  duration: 30,
  platform: '抖音',
  style: '写实',
  characters: '',
  modelId: 'minimax-h3',
  workflowId: 'minimax-video-v1',
  scenario: 'normal',
}
let pinia: ReturnType<typeof createPinia>
let data: Map<string, string>
let failWrite: boolean
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(MOCK_LATENCY)
  return promise
}
beforeEach(() => {
  vi.useFakeTimers()
  data = new Map()
  failWrite = false
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrite) throw new Error('quota')
      data.set(key, value)
    },
  })
  mockApi.stop()
  mockApi.reset()
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  disposePinia(pinia)
  mockApi.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Pinia factory 契约', () => {
  it('a denied reviewer cannot mutate demo state through the store action', async () => {
    const store = useFactoryStore()
    await settle(store.init())
    await settle(store.saveSettings({ ...store.db.settings, stageDuration: 1 }))
    const task = await settle(store.createVideo(request))
    await vi.advanceTimersByTimeAsync(3000)
    expect(store.db.tasks[0]?.status).toBe('REVIEWING')
    const can = vi.spyOn(useAuthStore(), 'can').mockReturnValue(false)
    const denied = expect(store.action(task.id, 'approve')).rejects.toThrow('tasks.update')
    await vi.advanceTimersByTimeAsync(MOCK_LATENCY)
    await denied
    expect(mockApi.getDb().tasks[0]?.status).toBe('REVIEWING')
    expect(mockApi.getDb().assets).toHaveLength(0)
    can.mockRestore()
  })
  it('Mock Store 保留实例管理，但拒绝浏览器绕过后端探测、提交和执行 AI', async () => {
    const store = useFactoryStore()
    const instance = await settle(
      store.createComfyInstance({
        id: 'pinia-engine',
        name: 'local',
        baseUrl: 'http://localhost:8188',
        enabled: true,
        connected: true,
      }),
    )
    await settle(store.mockComfyHealth(instance.id, true))
    expect(store.db.comfyInstances?.[0]?.health.simulated).toBe(true)
    const fetcher = vi.fn<typeof fetch>()
    const probe = expect(store.probeComfyHealth(instance.id, fetcher)).rejects.toThrow(/Mock.*禁止/)
    await vi.advanceTimersByTimeAsync(MOCK_LATENCY)
    await probe
    const submit = expect(store.enqueueComfy({
        instanceId: instance.id,
        taskId: 'test-task',
        stageId: 'VIDEO',
        workflowId: 'test-workflow',
        inputs: { prompt: 'hello' },
      })).rejects.toThrow(/Mock.*禁止/)
    await vi.advanceTimersByTimeAsync(MOCK_LATENCY)
    await submit
    const run = expect(store.runComfy('test-job', { fetch: fetcher })).rejects.toThrow(/浏览器执行已关闭/)
    await vi.advanceTimersByTimeAsync(MOCK_LATENCY)
    await run
    expect(fetcher).not.toHaveBeenCalled()
    expect(store.loading).toBe(false)
    expect(store.db.comfyExecutions ?? []).toEqual([])
    await settle(store.deleteComfyInstance(instance.id))
    expect(store.db.comfyInstances).toEqual([])
  })
  it('响应式 db、异步 loading；并发和重复 init 只启动唯一 tick', async () => {
    const store = useFactoryStore()
    expect(isReactive(store.db)).toBe(true)
    expect(store.loading).toBe(false)
    const first = store.init()
    const second = store.init()
    // Pinia 包装 action 的 Promise；判断实际延迟/tick 数量而非 Promise 引用。
    expect(vi.getTimerCount()).toBe(1)
    expect(store.loading).toBe(true)
    await settle(Promise.all([first, second]))
    expect(store.loading).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    await settle(store.init())
    expect(vi.getTimerCount()).toBe(1)
    store.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('所有 CRUD 方法通过 Promise 更新 db', async () => {
    const store = useFactoryStore()
    await settle(store.init())
    const task = await settle(store.createVideo(request))
    expect(store.db.tasks.find((t) => t.id === task.id)).toBeDefined()
    await settle(store.action(task.id, 'pause'))
    await settle(store.saveTask({ ...store.db.tasks[0]!, script: '手工编辑' }))
    expect(store.db.tasks[0]?.script).toBe('手工编辑')
    await settle(store.analyzeTopic('topic-1'))
    expect(store.db.topics[0]?.analyzed).toBe(true)
    const article = await settle(store.createArticle('topic-1'))
    await settle(store.saveArticle({ ...article, body: '新的文章内容' }))
    expect(store.db.articles[0]?.body).toBe('新的文章内容')
    const workflow = store.db.workflows[0]!
    await settle(store.saveWorkflow({ ...workflow, description: '更新说明' }))
    expect(store.db.workflows[0]?.description).toBe('更新说明')
    await settle(store.saveSettings({ ...store.db.settings, threshold: 80 }))
    expect(store.db.settings.threshold).toBe(80)
    await settle(store.toggleModel('flux-pro'))
    expect(store.db.models.find((m) => m.id === 'flux-pro')?.enabled).toBe(false)
    await settle(store.refresh())
    expect(store.error).toBe('')
  })
  it('tick 自动更新 db，批准及删除资产都持久化', async () => {
    const store = useFactoryStore()
    await settle(store.init())
    await settle(store.saveSettings({ ...store.db.settings, stageDuration: 1 }))
    const task = await settle(store.createVideo(request))
    // init 后 interval 每 250ms 触发：首次仅 QUEUED→RUNNING，随后每 tick 一阶段。
    await vi.advanceTimersByTimeAsync(250)
    expect(store.db.tasks[0]?.status).toBe('RUNNING')
    expect(store.db.tasks[0]?.stageIndex).toBe(0)
    for (let index = 1; index < task.stages.length; index++) {
      await vi.advanceTimersByTimeAsync(250)
      expect(store.db.tasks[0]?.stageIndex).toBe(index)
      expect(store.db.tasks[0]?.status).toBe(index === task.stages.length - 1 ? 'REVIEWING' : 'RUNNING')
    }
    expect(store.db.tasks[0]?.status).toBe('REVIEWING')
    await settle(store.action(task.id, 'approve'))
    const assetId = store.db.assets[0]!.id
    await settle(store.deleteAsset(assetId))
    expect(store.db.assets).toHaveLength(3)
    await settle(store.refresh())
    expect(store.db.assets.some((a) => a.id === assetId)).toBe(false)
  })
  it('Promise 拒绝与 error 同时暴露，不以成功返回掩盖持久化异常', async () => {
    const store = useFactoryStore()
    await settle(store.init())
    failWrite = true
    const assertion = expect(store.createVideo(request)).rejects.toThrow('持久化写入失败')
    await vi.advanceTimersByTimeAsync(MOCK_LATENCY)
    await assertion
    expect(store.error).toContain('持久化写入失败')
    expect(store.loading).toBe(false)
    expect(store.db.tasks).toHaveLength(0)
  })
  it('初始化损坏数据不启动 tick、不覆盖本地数据', async () => {
    const store = useFactoryStore()
    data.set(STORAGE_KEY, 'broken')
    const assertion = expect(store.init()).rejects.toThrow('持久化读取失败')
    await vi.advanceTimersByTimeAsync(MOCK_LATENCY)
    await assertion
    expect(store.error).toContain('读取失败')
    expect(data.get(STORAGE_KEY)).toBe('broken')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('后台 tick 出错停止，修复后 refresh 恢复唯一 scheduler 并实际推进', async () => {
    const store = useFactoryStore()
    await settle(store.init())
    await settle(store.createVideo(request))
    failWrite = true
    await vi.advanceTimersByTimeAsync(250)
    expect(store.error).toContain('写入失败')
    expect(vi.getTimerCount()).toBe(0)
    failWrite = false
    await settle(store.refresh())
    expect(vi.getTimerCount()).toBe(1)
    expect(store.error).toBe('')
    await vi.advanceTimersByTimeAsync(250)
    expect(store.db.tasks[0]?.status).toBe('RUNNING')
    await settle(store.refresh())
    expect(vi.getTimerCount()).toBe(1)
  })
  it('初始化进行中 dispose，不泄漏调度器', async () => {
    const store = useFactoryStore()
    const promise = store.init()
    store.dispose()
    await settle(promise)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('loadDemo 异步追加示例且不覆盖用户任务', async () => {
    const store = useFactoryStore()
    await settle(store.init())
    const task = await settle(store.createVideo(request))
    const pending = store.loadDemo()
    expect(store.loading).toBe(true)
    await settle(pending)
    expect(store.db.tasks).toHaveLength(4)
    expect(store.db.tasks.some((t) => t.id === task.id)).toBe(true)
    await settle(store.refresh())
    expect(store.db.tasks).toHaveLength(4)
  })
})

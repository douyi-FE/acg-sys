import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyMapping, ComfyUIAdapter, parseApiWorkflow } from '../../src/providers/comfyui'
import placeholder from '../../workflows/minimax-h3/manifest.json'

const graph = {
  'arbitrary-node': { class_type: 'TestInput', inputs: { text: 'original', seed: 1 } },
  'output-node': { class_type: 'TestOutput', inputs: { source: ['arbitrary-node', 0] } },
}
const mapping = { prompt: 'arbitrary-node.inputs.text', seed: 'arbitrary-node.seed' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.useRealTimers())

describe('ComfyUI mapping', () => {
  it('使用 mapping，不硬编码节点 ID，不修改原图或连线', () => {
    const result = applyMapping(graph, mapping, { prompt: '新提示词', seed: 42 })
    expect(result['arbitrary-node']?.inputs).toEqual({ text: '新提示词', seed: 42 })
    expect(result['output-node']?.inputs.source).toEqual(['arbitrary-node', 0])
    expect(graph['arbitrary-node'].inputs.text).toBe('original')
  })
  it('UI JSON、空图和占位均明确拒绝', () => {
    expect(() => parseApiWorkflow({ nodes: [], links: [] })).toThrow('UI JSON')
    expect(() => parseApiWorkflow({})).toThrow('为空')
    expect(placeholder.executable).toBe(false)
    expect(() => parseApiWorkflow(placeholder.apiWorkflow)).toThrow()
    expect(() => parseApiWorkflow(placeholder)).toThrow()
  })
  it('不存在节点/输入、未映射参数、必填遗漏、重复目标、原型路径均失败', () => {
    expect(() => applyMapping(graph, { prompt: 'missing.text' }, {})).toThrow('不存在')
    expect(() => applyMapping(graph, { prompt: 'arbitrary-node.missing' }, {})).toThrow('不存在')
    expect(() => applyMapping(graph, mapping, { width: 100 })).toThrow('未配置')
    expect(() => applyMapping(graph, mapping, {}, ['prompt'])).toThrow('必需')
    expect(() => applyMapping(graph, { a: 'arbitrary-node.text', b: 'arbitrary-node.inputs.text' }, {})).toThrow('重复')
    expect(() => applyMapping(graph, { a: '__proto__.text' }, {})).toThrow('无效')
    expect(() => applyMapping(graph, mapping, { seed: NaN })).toThrow('JSON')
  })
})

describe('ComfyUI HTTP polling', () => {
  it('POST /prompt，轮询 /history，仅完成后返回 /view 文件并支持下载', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ prompt_id: 'job 1', node_errors: {} }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ 'job 1': { status: { completed: true, status_str: 'success' }, outputs: { result: { videos: [{ filename: '片段 1.mp4', subfolder: 'folder a', type: 'output' }] } } } }))
      .mockResolvedValueOnce(new Response('video bytes'))
    const adapter = new ComfyUIAdapter({ baseUrl: 'http://localhost:8188/', workflow: graph, mapping, fetch: fetcher, pollInterval: 1 })
    const result = await adapter.generate({ prompt: '测试' })
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://localhost:8188/prompt')
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { prompt: typeof graph }
    expect(body.prompt['arbitrary-node'].inputs.text).toBe('测试')
    expect(fetcher.mock.calls[1]?.[0]).toBe('http://localhost:8188/history/job%201')
    const file = result.files[0]!
    expect(new URL(file.url).searchParams.get('filename')).toBe('片段 1.mp4')
    expect(await (await adapter.view(file)).text()).toBe('video bytes')
  })
  it.each([
    [{ error: 'invalid', node_errors: {} }, '/prompt'],
    [{ prompt_id: 'id', node_errors: { '1': { errors: ['bad input'] } } }, '/prompt'],
  ])('提交错误不进入轮询', async (response, message) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(response))
    const adapter = new ComfyUIAdapter({ baseUrl: 'http://localhost:8188', workflow: graph, mapping, fetch: fetcher })
    await expect(adapter.generate({})).rejects.toThrow(String(message))
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('HTTP 错误和执行错误明确上报', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 500))
    const adapter = new ComfyUIAdapter({ baseUrl: 'http://localhost:8188', workflow: graph, mapping, fetch: fetcher })
    await expect(adapter.generate({})).rejects.toThrow('HTTP 500')
    fetcher.mockResolvedValueOnce(json({ prompt_id: 'id' })).mockResolvedValueOnce(json({ id: { status: { completed: false, status_str: 'error' } } }))
    await expect(adapter.generate({})).rejects.toThrow('执行失败')
  })
  it('整体 deadline 中止轮询，不留下 timer', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ prompt_id: 'id' })).mockImplementation(async () => json({}))
    const adapter = new ComfyUIAdapter({ baseUrl: 'http://localhost:8188', workflow: graph, mapping, fetch: fetcher, timeout: 100, pollInterval: 10 })
    const assertion = expect(adapter.generate({})).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(110)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
  it('已取消请求不提交；轮询取消立即退出', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn<typeof fetch>()
    const adapter = new ComfyUIAdapter({ baseUrl: 'http://localhost:8188', workflow: graph, mapping, fetch: fetcher })
    await expect(adapter.generate({}, controller.signal)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    const live = new AbortController()
    fetcher.mockResolvedValueOnce(json({ prompt_id: 'id' })).mockImplementationOnce(async () => { live.abort(); return json({}) })
    await expect(adapter.generate({}, live.signal)).rejects.toThrow()
  })
})

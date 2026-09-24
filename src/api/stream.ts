import { sessionFetch } from './session'

export interface ServerEvent { event: string; data: string; id?: string }
/** POST + fetch SSE，支持 UTF-8 分片、多行 data 和取消；断流不伪造完成事件。 */
export async function generateStream(body: object, onEvent: (event: ServerEvent) => void, signal: AbortSignal) {
  return readEventStream('/api/llm/generate/stream', onEvent, signal, body)
}
export async function readEventStream(path: string, onEvent: (event: ServerEvent) => void, signal: AbortSignal, body?: object) {
  const response = await sessionFetch(path, {
    method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Accept: 'text/event-stream' },
    body: body ? JSON.stringify(body) : undefined, signal,
  })
  if (!response.ok) throw new Error(`流式生成失败：HTTP ${response.status}`)
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new Error('后端未返回 SSE，不能将普通 JSON 伪装为流式成功')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const dispatch = (frame: string) => {
    let event = 'message'; let id: string | undefined
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'event') event = value
      if (field === 'id') id = value
      if (field === 'data') data.push(value)
    }
    if (data.length) onEvent({ event, data: data.join('\n'), id })
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      // 保留末尾 CR，避免 CRLF 跨网络分片时被拆成两个换行。
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        dispatch(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2)
      }
      if (buffer.length > 1_000_000) throw new Error('SSE 事件超过允许大小')
      if (done) break
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}

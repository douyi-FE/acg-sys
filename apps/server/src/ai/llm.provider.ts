import { AiError, AiTransport, type Endpoint } from './transport'
import { record } from './mapping'

function content(item: Record<string, unknown>, ollama: boolean, stream = false): unknown {
  const choice: unknown = Array.isArray(item.choices) ? item.choices[0] : undefined
  const message = ollama ? item.message : record(choice) ? choice[stream ? 'delta' : 'message'] : undefined
  return record(message) ? message.content : undefined
}

export class LlmProvider {
  constructor(private readonly transport: AiTransport) {}
  async generate(service: Endpoint & { kind: string }, model: string, input: unknown, signal: AbortSignal, delta?: (text: string) => Promise<void>) {
    if (!record(input)) throw new AiError('INVALID_INPUT')
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 100_000) throw new AiError('INVALID_PROMPT')
    if (input.mode !== undefined && input.mode !== 'ordinary' && input.mode !== 'json') throw new AiError('INVALID_MODE')
    const ollama = service.kind === 'OLLAMA'
    const path = ollama ? '/api/chat' : '/chat/completions'
    // OpenAI baseUrl is the API root, typically https://host/v1.
    const body = { model, messages: [{ role: 'user', content: input.prompt }], stream: !!delta,
      ...(input.mode === 'json' ? ollama ? { format: 'json' } : { response_format: { type: 'json_object' } } : {}) }
    let text = ''
    const append = async (chunk: unknown) => {
      if (typeof chunk !== 'string') return
      text += chunk
      if (text.length > 4_000_000) throw new AiError('OUTPUT_TOO_LARGE')
      await delta?.(chunk)
    }
    if (!delta) {
      const data = await this.transport.request(service, path, { body, signal, timeout: 180_000 })
      await append(content(data, ollama))
    } else {
      await this.transport.request(service, path, { body, signal, timeout: 180_000, consume: async response => {
        if (!response.body) throw new AiError('EMPTY_RESPONSE')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = '', complete = false
        const line = async (value: string) => {
          value = value.trim()
          if (!value || value.startsWith(':')) return
          if (!ollama) {
            if (!value.startsWith('data:')) return
            value = value.slice(5).trim()
            if (value === '[DONE]') { complete = true; return }
          }
          const item: unknown = JSON.parse(value)
          if (!record(item)) throw new AiError('INVALID_STREAM_FRAME')
          if (item.error) throw new AiError('PROVIDER_STREAM_ERROR')
          await append(content(item, ollama, true))
          if (ollama && item.done) complete = true
        }
        try {
          while (!complete) {
            const { value, done } = await reader.read()
            if (done) { buffer += decoder.decode(); if (buffer.trim()) await line(buffer); break }
            buffer += decoder.decode(value, { stream: true })
            if (buffer.length > 1_000_000) throw new AiError('STREAM_FRAME_TOO_LARGE')
            let pos: number
            while ((pos = buffer.indexOf('\n')) >= 0) {
              const current = buffer.slice(0, pos); buffer = buffer.slice(pos + 1); await line(current)
            }
          }
          if (!complete) throw new AiError('TRUNCATED_STREAM')
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      } })
    }
    if (!text) throw new AiError('EMPTY_GENERATION')
    let result: unknown = text
    if (input.mode === 'json') {
      try { result = JSON.parse(text) } catch { throw new AiError('INVALID_JSON_OUTPUT') }
    }
    return { text, result }
  }
}

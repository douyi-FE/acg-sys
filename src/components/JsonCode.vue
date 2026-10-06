<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ value: unknown }>()
type Token = { text: string; kind: 'plain' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' }

const source = computed(() => {
  if (typeof props.value !== 'string') return JSON.stringify(props.value, null, 2) || '暂无'
  if (!props.value.trim()) return '暂无'
  try {
    return JSON.stringify(JSON.parse(props.value), null, 2)
  } catch {
    return props.value
  }
})

function tokenize(value: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < value.length) {
    const character = value[index]!
    if (character === '"') {
      let end = index + 1
      let escaped = false
      while (end < value.length) {
        const current = value[end]!
        if (current === '"' && !escaped) {
          end++
          break
        }
        escaped = current === '\\' && !escaped
        if (current !== '\\') escaped = false
        end++
      }
      tokens.push({ text: value.slice(index, end), kind: 'string' })
      index = end
      continue
    }
    if ('{}[],:'.includes(character)) {
      tokens.push({ text: character, kind: 'punctuation' })
      index++
      continue
    }
    const match = value.slice(index).match(/^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/)
    if (match) {
      const text = match[0]!
      tokens.push({
        text,
        kind: text === 'null' ? 'null' : text === 'true' || text === 'false' ? 'boolean' : 'number',
      })
      index += text.length
      continue
    }
    let end = index + 1
    while (end < value.length && !'"{}[],:'.includes(value[end]!)) end++
    tokens.push({ text: value.slice(index, end), kind: 'plain' })
    index = end
  }
  return tokens
}

const tokens = computed(() => tokenize(source.value))
</script>

<template>
  <pre class="json-code"><code><span
    v-for="(token, index) in tokens"
    :key="index"
    class="json-token"
    :class="`json-${token.kind}`"
  >{{ token.text }}</span></code></pre>
</template>

<style scoped>
.json-code {
  max-height: 380px;
  overflow: auto;
  margin: 0;
  padding: 16px;
  border: 1px solid #292943;
  border-radius: 10px;
  background: #1e1e2e;
  color: #e7e7f2;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
  font: 12px/1.75 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  tab-size: 2;
}
.json-string { color: #a6e3a1; }
.json-number { color: #fab387; }
.json-boolean { color: #89b4fa; }
.json-null { color: #f38ba8; }
.json-punctuation { color: #cba6f7; }
</style>

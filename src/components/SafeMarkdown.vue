<script setup lang="ts">
import MarkdownIt, { type Token } from 'markdown-it'
import { computed, h, type VNode } from 'vue'

const props = withDefaults(defineProps<{ source: string; title?: string }>(), { title: '' })
const markdown = new MarkdownIt({ html: false, linkify: false })
// No HTML strings, token attributes or arbitrary tag names reach the DOM.
// Vue escapes text; only these URL schemes are navigable. Images never load here.
function safeUrl(value: string) {
  const url = value.trim()
  if (!url || [...url].some(char => char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f || char === '\\')) return ''
  try {
    const parsed = new URL(url, 'https://markdown.invalid/')
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol) ? url : ''
  } catch { return '' }
}

type TreeNode = { token: Token; children: TreeNode[] }
function tree(tokens: Token[]) {
  const roots: TreeNode[] = []
  const stack = [roots]
  for (const token of tokens) {
    if (token.nesting === 1) {
      const node: TreeNode = { token, children: [] }
      stack[stack.length - 1]!.push(node)
      stack.push(node.children)
    } else if (token.nesting === -1) {
      stack.pop()
    } else {
      stack[stack.length - 1]!.push({ token, children: [] })
    }
  }
  return roots
}

function renderNode(node: TreeNode): VNode | VNode[] {
  const token = node.token
  if (token.type === 'inline') return tree(token.children ?? []).flatMap(renderNode)
  if (token.type === 'code_inline') return h('code', token.content)
  if (token.type === 'softbreak') return h('span', '\n')
  if (token.type === 'hardbreak') return h('br')
  if (token.type === 'image') return h('span', { class: 'markdown-image-placeholder' }, `配图未加载：${token.content || '请查看已登记资产'}`)
  if (token.type === 'link_open') {
    const href = safeUrl(String(token.attrGet('href') || ''))
    const external = /^(?:https?:|\/\/)/i.test(href)
    return h(href ? 'a' : 'span', href ? {
      href, target: external ? '_blank' : undefined,
      rel: external ? 'noopener noreferrer' : undefined,
    } : {}, node.children.flatMap(renderNode))
  }
  if (token.type === 'strong_open') return h('strong', node.children.flatMap(renderNode))
  if (token.type === 'em_open') return h('em', node.children.flatMap(renderNode))
  if (token.type === 's_open') return h('s', node.children.flatMap(renderNode))
  if (token.type === 'fence' || token.type === 'code_block') {
    return h('pre', { tabindex: 0, 'aria-label': '代码' }, [h('code', token.content)])
  }
  if (token.type === 'heading_open' && /^h[1-6]$/.test(token.tag)) return h(token.tag, { class: 'markdown-heading' }, node.children.flatMap(renderNode))
  if (token.type === 'paragraph_open') return h('p', node.children.flatMap(renderNode))
  if (token.type === 'blockquote_open') return h('blockquote', node.children.flatMap(renderNode))
  if (token.type === 'bullet_list_open') return h('ul', node.children.flatMap(renderNode))
  if (token.type === 'ordered_list_open') return h('ol', { start: Number(token.attrGet('start') || 1) }, node.children.flatMap(renderNode))
  if (token.type === 'list_item_open') return h('li', node.children.flatMap(renderNode))
  if (token.type === 'table_open') return h('div', {
    class: 'markdown-table-scroll', tabindex: 0, role: 'region', 'aria-label': '表格（可横向滚动）',
  }, [h('table', node.children.flatMap(renderNode))])
  if (token.type === 'thead_open') return h('thead', node.children.flatMap(renderNode))
  if (token.type === 'tbody_open') return h('tbody', node.children.flatMap(renderNode))
  if (token.type === 'tr_open') return h('tr', node.children.flatMap(renderNode))
  if (token.type === 'th_open') return h('th', node.children.flatMap(renderNode))
  if (token.type === 'td_open') return h('td', node.children.flatMap(renderNode))
  if (token.type === 'hr') return h('hr')
  if (token.type === 'text') return h('span', token.content)
  return node.children.flatMap(renderNode)
}

const nodes = computed(() => {
  const tokens = markdown.parse(props.source, {})
  const first = tokens[0]
  const heading = tokens[1]
  const plainTitle = heading?.children?.filter(t => ['text', 'code_inline'].includes(t.type)).map(t => t.content).join('')
  const onlyTitleText = heading?.children?.every(t => [
    'text', 'code_inline', 'strong_open', 'strong_close', 'em_open', 'em_close',
  ].includes(t.type))
  // Only suppress an identical leading H1, in the display tree, never in saved data.
  if (props.title.trim() && first?.type === 'heading_open' && first.tag === 'h1' &&
    onlyTitleText && plainTitle?.trim() === props.title.trim()) tokens.splice(0, 3)
  return tree(tokens).flatMap(renderNode)
})
const Content = () => nodes.value
</script>

<template>
  <div class="safe-markdown" data-testid="safe-markdown">
    <Content />
  </div>
</template>

<style scoped>
.safe-markdown { min-width: 0; max-width: 100%; color: var(--ink, #343545); font-size: 16px; line-height: 1.9; overflow-wrap: anywhere; }
.safe-markdown :deep(.markdown-heading) { color: #202232; line-height: 1.35; margin: 2em 0 .7em; letter-spacing: -.02em; }
.safe-markdown :deep(h1) { font-size: 1.8em; }.safe-markdown :deep(h2) { font-size: 1.45em; }.safe-markdown :deep(h3) { font-size: 1.2em; }
.safe-markdown :deep(p) { margin: 0 0 1.15em; }.safe-markdown :deep(ul),.safe-markdown :deep(ol) { padding-left: 1.5em; margin: 0 0 1.15em; }
.safe-markdown :deep(li > p) { margin-bottom: .35em; }
.safe-markdown :deep([tabindex]:focus-visible) { outline: 2px solid var(--primary, #635bdb); outline-offset: 3px; }
.safe-markdown :deep(blockquote) { border-left: 3px solid #d8d5f5; color: #676879; margin: 1.4em 0; padding: .2em 1em; }
.safe-markdown :deep(code) { background: #f3f2f8; border-radius: 4px; padding: .12em .35em; font: .9em ui-monospace,SFMono-Regular,Menlo,monospace; }
.safe-markdown :deep(pre) { max-width: 100%; white-space: pre; overflow-wrap: normal; background: #252535; border-radius: 10px; color: #f2f1ff; margin: 1.25em 0; overflow-x: auto; padding: 16px; }
.safe-markdown :deep(pre code) { background: none; padding: 0; }.safe-markdown :deep(a) { color: #5d55c9; text-decoration: underline; }
.safe-markdown :deep(.markdown-table-scroll) { max-width: 100%; overflow-x: auto; margin: 1.25em 0; }
.safe-markdown :deep(table) { border-collapse: collapse; min-width: 100%; text-align: left; }
.safe-markdown :deep(th),.safe-markdown :deep(td) { border: 1px solid #e4e3ec; padding: 9px 12px; white-space: nowrap; }
.safe-markdown :deep(th) { background: #f7f6fb; font-weight: 650; }.safe-markdown :deep(hr) { border: 0; border-top: 1px solid #e8e7ef; margin: 2em 0; }
.safe-markdown :deep(.markdown-image-placeholder) { background: #f2f1f6; border-radius: 5px; color: #777889; padding: 2px 7px; font-size: .85em; }
</style>

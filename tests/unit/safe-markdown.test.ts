import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import SafeMarkdown from '../../src/components/SafeMarkdown.vue'

const render = (source: string, title?: string) => renderToString(createSSRApp(SafeMarkdown, { source, title }))

describe('SafeMarkdown Vue token renderer', () => {
  it('renders semantic blocks, nested inline formatting, tables, and literal code', async () => {
    const html = await render('# Title\n\n## Section\n\nA **bold _nested_** paragraph with `code`.\n\n- Item\n- Second\n\n3. Third\n\n> Quote\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n---')
    for (const tag of ['h1', 'h2', 'p', 'strong', 'em', 'code', 'ul', 'li', 'ol', 'blockquote', 'table', 'thead', 'tbody', 'th', 'td', 'pre', 'hr']) {
      expect(html).toMatch(new RegExp(`<${tag}(?:\\s|>)`))
    }
    expect(html).toContain('start="3"')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
    expect(html).toContain('<strong>')
    expect(html).not.toContain('**bold')
  })

  it('escapes raw HTML, scripts, event handlers, SVG, iframes, and Vue expressions', async () => {
    const html = await render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<svg onload=alert(1)></svg>\n\n<iframe src="https://tracker.invalid"></iframe>\n\n{{ window.secret }}')
    expect(html).not.toMatch(/<(script|img|svg|iframe)\b/)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('{{ window.secret }}')
  })

  it.each(['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'data:text/html,evil', 'vbscript:evil', 'file:///etc/passwd', 'blob:https://site.invalid/secret'])('does not allow dangerous link %s', async url => {
    const html = await render(`[unsafe](${url})`)
    expect(html).not.toContain('href=')
  })

  it('never fetches inline or reference tracking images, including data images', async () => {
    const html = await render('![Tracking](https://tracker.invalid/pixel)\n\n![Reference][pixel]\n\n[pixel]: /api/assets/secret/content\n\n![Inline](data:image/png;base64,AAAA)')
    expect(html).not.toMatch(/<(img|video|audio|source)\b/)
    expect(html).not.toContain('src=')
    expect(html).toContain('配图未加载')
  })

  it('handles external, protocol-relative, relative, anchor, and email links safely', async () => {
    const html = await render('[external **bold**](https://example.com) [cdn](//example.com) [local](/tasks/1) [relative](./other) [anchor](#section) [mail](mailto:test@example.com)')
    expect(html.match(/target="_blank"/g)).toHaveLength(2)
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2)
    expect(html).toContain('href="/tasks/1"')
    expect(html).toContain('href="./other"')
    expect(html).toContain('href="#section"')
    expect(html).toContain('href="mailto:test@example.com"')
    expect(html).toContain('<strong>')
  })

  it('only suppresses a matching leading H1 without modifying the source', async () => {
    const source = '# **Title**\n\n## Title\n\nEnd'
    const html = await render(source, 'Title')
    expect(html).not.toContain('<h1')
    expect(html).toContain('<h2')
    expect(source).toBe('# **Title**\n\n## Title\n\nEnd')
    expect(await render('# Different\n\nEnd', 'Title')).toContain('<h1')
    expect(await render('Paragraph\n\n# Title', 'Title')).toContain('<h1')
  })
})

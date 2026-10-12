import { describe, expect, it } from 'vitest'
import type { Nodes } from 'mdast'
import { parseHref } from '../data/links'
import { analyzePage, serializeMarkdown } from './index'
import { parseTopLevel } from './mdast'
import { prng, randomDoc } from './testing/randomDoc'

function toString(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'inlineMath') return node.value
  if ('children' in node) return node.children.map((c) => toString(c as Nodes)).join('')
  return ''
}

/** Reference implementation: links and headings from the full micromark parse. */
function fromMdast(body: string): { links: Set<string>; headings: string[] } {
  const links = new Set<string>()
  const headings: string[] = []
  const visit = (node: Nodes): void => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
      if (node.url.startsWith('/') && !node.url.startsWith('//')) {
        const parsed = parseHref(node.url)
        if (parsed) links.add(parsed.path)
      }
    }
    if (node.type === 'heading') headings.push(toString(node).trim())
    if ('children' in node) for (const c of node.children) visit(c as Nodes)
  }
  for (const { node } of parseTopLevel(body)) visit(node)
  return { links, headings }
}

const PAGE = `---
id: 01JA8Z3K5N6P7Q8R9S0T1V2W3X
icon: "📝"
title: "a/b"
---
# 專案 **A** 概覽

開頭段落，連到[會議](/工作/會議記錄.md#決議)和[外部](https://example.com)與[相對](other.md)。

[專案 A](/工作/專案%20A.md)

![圖](/_assets/2026/10/3f9a2c1b.png)

- 清單項目 [再次](/工作/會議記錄.md)
- [ ] 待辦

> [!NOTE]
> 提示內容

<details>
<summary>收合 &amp; 標題</summary>

隱藏內容

</details>

## 第二節

| 欄 | 值 |
| --- | --- |
| a | [表格連結](/表格.md) |

\`\`\`js
const notALink = '[x](/code.md)'
\`\`\`

\`[y](/inline-code.md)\` 與 $[z](/math.md)$

<div><a href="/html.md">html</a></div>

[參考][r]

[r]: /參考/頁.md

#### 四級標題
`

describe('analyzePage', () => {
  const a = analyzePage(PAGE)

  it('reads the frontmatter meta', () => {
    expect(a.meta).toEqual({ id: '01JA8Z3K5N6P7Q8R9S0T1V2W3X', title: 'a/b', icon: '📝', cover: null, created: null })
  })

  it('lists root-relative link targets, decoded, deduplicated, without fragments', () => {
    // Link syntax inside code and math is counted too (a superset is the safe side for DATA-17
    // rewrites); HTML, external and relative links are not.
    expect(a.links).toEqual([
      '工作/會議記錄.md',
      '工作/專案 A.md',
      '_assets/2026/10/3f9a2c1b.png',
      '表格.md',
      'code.md',
      'inline-code.md',
      'math.md',
      '參考/頁.md',
    ])
  })

  it('lists heading texts in order, without syntax', () => {
    expect(a.headings).toEqual(['專案 A 概覽', '第二節', '四級標題'])
  })

  it('gives plain text without Markdown syntax', () => {
    expect(a.plainText).toContain('專案 A 概覽\n開頭段落，連到會議和外部與相對。')
    expect(a.plainText).toContain('清單項目 再次')
    expect(a.plainText).toContain('[!NOTE]\n提示內容')
    expect(a.plainText).toContain('收合 & 標題')
    expect(a.plainText).toContain('a 表格連結')
    expect(a.plainText).toContain("const notALink = '[x](/code.md)'")
    expect(a.plainText).toContain('[y](/inline-code.md) 與 z')
    expect(a.plainText).toContain('html\n參考\n四級標題')
    expect(a.plainText).not.toMatch(/\*\*|^#|<details>|\[r\]/m)
  })

  it('gives a one-line excerpt of about 200 characters', () => {
    expect(a.excerpt.startsWith('專案 A 概覽 開頭段落，連到會議和外部與相對。 專案 A 圖')).toBe(true)
    expect(a.excerpt).not.toContain('\n')
    expect(Array.from(a.excerpt).length).toBeLessThanOrEqual(200)
    const long = analyzePage('字'.repeat(500))
    expect(long.excerpt).toBe('字'.repeat(200))
  })

  it('handles files without frontmatter and empty files', () => {
    expect(analyzePage('')).toEqual({
      meta: { id: null, title: null, icon: null, cover: null, created: null },
      links: [],
      headings: [],
      plainText: '',
      excerpt: '',
    })
    expect(analyzePage('# 只有標題\n').headings).toEqual(['只有標題'])
  })

  it('finds every link micromark finds (random Markdown)', () => {
    const snippets = [
      '[a](/x.md)', '![i](</a b.png> "t")', '[b](/p(1).md)', '[c](/esc\\(x.md)', '[d](/amp&amp;.md)', '[e]: /def.md',
      '> [f](/q.md)', '- [g](/l.md#frag)', '| [h](/t.md) |', '`[i](/code.md)`', '```\n[j](/fence.md)\n```', '[k](https://x.com)',
      '<a href="/html.md">x</a>', '[l](rel.md)', '[m]( /space.md )', '[n](\n/next-line.md)', '中文', '**b**', '\n', '\n\n', '- ', '> ',
      '[o][e]', '![p][e]', '[q]:\n/defnext.md', '[^1]: x', '[r](/a%20b.md)', '[s](/%E4%B8%AD.md)',
    ]
    for (let seed = 1; seed <= 400; seed++) {
      const rand = prng(seed)
      let md = ''
      for (let i = 0; i < 12; i++) md += snippets[Math.floor(rand() * snippets.length)] + (rand() < 0.5 ? ' ' : '\n')
      const fast = new Set(analyzePage(md).links)
      for (const link of fromMdast(md).links) expect(fast.has(link), `seed ${seed}: ${link} in ${JSON.stringify(md)}`).toBe(true)
    }
  })

  it('agrees with micromark on Markdown written by the serializer', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const md = serializeMarkdown(randomDoc(seed))
      const fast = analyzePage(md)
      const ref = fromMdast(md)
      for (const link of ref.links) expect(fast.links, `seed ${seed}`).toContain(link)
      // Heading text is an approximation of the plain text; the headings themselves must match.
      expect(fast.headings.length, `seed ${seed}: ${JSON.stringify(md)}`).toBe(ref.headings.length)
    }
  })

  it('is fast enough for thousands of pages', () => {
    const typical = PAGE.replace(/^---[\s\S]*?---\n/, '') + '\n' + '一般的筆記段落，包含**粗體**、[連結](/a.md) 與 `code`。\n\n- 項目一\n- 項目二\n\n'.repeat(10)
    const pages = Array.from({ length: 1000 }, (_, i) => `---\nid: ${i}\n---\n${typical}`)
    const start = performance.now()
    for (const page of pages) analyzePage(page)
    const ms = performance.now() - start
    expect(ms).toBeLessThan(3_000)
  }, 30_000)
})

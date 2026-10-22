import { describe, expect, it } from 'vitest'
import { encodeLinkPath, parseHref, withFragment } from '../data/links'
import { parseMarkdown, rewriteLinks, serializeMarkdown, type LinkRef } from './index'
import { randomDoc } from './testing/randomDoc'

/** DATA-17 move: `工作/會議記錄.md` → `封存/2026 會議.md` (and everything under `工作/會議記錄/`). */
function moveMap(link: LinkRef): { href: string; text?: string } | null {
  const parsed = parseHref(link.href)
  if (!parsed) return null
  let path: string | null = null
  if (parsed.path === '工作/會議記錄.md') path = '封存/2026 會議.md'
  else if (parsed.path.startsWith('工作/會議記錄/')) path = '封存/2026 會議/' + parsed.path.slice('工作/會議記錄/'.length)
  if (path === null) return null
  return { href: withFragment(encodeLinkPath(path), parsed.fragment), text: link.alone && !link.image ? '2026 會議' : undefined }
}

describe('DATA-17 rewriteLinks', () => {
  it('rewrites destinations and the text of page link blocks, nothing else', () => {
    const body = [
      '# 筆記',
      '',
      '[會議記錄](/工作/會議記錄.md)',
      '',
      '見[這裡](/工作/會議記錄.md#決議 "標題")與[別頁](/工作/其他.md)。',
      '',
      '- [子頁](</工作/會議記錄/子 頁.md>)',
      '  > 引用中的[連結](/工作/會議記錄.md)',
      '',
      '| 欄 |',
      '| --- |',
      '| [表格](/工作/會議記錄.md) |',
      '',
      '![圖](/工作/會議記錄/圖.png)',
      '',
      '`[程式碼](/工作/會議記錄.md)`',
      '',
      '```',
      '[區塊程式碼](/工作/會議記錄.md)',
      '```',
      '',
      '<a href="/工作/會議記錄.md">HTML</a>',
      '',
      '$[數學](/工作/會議記錄.md)$',
      '',
      '[參考][r] 與 [r]',
      '',
      '[r]: /工作/會議記錄.md "參考標題"',
      '',
    ].join('\n')
    const expected = [
      '# 筆記',
      '',
      '[2026 會議](/封存/2026%20會議.md)',
      '',
      '見[這裡](/封存/2026%20會議.md#%E6%B1%BA%E8%AD%B0 "標題")與[別頁](/工作/其他.md)。',
      '',
      '- [2026 會議](/封存/2026%20會議/子%20頁.md)',
      '  > 引用中的[連結](/封存/2026%20會議.md)',
      '',
      '| 欄 |',
      '| --- |',
      '| [表格](/封存/2026%20會議.md) |',
      '',
      '![圖](/封存/2026%20會議/圖.png)',
      '',
      '`[程式碼](/工作/會議記錄.md)`',
      '',
      '```',
      '[區塊程式碼](/工作/會議記錄.md)',
      '```',
      '',
      '<a href="/工作/會議記錄.md">HTML</a>',
      '',
      '$[數學](/工作/會議記錄.md)$',
      '',
      '[參考][r] 與 [r]',
      '',
      '[r]: /封存/2026%20會議.md "參考標題"',
      '',
    ].join('\n')
    expect(rewriteLinks(body, moveMap)).toBe(expected)
  })

  it('rewrites the src of an image with a width, keeping every other byte (DATA-19)', () => {
    const body = [
      '<img src="/工作/會議記錄/圖.png" alt="圖" width="300">',
      '',
      "- [ ] <img width='120' alt=\"清單\" src='/工作/會議記錄/b c.png'>",
      '',
      '> <img src="/工作/其他.png" alt="" width="64">',
      '',
      '文字 <img src="/工作/會議記錄/圖.png" alt="" width="64"> 不是圖片區塊',
      '',
      '<div><img src="/工作/會議記錄/圖.png" width="64"></div>',
      '',
    ].join('\n')
    expect(rewriteLinks(body, moveMap)).toBe(
      [
        '<img src="/封存/2026%20會議/圖.png" alt="圖" width="300">',
        '',
        "- [ ] <img width='120' alt=\"清單\" src=\"/封存/2026%20會議/b%20c.png\">",
        '',
        '> <img src="/工作/其他.png" alt="" width="64">',
        '',
        '文字 <img src="/工作/會議記錄/圖.png" alt="" width="64"> 不是圖片區塊',
        '',
        '<div><img src="/工作/會議記錄/圖.png" width="64"></div>',
        '',
      ].join('\n'),
    )
  })

  it('passes what it knows about each link to the map', () => {
    const seen: LinkRef[] = []
    rewriteLinks('[a](/x.md)\n\nb [c *d*](/y.md) ![e](/z.png)\n\n![f](/w.png)\n\n[r]: /def.md\n', (link) => {
      seen.push(link)
      return null
    })
    expect(seen).toEqual([
      { href: '/x.md', text: 'a', alone: true, image: false },
      { href: '/y.md', text: 'c d', alone: false, image: false },
      { href: '/z.png', text: 'e', alone: false, image: true },
      { href: '/w.png', text: 'f', alone: true, image: true },
      { href: '/def.md', text: 'r', alone: false, image: false },
    ])
  })

  it('writes destinations that need it in angle brackets and escapes link text', () => {
    const body = '[舊](/a.md)\n'
    expect(rewriteLinks(body, () => ({ href: '/新 頁 (1).md', text: '新 *頁* [1]' }))).toBe('[新 \\*頁\\* \\[1\\]](</新 頁 (1).md>)\n')
    expect(rewriteLinks(body, () => ({ href: '/b.md' }))).toBe('[舊](/b.md)\n')
    expect(rewriteLinks(body, () => null)).toBe(body)
  })

  it('leaves the text of links that are not alone in their paragraph', () => {
    expect(rewriteLinks('見 [舊](/a.md)\n', () => ({ href: '/b.md', text: '新' }))).toBe('見 [舊](/b.md)\n')
  })

  it('keeps every other byte, including Markdown the editor does not understand', () => {
    const body = '<div>\n[x](/a.md)\n</div>\n\n  * odd   spacing [y](/a.md)\r\nfootnote[^1]\n\n[^1]: [z](/a.md)\n'
    expect(rewriteLinks(body, () => ({ href: '/b.md' }))).toBe(
      '<div>\n[x](/a.md)\n</div>\n\n  * odd   spacing [y](/b.md)\r\nfootnote[^1]\n\n[^1]: [z](/b.md)\n',
    )
  })

  it('rewritten documents still parse to the same blocks', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const md = serializeMarkdown(randomDoc(seed, { maxBlocks: 5 }))
      const out = rewriteLinks(md, (link) => (link.href === '/x.md' ? { href: '/y z.md' } : null))
      const before = parseMarkdown(md)
      const after = parseMarkdown(out)
      expect(after.childCount).toBe(before.childCount)
      if (!md.includes('](/x.md')) expect(out).toBe(md)
    }
  })
})

// @vitest-environment happy-dom
import DOMPurify from 'dompurify'
import { describe, expect, it, vi } from 'vitest'
import { Fragment, Slice } from 'prosemirror-model'
import { schema } from '../lib/schema'
import {
  SANITIZE_CONFIG,
  convertForContext,
  dropNonHttpsImageSrc,
  htmlHasSemantics,
  looksLikeMarkdown,
  sanitizePastedHTML,
  sliceFromText,
} from './paste'
import { outline } from './testUtils'

describe('sanitising pasted HTML (SEC-4)', () => {
  // DOMPurify itself needs a complete DOM (happy-dom's node iterator is not one), so the real
  // sanitising is exercised in the browser harness. Here: the configuration and the hook.
  it('allows only the elements and attributes the schema can use', () => {
    const tags = SANITIZE_CONFIG.ALLOWED_TAGS
    for (const bad of ['script', 'iframe', 'form', 'style', 'svg', 'object', 'embed', 'link', 'meta', 'base', 'math', 'video', 'audio', 'button', 'textarea']) {
      expect(tags, bad).not.toContain(bad)
    }
    for (const good of ['h1', 'ul', 'li', 'strong', 'u', 'pre', 'code', 'table', 'details', 'summary', 'a', 'img']) expect(tags, good).toContain(good)
    expect(SANITIZE_CONFIG.ALLOWED_ATTR.some((a) => a.startsWith('on'))).toBe(false)
    expect(SANITIZE_CONFIG.ALLOWED_ATTR).toEqual(expect.arrayContaining(['data-color', 'data-bg', 'data-checked']))
    expect(SANITIZE_CONFIG.ALLOW_DATA_ATTR).toBe(false)
  })

  it('passes the HTML through DOMPurify with that configuration', () => {
    const spy = vi.spyOn(DOMPurify, 'sanitize').mockReturnValue('clean' as never)
    expect(sanitizePastedHTML('<script>x</script>')).toBe('clean')
    expect(spy).toHaveBeenCalledWith('<script>x</script>', SANITIZE_CONFIG)
    spy.mockRestore()
  })

  it('drops images that are not https', () => {
    const data = (src: string) => ({ attrName: 'src', attrValue: src, keepAttr: true })
    for (const src of ['data:image/png;base64,AAAA', 'blob:http://x/1', 'javascript:alert(1)', '/relative.png', 'http://insecure.example/a.png']) {
      const d = data(src)
      dropNonHttpsImageSrc({ nodeName: 'IMG' }, d)
      expect(d.keepAttr, src).toBe(false)
    }
    const ok = data('https://example.com/a.png')
    dropNonHttpsImageSrc({ nodeName: 'IMG' }, ok)
    expect(ok.keepAttr).toBe(true)
    const other = data('data:text/plain,hi')
    dropNonHttpsImageSrc({ nodeName: 'A' }, other)
    expect(other.keepAttr).toBe(true) // only <img src> is this hook's business
  })
})

describe('Markdown detection', () => {
  it('spots block and inline Markdown', () => {
    for (const md of [
      '# Title', '- item', '1. item', '> quote', '```js\nx\n```', '---', '| a | b |', '- [ ] todo', 'a **bold** b', '[x](/y.md)', '`code`',
      // What the app itself writes (§3.4).
      '<u>底線</u>', '<span data-color="red">紅</span>', '<details>\n<summary>T</summary>\n\n</details>', '&#x20; 縮排', 'a\\*b',
      '![](/_assets/a.png)', '$$\nx\n$$', '[a \\[b\\]](/x.md)',
    ]) {
      expect(looksLikeMarkdown(md), md).toBe(true)
    }
  })
  it('leaves prose alone', () => {
    for (const t of ['just a sentence.', '今天開會，下週再說', 'price: 3 * 4 = 12', 'a-b c-d', '5*3*2', 'C:\\Users\\me', 'R&D: a < b > c', 'x = $5']) {
      expect(looksLikeMarkdown(t), t).toBe(false)
    }
  })
  it('HTML with structure wins over text; plain wrappers do not', () => {
    expect(htmlHasSemantics('<h1>x</h1>')).toBe(true)
    expect(htmlHasSemantics('<div style="color:#fff"><span>x</span></div>')).toBe(false)
  })
})

describe('sliceFromText', () => {
  it('plain text becomes paragraphs, one per line', () => {
    const slice = sliceFromText('one\ntwo\r\nthree')
    expect(outline(schema.topNodeType.create(null, slice.content))).toEqual(['p:one', 'p:two', 'p:three'])
  })

  it('shift-paste keeps one paragraph with line breaks', () => {
    const slice = sliceFromText('# one\ntwo', true)
    expect(slice.content.childCount).toBe(1)
    expect(slice.content.firstChild!.childCount).toBe(3)
  })

  it('parses pasted Markdown into blocks (UI-18)', () => {
    const slice = sliceFromText('# Title\n\n- a\n- b')
    expect(slice.content.firstChild!.type.name).toBe('heading')
    expect(slice.content.lastChild!.type.name).toBe('bullet_list')
  })

  it('falls back to paragraphs when the Markdown parser fails', async () => {
    const markdown = await import('../lib/markdown')
    const spy = vi.spyOn(markdown, 'parseMarkdown').mockImplementation(() => {
      throw new Error('boom')
    })
    try {
      const slice = sliceFromText('# Title\n\n- a\n- b')
      expect(slice.content.childCount).toBeGreaterThan(0)
      expect(slice.content.firstChild!.type.name).toBe('paragraph')
      expect(slice.content.textBetween(0, slice.content.size, ' ')).toContain('Title')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('one line of Markdown pasted into text', () => {
  const p = (text?: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null)
  const inText = schema.topNodeType.create(null, p('hello world')).resolve(3)
  const inEmpty = schema.topNodeType.create(null, p()).resolve(1)
  const inlineOf = (slice: Slice) => {
    expect(slice.openStart).toBe(1)
    expect(slice.content.childCount).toBe(1)
    expect(slice.content.firstChild!.type.name).toBe('paragraph')
    return slice.content.firstChild!
  }

  it('becomes inline content: a page link stays in the sentence', () => {
    const para = inlineOf(sliceFromText('[頁面](/a.md)', false, inText))
    expect(para.textContent).toBe('頁面')
    expect(para.firstChild!.marks.map((m) => [m.type.name, m.attrs.href])).toEqual([['link', '/a.md']])
  })

  it('keeps marks and takes the text of a one-item list or quote', () => {
    expect(inlineOf(sliceFromText('**粗體**', false, inText)).firstChild!.marks.map((m) => m.type.name)).toEqual(['bold'])
    expect(inlineOf(sliceFromText('- 項目', false, inText)).textContent).toBe('項目')
    expect(inlineOf(sliceFromText('> 引用', false, inText)).textContent).toBe('引用')
  })

  it('stays a block on an empty line, and for real blocks', () => {
    expect(sliceFromText('[頁面](/a.md)', false, inEmpty).content.firstChild!.type.name).toBe('page_link')
    expect(sliceFromText('![圖](/_assets/a.png)', false, inText).content.firstChild!.type.name).toBe('image')
    expect(sliceFromText('- a\n- b', false, inText).content.firstChild!.type.name).toBe('bullet_list')
  })

  it('prices stay text, math stays math', () => {
    const slice = sliceFromText('買了 $5 and $6 的東西', false, inEmpty)
    expect(slice.content.firstChild!.type.name).toBe('paragraph')
    expect(slice.content.firstChild!.textContent).toBe('買了 $5 and $6 的東西')
    expect(sliceFromText('$$\nx^2\n$$', false, inEmpty).content.firstChild!.type.name).toBe('raw')
  })
})

describe('callouts pasted into lists (DATA-13)', () => {
  const callout = schema.nodes.callout.create({ kind: 'TIP' }, schema.nodes.paragraph.create(null, schema.text('c')))
  const raw = schema.nodes.raw.create(null, schema.text('<b>'))

  it('become quotes in a nested context', () => {
    const out = convertForContext(Fragment.from([callout, raw]), true)
    expect(out.child(0).type.name).toBe('blockquote')
    expect(out.child(0).textContent).toBe('c')
    expect(out.child(1).type.name).toBe('code_block')
  })

  it('stay callouts at the top level', () => {
    expect(convertForContext(Fragment.from(callout), false).firstChild!.type.name).toBe('callout')
    void Slice
  })
})

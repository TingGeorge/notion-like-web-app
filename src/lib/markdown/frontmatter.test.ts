import { describe, expect, it } from 'vitest'
import { emptyFrontmatter, joinPageFile, readPageId, readPageMeta, splitPageFile } from './frontmatter'

const SPEC_EXAMPLE = `---
id: 01JA8Z3K5N6P7Q8R9S0T1V2W3X
icon: "📝"
cover: "/_assets/2026/10/ab12cd34.jpg"
created: 2026-10-11T10:00:00+08:00
---
Body Markdown…
`

describe('DATA-8 frontmatter', () => {
  it('reads the spec example', () => {
    const { frontmatter, body, hadFrontmatter } = splitPageFile(SPEC_EXAMPLE)
    expect(hadFrontmatter).toBe(true)
    expect(body).toBe('Body Markdown…\n')
    expect(readPageMeta(frontmatter)).toEqual({
      id: '01JA8Z3K5N6P7Q8R9S0T1V2W3X',
      title: null,
      icon: '📝',
      cover: '/_assets/2026/10/ab12cd34.jpg',
      created: '2026-10-11T10:00:00+08:00',
    })
  })

  it('round-trips byte for byte', () => {
    const { frontmatter, body } = splitPageFile(SPEC_EXAMPLE)
    expect(joinPageFile(frontmatter, body)).toBe(SPEC_EXAMPLE)
  })

  it('keeps unknown keys verbatim and in order', () => {
    const text = `---
tags:
- work
- 2026
id: 01JA8Z3K5N6P7Q8R9S0T1V2W3X
# a comment about aliases
aliases: [a, "b"]   # trailing comment
nested:
  deep:
    key: value
---
x
`
    const { frontmatter, body } = splitPageFile(text)
    expect(frontmatter.keys()).toEqual(['tags', 'id', 'aliases', 'nested'])
    expect(frontmatter.get('tags')).toEqual(['work', 2026])
    expect(frontmatter.get('nested')).toEqual({ deep: { key: 'value' } })
    frontmatter.set('id', '01JB00000000000000000000AA')
    frontmatter.set('title', 'a/b "quoted"')
    expect(joinPageFile(frontmatter, body)).toBe(`---
tags:
- work
- 2026
id: 01JB00000000000000000000AA
# a comment about aliases
aliases: [a, "b"]   # trailing comment
nested:
  deep:
    key: value
title: "a/b \\"quoted\\""
---
x
`)
    expect(readPageMeta(splitPageFile(joinPageFile(frontmatter, body)).frontmatter).title).toBe('a/b "quoted"')
  })

  it('treats a file without frontmatter as all body', () => {
    const { frontmatter, body, hadFrontmatter } = splitPageFile('# Hello\n\n---\nnot frontmatter\n')
    expect(hadFrontmatter).toBe(false)
    expect(frontmatter.isEmpty()).toBe(true)
    expect(body).toBe('# Hello\n\n---\nnot frontmatter\n')
  })

  it('treats an unclosed block as body', () => {
    const { hadFrontmatter, body } = splitPageFile('---\nid: x\nno end')
    expect(hadFrontmatter).toBe(false)
    expect(body).toBe('---\nid: x\nno end')
  })

  it('accepts CRLF and a BOM', () => {
    const { frontmatter, body } = splitPageFile('\uFEFF---\r\nid: abc\r\n---\r\nline\r\n')
    expect(frontmatter.getString('id')).toBe('abc')
    expect(body).toBe('line\n')
  })

  it('survives invalid YAML without throwing', () => {
    const { frontmatter } = splitPageFile('---\nid: [unclosed\ntitle: "ok"\n---\n')
    expect(frontmatter.get('id')).toBeUndefined()
    expect(frontmatter.getString('title')).toBe('ok')
  })

  it('keeps the source text of plain numbers', () => {
    const { frontmatter } = splitPageFile('---\ntitle: 1.0\n---\n')
    expect(readPageMeta(frontmatter).title).toBe('1.0')
  })

  it('writes app keys in the documented formats', () => {
    const fm = emptyFrontmatter()
    fm.set('id', '01JA8Z3K5N6P7Q8R9S0T1V2W3X')
    fm.set('title', '專案：A')
    fm.set('icon', '🚀')
    fm.set('cover', 'gradient:3')
    fm.set('created', '2026-10-11T10:00:00+08:00')
    expect(joinPageFile(fm, '')).toBe(`---
id: 01JA8Z3K5N6P7Q8R9S0T1V2W3X
title: "專案：A"
icon: "🚀"
cover: "gradient:3"
created: 2026-10-11T10:00:00+08:00
---
`)
    fm.set('icon', null)
    expect(fm.keys()).toEqual(['id', 'title', 'cover', 'created'])
  })

  it('DATA-10: LF and exactly one trailing newline', () => {
    expect(joinPageFile(emptyFrontmatter(), 'a\n\n\n')).toBe('a\n')
    expect(joinPageFile(emptyFrontmatter(), '')).toBe('')
    expect(joinPageFile(emptyFrontmatter(), 'a\r\nb')).toBe('a\nb\n')
  })

  it('reads the id without parsing the body', () => {
    expect(readPageId(SPEC_EXAMPLE)).toBe('01JA8Z3K5N6P7Q8R9S0T1V2W3X')
    expect(readPageId('no frontmatter')).toBe(null)
  })

  it('supports raw entries for key-by-key merges', () => {
    const fm = splitPageFile('---\na: 1\nb:\n  - x\n---\n').frontmatter
    expect(fm.rawEntry('b')).toBe('b:\n  - x')
    const copy = fm.clone()
    copy.setRawEntry('b', undefined)
    copy.setRawEntry('c', 'c: 3')
    expect(copy.toString()).toBe('a: 1\nc: 3')
    expect(fm.toString()).toBe('a: 1\nb:\n  - x')
  })
})

import { describe, expect, it } from 'vitest'
import { encodeLinkPath, isExternalHref, parseHref } from './links'
import { parseSettings, parseTrashIndex, serializeSettings, serializeTrashIndex } from './notesFiles'

describe('DATA-17 link paths', () => {
  it('percent-encodes only the listed characters', () => {
    expect(encodeLinkPath('工作/專案 A.md')).toBe('/工作/專案%20A.md')
    expect(encodeLinkPath('a%b(c)<d>#e?f[g].md')).toBe('/a%25b%28c%29%3Cd%3E%23e%3Ff%5Bg%5D.md')
    expect(encodeLinkPath('_assets/2026/10/3f9a2c1b.png')).toBe('/_assets/2026/10/3f9a2c1b.png')
  })

  it('decodes root-relative hrefs back to repo paths', () => {
    expect(parseHref('/工作/專案%20A.md')).toEqual({ path: '工作/專案 A.md', fragment: null })
    expect(parseHref('/a%23b.md#heading')).toEqual({ path: 'a#b.md', fragment: 'heading' })
    expect(parseHref('/a.md?x=1')).toEqual({ path: 'a.md', fragment: null })
    expect(parseHref('/100%.md')).toEqual({ path: '100%.md', fragment: null })
  })

  it('round-trips any path', () => {
    for (const p of ['a b/c (1).md', '問題？.md', '[x]#y.md', '100% done.md']) {
      expect(parseHref(encodeLinkPath(p))?.path).toBe(p)
    }
  })

  it('ignores external links and anchors', () => {
    expect(parseHref('https://example.com/a.md')).toBe(null)
    expect(parseHref('mailto:x@y.z')).toBe(null)
    expect(parseHref('//cdn.example.com/x')).toBe(null)
    expect(parseHref('#top')).toBe(null)
    expect(isExternalHref('HTTP://x')).toBe(true)
  })

  it('resolves relative links from existing repos', () => {
    expect(parseHref('b.md', 'docs/a.md')).toEqual({ path: 'docs/b.md', fragment: null })
    expect(parseHref('../c.md', 'docs/sub/a.md')).toEqual({ path: 'docs/c.md', fragment: null })
    expect(parseHref('./x%20y.md', 'a.md')).toEqual({ path: 'x y.md', fragment: null })
    expect(parseHref('b.md')).toBe(null)
  })
})

describe('DATA-21/22 notes files', () => {
  it('parses settings with defaults and keeps unknown keys', () => {
    const { value, ok } = parseSettings('{"favorites":["a",1],"extra":{"x":1}}')
    expect(ok).toBe(true)
    expect(value).toEqual({ version: 1, favorites: ['a'], order: {}, trashRetentionDays: 30, extra: { x: 1 } })
    expect(serializeSettings(value)).toBe(
      '{\n  "version": 1,\n  "favorites": [\n    "a"\n  ],\n  "order": {},\n  "trashRetentionDays": 30,\n  "extra": {\n    "x": 1\n  }\n}\n',
    )
  })

  it('reports invalid JSON', () => {
    expect(parseSettings('{oops').ok).toBe(false)
    expect(parseSettings(null).ok).toBe(true)
  })

  it('round-trips the trash index', () => {
    const text = serializeTrashIndex({
      version: 1,
      entries: [{ id: 'X', title: 'T', originalPath: 'a/T.md', deletedAt: '2026-10-11T00:00:00.000Z', reason: 'deleted' }],
    })
    const { value } = parseTrashIndex(text)
    expect(serializeTrashIndex(value)).toBe(text)
    expect(parseTrashIndex('{"entries":[{"id":1},{"id":"a","originalPath":"p.md","reason":"other"}]}').value.entries).toEqual([
      { id: 'a', title: '', originalPath: 'p.md', deletedAt: '1970-01-01T00:00:00.000Z', reason: 'deleted' },
    ])
  })
})

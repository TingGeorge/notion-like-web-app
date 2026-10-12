import { describe, expect, it } from 'vitest'
import { parseSettings, parseTrashIndex } from '../data/notesFiles'
import { mergeLines, mergePageText, mergeSettingsText, mergeTrashIndexText } from './merge'

describe('SYNC-5 rule 4: three-way line merge', () => {
  const base = '第一段\n\n第二段\n\n第三段\n'

  it('merges changes to different paragraphs', () => {
    const ours = '第一段（這台）\n\n第二段\n\n第三段\n'
    const theirs = '第一段\n\n第二段\n\n第三段（另一台）\n'
    expect(mergeLines(base, ours, theirs)).toBe('第一段（這台）\n\n第二段\n\n第三段（另一台）\n')
  })

  it('reports overlapping changes', () => {
    expect(mergeLines(base, '第一段 A\n\n第二段\n\n第三段\n', '第一段 B\n\n第二段\n\n第三段\n')).toBeNull()
  })

  it('accepts the same change on both sides', () => {
    const both = '第一段\n\n第二段!\n\n第三段\n'
    expect(mergeLines(base, both, both)).toBe(both)
  })

  it('takes one side when the other is unchanged', () => {
    expect(mergeLines(base, base, 'x\n')).toBe('x\n')
    expect(mergeLines(base, 'y\n', base)).toBe('y\n')
  })
})

describe('SYNC-5 rule 4: page merge with frontmatter key by key', () => {
  const base = `---
id: 01JA8Z3K5N6P7Q8R9S0T1V2W3X
icon: "📝"
tags: [a]
---
第一段

第二段
`

  it('merges a frontmatter change with a body change', () => {
    const ours = base.replace('icon: "📝"', 'icon: "🧠"')
    const theirs = base.replace('第二段', '第二段（另一台）')
    expect(mergePageText(base, ours, theirs)).toBe(`---
id: 01JA8Z3K5N6P7Q8R9S0T1V2W3X
icon: "🧠"
tags: [a]
---
第一段

第二段（另一台）
`)
  })

  it('merges different keys and keeps unknown keys verbatim', () => {
    const ours = base.replace('icon: "📝"', 'icon: "🧠"')
    const theirs = base.replace('tags: [a]', 'tags: [a, b]   # kept as is').replace('第一段', '第一段!')
    expect(mergePageText(base, ours, theirs)).toBe(`---
id: 01JA8Z3K5N6P7Q8R9S0T1V2W3X
icon: "🧠"
tags: [a, b]   # kept as is
---
第一段!

第二段
`)
  })

  it('conflicts when both sides change the same key differently', () => {
    expect(mergePageText(base, base.replace('📝', '🧠'), base.replace('📝', '🎯'))).toBeNull()
  })

  it('keeps the remote id when both sides gave an id-less page a new id', () => {
    const plain = '第一段\n'
    const ours = '---\nid: 01AAAAAAAAAAAAAAAAAAAAAAAA\n---\n第一段\n\n這台\n'
    const theirs = '---\nid: 01BBBBBBBBBBBBBBBBBBBBBBBB\n---\n另一台\n\n第一段\n'
    expect(mergePageText(plain, ours, theirs)).toBe('---\nid: 01BBBBBBBBBBBBBBBBBBBBBBBB\n---\n另一台\n\n第一段\n\n這台\n')
  })

  it('adds a key from one side and a body change from the other', () => {
    const plain = 'a\n\nb\n'
    const ours = '---\nid: 01AAAAAAAAAAAAAAAAAAAAAAAA\ncreated: 2026-10-11T10:00:00+08:00\n---\na\n\nb\n'
    expect(mergePageText(plain, ours, 'a\n\nb2\n')).toBe('---\nid: 01AAAAAAAAAAAAAAAAAAAAAAAA\ncreated: 2026-10-11T10:00:00+08:00\n---\na\n\nb2\n')
  })

  it('conflicts on overlapping body lines', () => {
    expect(mergePageText(base, base.replace('第一段', 'A'), base.replace('第一段', 'B'))).toBeNull()
  })
})

describe('SYNC-6a settings.json merge', () => {
  const s = (o: object) => `${JSON.stringify({ version: 1, favorites: [], order: {}, trashRetentionDays: 30, ...o }, null, 2)}\n`

  it('favorites: union minus removals since base', () => {
    const base = s({ favorites: ['a', 'b', 'c'] })
    const ours = s({ favorites: ['a', 'c', 'd'] }) // removed b, added d
    const theirs = s({ favorites: ['a', 'b', 'e'] }) // removed c, added e
    const merged = parseSettings(mergeSettingsText(base, ours, theirs).text).value
    expect(merged.favorites).toEqual(['a', 'd', 'e'])
  })

  it('order: local wins per parent key, remote-only changes are kept', () => {
    const base = s({ order: { root: ['a', 'b'], p1: ['x', 'y'], p2: ['m', 'n'] } })
    const ours = s({ order: { root: ['b', 'a'], p1: ['x', 'y'], p2: ['m', 'n'] } })
    const theirs = s({ order: { root: ['a', 'b', 'c'], p1: ['y', 'x'], p3: ['q'] } })
    const merged = parseSettings(mergeSettingsText(base, ours, theirs).text).value
    expect(merged.order).toEqual({ root: ['b', 'a'], p1: ['y', 'x'], p3: ['q'] })
  })

  it('scalars: local wins when both changed; unknown keys are kept', () => {
    const base = s({ trashRetentionDays: 30, theme: 'x' })
    const ours = s({ trashRetentionDays: 60, theme: 'x' })
    const theirs = s({ trashRetentionDays: 7, theme: 'y', extra: true })
    const merged = parseSettings(mergeSettingsText(base, ours, theirs).text).value
    expect(merged).toMatchObject({ trashRetentionDays: 60, theme: 'y', extra: true })
    const onlyRemote = parseSettings(mergeSettingsText(base, base, theirs).text).value
    expect(onlyRemote.trashRetentionDays).toBe(7)
  })

  it('keeps the local file when the remote JSON does not parse', () => {
    const ours = s({ favorites: ['a'] })
    expect(mergeSettingsText(s({}), ours, '{ nope')).toEqual({ text: ours, remoteInvalid: true })
  })

  it('merges two new files against an empty base', () => {
    const merged = parseSettings(mergeSettingsText(null, s({ favorites: ['a'] }), s({ favorites: ['b'] })).text).value
    expect(merged.favorites).toEqual(['a', 'b'])
  })
})

describe('SYNC-6a trash index merge', () => {
  const entry = (id: string, title = id) => ({ id, title, originalPath: `${title}.md`, deletedAt: '2026-10-01T00:00:00.000Z', reason: 'deleted' })
  const idx = (...entries: object[]) => `${JSON.stringify({ version: 1, entries }, null, 2)}\n`

  it('unions entries by id minus removals on either side', () => {
    const base = idx(entry('A'), entry('B'), entry('C'))
    const ours = idx(entry('A'), entry('C'), entry('D')) // restored B, deleted D
    const theirs = idx(entry('A'), entry('B'), entry('E')) // purged C, deleted E
    const merged = parseTrashIndex(mergeTrashIndexText(base, ours, theirs).text).value
    expect(merged.entries.map((e) => e.id)).toEqual(['A', 'D', 'E'])
  })

  it('keeps the local file when the remote JSON does not parse', () => {
    const ours = idx(entry('A'))
    expect(mergeTrashIndexText(idx(), ours, 'garbage')).toEqual({ text: ours, remoteInvalid: true })
  })
})

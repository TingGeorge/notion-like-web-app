import { describe, expect, it } from 'vitest'
import { SLASH_ITEMS, filterSlashItems, isSlashChar, normalizeQuery, shouldCloseSlash } from './slash'

const ids = (q: string) => filterSlashItems(q).map((i) => i.id)

describe('slash menu items', () => {
  it('has every block of UI-7 in the two sections', () => {
    expect(SLASH_ITEMS.map((i) => i.id)).toEqual([
      'text', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'divider', 'code', 'table',
      'image', 'file', 'link', 'page',
    ])
    expect(SLASH_ITEMS.filter((i) => i.section === 'media').map((i) => i.id)).toEqual(['image', 'file', 'link', 'page'])
  })

  it('shows the Markdown hints of D03', () => {
    const hint = (id: string) => SLASH_ITEMS.find((i) => i.id === id)!.hint
    expect([hint('h1'), hint('h2'), hint('h3'), hint('bullet'), hint('number'), hint('todo'), hint('toggle'), hint('quote'), hint('divider')]).toEqual(
      ['#', '##', '###', '-', '1.', '[]', '>', '"', '---'],
    )
  })
})

describe('filtering', () => {
  it('an empty query shows everything', () => {
    expect(ids('')).toHaveLength(17)
  })

  it('matches every English alias of the spec', () => {
    for (const alias of ['text', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'divider', 'code', 'table', 'image', 'file', 'link', 'page']) {
      expect(ids(alias)).toContain(alias)
    }
    expect(ids('h2')).toEqual(['h2'])
  })

  it('matches the Chinese names', () => {
    expect(ids('標題')).toEqual(['h1', 'h2', 'h3'])
    expect(ids('待辦')).toEqual(['todo'])
    expect(ids('清單')).toEqual(['bullet', 'number', 'todo', 'toggle'])
    expect(ids('分隔')).toEqual(['divider'])
    expect(ids('圖片')).toEqual(['image'])
  })

  it('is case-insensitive', () => {
    expect(ids('TODO')).toEqual(['todo'])
    expect(ids('ToGgLe')).toEqual(['toggle'])
    expect(ids('H1')).toEqual(['h1'])
  })

  it('is width-insensitive: full-width letters and digits match', () => {
    expect(ids('ｔｏｄｏ')).toEqual(['todo'])
    expect(ids('Ｈ１')).toEqual(['h1'])
    expect(ids('ＣＯＤＥ')).toEqual(['code'])
    expect(normalizeQuery('Ｈ１')).toBe('h1')
  })

  it('a prefix of an alias matches', () => {
    expect(ids('tog')).toEqual(['toggle'])
    expect(ids('ca')).toEqual(['callout'])
    expect(ids('zzz')).toEqual([])
  })

  it('accepts / and the full-width ／', () => {
    expect(isSlashChar('/')).toBe(true)
    expect(isSlashChar('／')).toBe(true)
    expect(isSlashChar('\\')).toBe(false)
  })
})

describe('closing (UI-7)', () => {
  it('stays open while something matches', () => {
    expect(shouldCloseSlash('')).toBe(false)
    expect(shouldCloseSlash('h')).toBe(false)
    expect(shouldCloseSlash('todo')).toBe(false)
  })

  it('closes when nothing matched for 3 more characters', () => {
    expect(shouldCloseSlash('z')).toBe(false)
    expect(shouldCloseSlash('zz')).toBe(false)
    expect(shouldCloseSlash('zzz')).toBe(true)
    expect(shouldCloseSlash('hxyz')).toBe(true)
    expect(shouldCloseSlash('hxy')).toBe(false)
  })

  it('closes on a space, also the ideographic one', () => {
    expect(shouldCloseSlash('h ')).toBe(true)
    expect(shouldCloseSlash('h　')).toBe(true)
  })
})

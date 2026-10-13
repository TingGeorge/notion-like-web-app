import { describe, expect, it } from 'vitest'
import {
  childDirOf,
  classifyPath,
  isPagePath,
  isReservedPath,
  isUntitledTitle,
  pagePathFor,
  parentPagePathOf,
  titleOf,
  titleToName,
  truncateUtf8,
  uniqueName,
  utf8Length,
} from './names'
import { isUlid, ulid, ulidTime } from './ulid'

describe('DATA-2 reserved names and page paths', () => {
  it('treats .md files outside reserved folders as pages', () => {
    expect(isPagePath('README.md')).toBe(true)
    expect(isPagePath('工作.md')).toBe(true)
    expect(isPagePath('工作/會議記錄.md')).toBe(true)
    expect(isPagePath('docs/guide.MD')).toBe(true)
  })

  it('ignores non-markdown files and reserved folders', () => {
    expect(isPagePath('image.png')).toBe(false)
    expect(isPagePath('.notes/settings.json')).toBe(false)
    expect(isPagePath('.github/README.md')).toBe(false)
    expect(isPagePath('a/.hidden/b.md')).toBe(false)
    expect(isPagePath('_assets/2026/10/x.md')).toBe(false)
    expect(isReservedPath('_assets/2026/10/3f9a2c1b.png')).toBe(true)
    // `_assets` is reserved only at the root.
    expect(isPagePath('work/_assets/x.md')).toBe(true)
  })

  it('classifies repo paths into file kinds', () => {
    expect(classifyPath('.notes/settings.json')).toBe('meta')
    expect(classifyPath('.notes/trash/index.json')).toBe('meta')
    expect(classifyPath('.notes/trash/01ABC/工作.md')).toBe('trash')
    expect(classifyPath('.notes/trash/01ABC/工作/a.png')).toBe(null)
    expect(classifyPath('.notes/other.json')).toBe(null)
    expect(classifyPath('工作.md')).toBe('page')
    expect(classifyPath('photo.jpg')).toBe(null)
  })
})

describe('DATA-3 page folders', () => {
  it('maps pages to child folders and back', () => {
    expect(childDirOf('工作.md')).toBe('工作')
    expect(childDirOf('工作/專案 A.md')).toBe('工作/專案 A')
    expect(parentPagePathOf('工作/專案 A.md')).toBe('工作.md')
    expect(parentPagePathOf('工作.md')).toBe(null)
  })
})

describe('DATA-4 names from titles', () => {
  it('replaces reserved characters with full-width forms', () => {
    expect(titleToName('a/b\\c:d*e?f"g<h>i|j')).toBe('a／b＼c：d＊e？f＂g＜h＞i｜j')
  })

  it('removes control characters and trims spaces and dots', () => {
    expect(titleToName('  ..hello\u0007 world.. ')).toBe('hello world')
    expect(titleToName('...')).toBe('未命名')
    expect(titleToName('')).toBe('未命名')
    expect(titleToName(' \t ')).toBe('未命名')
  })

  it('keeps Chinese and emoji as they are', () => {
    expect(titleToName('會議記錄 🚀')).toBe('會議記錄 🚀')
  })

  it('truncates to 150 UTF-8 bytes at a character boundary', () => {
    const long = '中'.repeat(60) // 180 bytes
    const name = titleToName(long)
    expect(utf8Length(name)).toBeLessThanOrEqual(150)
    expect(name).toBe('中'.repeat(50))
    // Never splits an emoji sequence.
    const family = '👨‍👩‍👧'
    const t = truncateUtf8('a'.repeat(145) + family, 150)
    expect(t).toBe('a'.repeat(145))
  })

  it('renames a root page called _assets', () => {
    expect(titleToName('_assets', true)).toBe('＿assets')
    expect(titleToName('_assets', false)).toBe('_assets')
  })
})

describe('DATA-5/6 unique names and titles', () => {
  it('adds (2), (3) on case-insensitive NFC clashes', () => {
    expect(uniqueName('Notes', ['notes'])).toBe('Notes (2)')
    expect(uniqueName('Notes', ['notes', 'NOTES (2)'])).toBe('Notes (3)')
    expect(uniqueName('Café', ['Café'])).toBe('Café (2)')
    expect(uniqueName('Other', ['notes'])).toBe('Other')
  })

  it('keeps suffixed names within 150 bytes', () => {
    const base = '中'.repeat(50)
    const name = uniqueName(base, [base])
    expect(name.endsWith(' (2)')).toBe(true)
    expect(utf8Length(name)).toBeLessThanOrEqual(150)
  })

  it('says when the title must go into the frontmatter', () => {
    expect(pagePathFor('會議記錄', '工作', [])).toEqual({
      path: '工作/會議記錄.md',
      name: '會議記錄',
      titleInFrontmatter: false,
    })
    expect(pagePathFor('a/b', '', []).titleInFrontmatter).toBe(true)
    expect(pagePathFor('Notes', '', ['notes'])).toEqual({ path: 'Notes (2).md', name: 'Notes (2)', titleInFrontmatter: true })
  })

  it('reads the title from frontmatter or the file name', () => {
    expect(titleOf('工作/a／b.md', 'a/b')).toBe('a/b')
    expect(titleOf('工作/會議記錄.md', null)).toBe('會議記錄')
  })
})

describe('ULID', () => {
  it('creates sortable 26-character ids', () => {
    const a = ulid(1_700_000_000_000)
    const b = ulid(1_700_000_000_001)
    expect(isUlid(a)).toBe(true)
    expect(a < b).toBe(true)
    expect(ulidTime(a)).toBe(1_700_000_000_000)
    expect(ulid()).not.toBe(ulid())
  })
})

describe('untitled titles in either UI language', () => {
  it('recognises 未命名 and Untitled, numbered or not, and blank titles', () => {
    for (const title of ['未命名', '未命名 (2)', 'Untitled', 'Untitled (12)', '', '  ']) expect(isUntitledTitle(title)).toBe(true)
  })

  it('does not take other titles for untitled', () => {
    for (const title of ['未命名的想法', 'Untitled draft', 'untitled', '未命名(2)', '工作']) expect(isUntitledTitle(title)).toBe(false)
  })
})

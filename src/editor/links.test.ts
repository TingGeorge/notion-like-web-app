import { describe, expect, it } from 'vitest'
import { classifyHref, isSingleUrl, normalizeLinkInput } from './links'

describe('classifyHref (UI-5)', () => {
  it('root-relative .md links are pages', () => {
    expect(classifyHref('/工作/會議記錄.md')).toBe('page')
    expect(classifyHref('/工作/專案%20A.md#intro')).toBe('page')
  })
  it('other root-relative paths are attachments', () => {
    expect(classifyHref('/_assets/2026/10/3f9a2c1b.pdf')).toBe('asset')
  })
  it('http(s) and mailto are external', () => {
    expect(classifyHref('https://example.com')).toBe('external')
    expect(classifyHref('http://example.com')).toBe('external')
    expect(classifyHref('mailto:a@b.co')).toBe('external')
  })
  it('everything else is unsafe', () => {
    expect(classifyHref('javascript:alert(1)')).toBe('unsafe')
    expect(classifyHref('data:text/html,hi')).toBe('unsafe')
    expect(classifyHref('//evil.example/x')).toBe('unsafe')
    expect(classifyHref('relative.md')).toBe('unsafe')
  })
})

describe('normalizeLinkInput', () => {
  it('keeps http(s), mailto and root-relative links', () => {
    expect(normalizeLinkInput(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1')
    expect(normalizeLinkInput('/工作/x.md')).toBe('/工作/x.md')
    expect(normalizeLinkInput('mailto:a@b.co')).toBe('mailto:a@b.co')
  })
  it('adds https:// to bare domains and mailto: to addresses', () => {
    expect(normalizeLinkInput('example.org/x')).toBe('https://example.org/x')
    expect(normalizeLinkInput('www.example.org')).toBe('https://www.example.org')
    expect(normalizeLinkInput('a@b.co')).toBe('mailto:a@b.co')
  })
  it('rejects dangerous or unparsable input', () => {
    expect(normalizeLinkInput('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkInput('data:text/html,x')).toBeNull()
    expect(normalizeLinkInput('//evil.example')).toBeNull()
    expect(normalizeLinkInput('two words')).toBeNull()
    expect(normalizeLinkInput('')).toBeNull()
    expect(normalizeLinkInput('hello')).toBeNull()
  })
})

describe('isSingleUrl', () => {
  it('detects a pasted URL', () => {
    expect(isSingleUrl('https://example.com/a')).toBe(true)
    expect(isSingleUrl(' https://example.com/a\n')).toBe(true)
    expect(isSingleUrl('see https://example.com')).toBe(false)
    expect(isSingleUrl('a b')).toBe(false)
  })
})

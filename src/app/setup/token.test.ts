import { describe, expect, it } from 'vitest'
import { checkToken, defaultExpiry, formatExpiry, isPastDate, isValidIsoDate } from './token'

describe('checkToken (SETUP-4)', () => {
  it('accepts fine-grained tokens and trims whitespace', () => {
    expect(checkToken('  github_pat_11ABC_xyz\n')).toEqual({ kind: 'fine-grained', token: 'github_pat_11ABC_xyz' })
  })
  it('flags classic tokens', () => {
    expect(checkToken('ghp_abcdef')).toEqual({ kind: 'classic', token: 'ghp_abcdef' })
  })
  it('rejects everything else', () => {
    expect(checkToken('hello').kind).toBe('invalid')
    expect(checkToken('gho_abc').kind).toBe('invalid')
    expect(checkToken('github_pat_').kind).toBe('invalid')
    expect(checkToken('github_pat_ab cd').kind).toBe('invalid')
  })
  it('treats blank as empty', () => {
    expect(checkToken('   ').kind).toBe('empty')
  })
})

describe('expiry (SETUP-5)', () => {
  it('defaults to today + 90 days', () => {
    expect(defaultExpiry(new Date(2026, 9, 12))).toBe('2027-01-10')
    expect(defaultExpiry(new Date(2026, 0, 1))).toBe('2026-04-01')
  })
  it('formats for display', () => {
    expect(formatExpiry('2027-01-10')).toBe('2027/01/10')
  })
  it('validates dates', () => {
    expect(isValidIsoDate('2027-02-30')).toBe(false)
    expect(isValidIsoDate('2027-01-10')).toBe(true)
    expect(isValidIsoDate('')).toBe(false)
  })
  it('detects past dates', () => {
    expect(isPastDate('2026-10-11', new Date(2026, 9, 12))).toBe(true)
    expect(isPastDate('2026-10-12', new Date(2026, 9, 12))).toBe(false)
  })
})

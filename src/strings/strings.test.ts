import { describe, expect, it } from 'vitest'
import { en } from './en'
import { zhTW } from './zh-TW'

/** Every leaf string, with its path; functions are called with sample values. */
function leaves(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (typeof value === 'function') {
    const args = Array.from({ length: value.length }, (_, i) => (i === 0 ? 2 : 'x'))
    return leaves(value(...args), path)
  }
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
  return []
}

describe('UI languages (NFR-4)', () => {
  it('English has exactly the keys of 繁體中文', () => {
    expect(leaves(en).map(([k]) => k)).toEqual(leaves(zhTW).map(([k]) => k))
  })

  it('English has no Chinese, except the name of the Chinese language', () => {
    const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/
    const chinese = leaves(en).filter(([k, v]) => cjk.test(v) && k !== 'settings.languageZh')
    expect(chinese).toEqual([])
  })

  it('no string is left empty', () => {
    expect(leaves(en).filter(([, v]) => v.trim() === '')).toEqual([])
  })
})

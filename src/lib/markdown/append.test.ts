import { describe, expect, it } from 'vitest'
import { Fragment } from 'prosemirror-model'
import { schema } from '../schema'
import { appendMarkdown, canonicalize, escapeProseDollars, parseMarkdown, serializeMarkdown } from './index'
import { firstDifference } from './testing/diff'
import { randomDoc } from './testing/randomDoc'

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const SEEDS = Number(env.MD_APPEND_SEEDS ?? 80)

const names = (md: string) => {
  const out: string[] = []
  parseMarkdown(md).forEach((b) => out.push(b.type.name))
  return out
}

describe('appendMarkdown (「移到頁面…」)', () => {
  it('appends after a blank line', () => {
    expect(appendMarkdown('a\n', '# b\n')).toBe('a\n\n# b\n')
    expect(appendMarkdown('', '# b\n')).toBe('# b\n')
    expect(appendMarkdown('a\n\n\n', '')).toBe('a\n')
  })

  it('closes a block left open at the end of the page first', () => {
    expect(appendMarkdown('```js\ncode', '# 移入\n')).toBe('```js\ncode\n```\n\n# 移入\n')
    expect(appendMarkdown('````\nx\n```', 'p\n')).toBe('````\nx\n```\n````\n\np\n')
    expect(appendMarkdown('文字\n\n<!-- 沒有結尾', 'p\n')).toBe('文字\n\n<!-- 沒有結尾\n-->\n\np\n')
    expect(appendMarkdown('$$\nx', 'p\n')).toBe('$$\nx\n$$\n\np\n')
    expect(appendMarkdown('<pre>\nx', 'p\n')).toBe('<pre>\nx\n</pre>\n\np\n')
    expect(names(appendMarkdown('```js\ncode', '# 移入\n'))).toEqual(['code_block', 'heading'])
  })

  it('keeps a moved list its own list after a list with the same marker', () => {
    // After a list the editor keeps raw, the moved list stays an editable list.
    const out = appendMarkdown('- a <br>\n', '- b\n')
    expect(out).toBe('- a <br>\n\n* b\n')
    expect(names(out)).toEqual(['raw', 'bullet_list'])
    expect(appendMarkdown('1. a\n', '1. b\n2. c\n')).toBe('1. a\n\n1) b\n2) c\n')
    expect(appendMarkdown('- a\n', '1. b\n')).toBe('- a\n\n1. b\n')
    expect(appendMarkdown('* a\n', '- b\n')).toBe('* a\n\n- b\n')
  })

  it('does not let an indented block continue the last list item', () => {
    expect(appendMarkdown('- a\n', '  <div>x</div>\n')).toBe('- a\n\n<div>x</div>\n')
  })

  it('reads as the two pages one after the other (random pages)', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const a = parseMarkdown(serializeMarkdown(randomDoc(seed + 40_000, { maxBlocks: 4 })))
      const b = parseMarkdown(serializeMarkdown(randomDoc(seed + 50_000, { maxBlocks: 3 })))
      const out = appendMarkdown(serializeMarkdown(a), serializeMarkdown(b))
      // Last resort (a raw list moved after a list with the same marker): an empty comment between.
      const separated = out.includes('\n\n<!-- -->\n\n')
      const between = separated ? [schema.nodes.raw.create(null, schema.text('<!-- -->'))] : []
      const expected = canonicalize(a.type.create(null, a.content.append(Fragment.from(between)).append(b.content)))
      const diff = firstDifference(expected, parseMarkdown(out))
      expect(diff, `seed ${seed}: ${diff}`).toBeNull()
      // The target page's own text is kept as it is.
      expect(out.startsWith(serializeMarkdown(a).replace(/\n$/, '')), `seed ${seed}`).toBe(true)
    }
  })
})

describe('escapeProseDollars (paste)', () => {
  it('keeps prices as text', () => {
    expect(escapeProseDollars('價格 $5 和 $6')).toBe('價格 \\$5 和 \\$6')
    expect(escapeProseDollars('$1,000 to $2,000')).toBe('\\$1,000 to \\$2,000')
    expect(escapeProseDollars('between $5-$10')).toBe('between \\$5-\\$10')
    expect(parseMarkdown(escapeProseDollars('**總計** $5 和 $6')).firstChild?.type.name).toBe('paragraph')
  })

  it('leaves math, single dollars and code alone', () => {
    for (const md of ['$x^2$ 與 $y$', 'only $5 here', '`$5 and $6`', '```\n$5 and $6\n```', '$$\nx\n$$', '\\$5 and \\$6']) {
      expect(escapeProseDollars(md), md).toBe(md)
    }
  })
})

/**
 * Parsing arbitrary Markdown (seeded random lines of block and inline syntax):
 *  - parse never throws and returns a canonical, schema-valid document;
 *  - every raw block is an exact slice of the input (DATA-15);
 *  - parse(serialize(parse(md))) equals parse(md), and serializing again is stable (DATA-16);
 *  - cutting long bodies into chunks gives the same document as parsing them whole.
 */
import { describe, expect, it } from 'vitest'
import { canonicalize, parseMarkdown, serializeMarkdown } from './index'
import { parseBody } from './parse'
import { firstDifference } from './testing/diff'
import { prng } from './testing/randomDoc'

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const ITERATIONS = Number(env.MD_PARSE_FUZZ_ITERATIONS ?? 1200)

const LINES = [
  '', '', '', '', '中文段落，含**粗體**與*斜體*。', 'plain text', 'a **b** *c* ~~d~~ `e` <u>f</u>', '<span data-color="red">紅</span><span data-bg="blue">藍</span>',
  '# h1', '## h2 #', '### h3', '#### h4', '###### h6', 'Setext', '===', '---', '***', '- - -',
  '- item', '- [ ] todo', '- [x] done', '- [ ]', '-', '* star', '+ plus', '1. one', '2. two', '10. ten', '3) paren', '1.',
  '  - nested', '   1. nested ordered', '    indented code', '\tтаб', '  continuation',
  '> quote', '> > nested quote', '>', '> [!NOTE]', '> [!tip]', '> <!-- icon: 🧠 -->', '[!WARNING]', '> - quoted list',
  '```', '```js', '~~~', '````', '$$', '$x$ math', 'cost $5',
  '<details>', '<details open>', '<summary>T</summary>', '<summary>a &amp; b</summary>', '</details>', '<details>\n<summary>S</summary>',
  '<div>', '</div>', '<!-- comment -->', '<!--', '-->', '<pre>', '</pre>', '<br>', 'text <br> more', '<img src="x.png">',
  '| a | b |', '| - | - |', '| :-- | --: |', '|---|', 'a | b', '| `x\\|y` | z |',
  '[^1]: footnote', 'ref [^1]', '[ref]: /x.md', '[link][ref]', '[link]',
  '![img](/_assets/a.png)', '![img](/_assets/a.png "t")', '[page](/工作/a.md)', '[file](/_assets/f.pdf)', '[ext](https://x.com)', '<https://x.com>',
  'text\\', 'hard  ', '\\# escaped', '&amp; &#x20; &copy;', 'www.example.com', '**「引號」**文字', '*a**b***', '__a__b', '_a_',
  '[](https://x.com)', '[]( /a.md )', '[x](</a b.md>)',
]

function randomMarkdown(seed: number): string {
  const rand = prng(seed)
  const n = 1 + Math.floor(rand() * 25)
  const lines: string[] = []
  for (let i = 0; i < n; i++) lines.push(LINES[Math.floor(rand() * LINES.length)])
  return lines.join('\n') + (rand() < 0.5 ? '\n' : '')
}

describe('parsing arbitrary Markdown', () => {
  it(`is stable for ${ITERATIONS} random inputs`, () => {
    for (let seed = 1; seed <= ITERATIONS; seed++) {
      const md = randomMarkdown(seed)
      const parsed = parseMarkdown(md)
      parsed.check()
      expect(canonicalize(parsed).eq(parsed), `not canonical, seed ${seed}: ${JSON.stringify(md)}`).toBe(true)
      parsed.forEach((block) => {
        if (block.type.name === 'raw') {
          expect(md.includes(block.textContent), `raw is not a slice, seed ${seed}: ${JSON.stringify(md)}`).toBe(true)
        }
      })
      const out = serializeMarkdown(parsed)
      const again = parseMarkdown(out)
      const diff = firstDifference(parsed, again)
      if (diff) throw new Error(`seed ${seed}\ninput: ${JSON.stringify(md)}\noutput: ${JSON.stringify(out)}\n${diff}`)
      expect(serializeMarkdown(again)).toBe(out)
    }
  }, 120_000)

  it('gives the same document whether long bodies are parsed whole or in chunks', () => {
    for (let seed = 1; seed <= 150; seed++) {
      let md = ''
      for (let k = 0; k < 8; k++) md += randomMarkdown(seed * 100 + k) + '\n\n'
      // Definitions make a body unchunkable; leave them out here.
      md = md.replace(/^.*\]:.*$/gm, '')
      const whole = parseBody(md, Number.MAX_SAFE_INTEGER)
      const chunked = parseBody(md, 1)
      const diff = firstDifference(whole, chunked)
      if (diff) throw new Error(`seed ${seed}\ninput: ${JSON.stringify(md)}\n${diff}`)
    }
  }, 120_000)
})

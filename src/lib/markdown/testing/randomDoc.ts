/**
 * Seeded random editor documents for the DATA-16 round-trip property tests. Every node and mark
 * of the schema appears, with nesting, Chinese and emoji text, characters that need escaping,
 * CJK punctuation next to marks, whitespace at mark edges, long numbered lists, raw blocks, and
 * a few attribute values that `canonicalize` has to normalise.
 *
 * Test-only; no dependencies beyond the schema.
 */
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model'
import { NOTION_COLORS, schema } from '../../schema'

const nodes = schema.nodes
const marks = schema.marks

/** mulberry32 */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = [
  '中文', '測試', '筆記', '工作', '專案', '會議記錄', '「引號」', '『書名』', '（括號）', '【標記】', '，', '。', '！', '？', '、', '：', '；', '…',
  'hello', 'world', 'a', 'B', 'x_y', 'snake_case', 'foo*bar', 'Ünïcödé', '42', '3.14',
  '🧠', '😀', '👍🏽', '🇹🇼', '👨‍👩‍👧',
]

const SPECIALS = [
  '*', '**', '_', '__', '[', ']', '<', '>', '#', '##', '|', '\\', '`', '``', '```', '~', '~~', '!', '-', '+', '=', '===', '---', '***', '1.', '1)', '10.', '$', '$$', '&', '&amp;',
  '&#x20;', '&copy;', ':', '"', "'", '(', ')', '{', '}', '^', '[^1]', '[ ]', '[x]', '[!NOTE]', '<u>', '</u>', '<span data-color="red">', '</span>', '<!--', '-->', '<br>',
  '<div>', '</details>', 'www.example.com', 'https://example.com/a_b_', 'a@b.co', '![x](y)', '[a](b)', '\\*', '\\\\', '* ', '- ', '+ ', '> ', '# ', '1. ', '    ', '\t', ' ',
  '  ', ' ', '　', '​', '|-|', ':-', '\\|',
]

const COLORS = [...NOTION_COLORS]

const LINKS = [
  'https://example.com', 'https://example.com/a b', 'https://x.com/(paren)', '/工作/專案%20A.md', '/a.md#frag', '/_assets/2026/10/3f9a2c1b.pdf', '#top', '', 'mailto:a@b.co',
  'relative/path.md', '/x y.md', 'https://e.com/<x>', 'https://e.com/\\back',
]
const IMAGE_SRCS = ['/_assets/2026/10/3f9a2c1b.png', 'https://example.com/a b.png', '', 'a(b).png', '/_assets/x <y>.jpg']
const FILE_HREFS = ['/_assets/2026/10/ab12cd34.pdf', '/_assets/a b (1).zip', '/_assets/x.md', 'https://example.com/file.pdf']
const PAGE_HREFS = ['/工作/會議記錄.md', '/a%20b.md#標題', '/x.md', '/README.md', '/notes.txt', '/工作/專案 A.md']
const LANGUAGES = ['', 'js', 'ts', 'python', 'c++', 'a b', 'x`y', 'c~', '&amp;', 'js  title="x"', ' lead']
const ICONS = [null, null, '🧠', '💡', 'ℹ️', '', ' 🔥 ', '-->']

/**
 * Raw blocks: each is one top-level construct the editor does not understand, that stays one
 * separate block when written between other blocks (blank-line separated).
 */
export const RAW_SAMPLES = [
  '<div>\n<b>hi</b> there\n</div>',
  '<!-- a comment -->',
  '<!--\nmulti\n\nline comment\n-->',
  '[^1]: a footnote definition',
  'text with $x^2$ math',
  '$$\n\\sum_{i=0}^n i\n$$',
  '#### Heading 4',
  '###### h6 **bold**',
  '[r1]: https://example.com "title"',
  '<img src="/_assets/a.png" width="100">',
  'line with <br> inline html',
  '<pre>\ncode\n\nmore\n</pre>',
  '<custom-element>\ncontent\n</custom-element>',
  '  <div>indented</div>',
  '* star list with $m$\n* second',
  '> quote with $m$',
  '| a | b |\n| - | - |\n| $x$ | y |',
  '<details>\n<summary>no blank line</summary>\ncontent\n</details>',
  '<details>\n\n</details>',
  '+ item <!-- c -->\n+ b',
  '- dash list <!-- c -->\n- b',
  '1. ordered with $m$\n2. b',
  '中文 <kbd>Ctrl</kbd> 鍵',
  '![inline](/_assets/a.png) image in text',
  '[](https://example.com)',
]

export interface RandomDocOptions {
  /** Maximum nesting depth of containers. */
  maxDepth?: number
  /** Maximum number of top-level blocks. */
  maxBlocks?: number
}

export function randomDoc(seed: number, options: RandomDocOptions = {}): PMNode {
  const rand = prng(seed)
  const maxDepth = options.maxDepth ?? 3
  const maxBlocks = options.maxBlocks ?? 8

  const int = (n: number) => Math.floor(rand() * n)
  const pick = <T>(list: readonly T[]): T => list[int(list.length)]
  const chance = (p: number) => rand() < p

  function word(): string {
    const r = rand()
    if (r < 0.45) return pick(WORDS)
    if (r < 0.9) return pick(SPECIALS)
    return ' '
  }

  function text(min = 1, max = 4, allowNewline = false): string {
    let s = ''
    const n = min + int(max - min + 1)
    for (let i = 0; i < n; i++) {
      s += word()
      if (allowNewline && chance(0.08)) s += pick(['\n', '\n\n', ' \n', '\n  '])
    }
    return s
  }

  function nonEmptyText(allowNewline = false): string {
    let s = text(1, 4, allowNewline)
    if (s === '') s = 'x'
    return s
  }

  function randomMarks(allowLink = true): Mark[] {
    const set: Mark[] = []
    if (chance(0.12)) set.push(marks.bg.create({ color: chance(0.05) ? 'neon' : pick(COLORS) }))
    if (chance(0.12)) set.push(marks.color.create({ color: pick(COLORS) }))
    if (allowLink && chance(0.15)) {
      set.push(marks.link.create({ href: pick(LINKS), title: chance(0.2) ? pick(['t', 'a "q"', '', "it's"]) : null }))
    }
    if (chance(0.25)) set.push(marks.bold.create())
    if (chance(0.25)) set.push(marks.italic.create())
    if (chance(0.15)) set.push(marks.strike.create())
    if (chance(0.12)) set.push(marks.underline.create())
    if (chance(0.12)) set.push(marks.code.create())
    let sorted: readonly Mark[] = []
    for (const m of set) sorted = m.addToSet(sorted)
    return [...sorted]
  }

  /** Inline content: text runs with random marks, and hard breaks when allowed. */
  function inline(allowBreaks: boolean, allowNewline: boolean): PMNode[] {
    const out: PMNode[] = []
    const n = 1 + int(5)
    let prevMarks: Mark[] = []
    for (let i = 0; i < n; i++) {
      if (allowBreaks && chance(0.1)) {
        out.push(nodes.hard_break.create(null, null, chance(0.5) ? prevMarks : randomMarks()))
        continue
      }
      // Often keep some marks of the previous run so that mark ranges overlap.
      let ms = randomMarks()
      if (chance(0.3)) {
        let set: readonly Mark[] = ms
        for (const m of prevMarks) if (chance(0.6)) set = m.addToSet(set)
        ms = [...set]
      }
      let t = nonEmptyText(allowNewline)
      if (chance(0.15)) t = pick([' ', '  ', '\t']) + t
      if (chance(0.15)) t = t + pick([' ', '  ', '\t'])
      out.push(schema.text(t, ms))
      prevMarks = ms
    }
    return out
  }

  function paragraph(allowEmpty = true): PMNode {
    if (allowEmpty && chance(0.05)) return nodes.paragraph.create()
    if (chance(0.05)) {
      // A paragraph that is just one link (becomes a File / Link to page block, or not).
      const href = pick([...PAGE_HREFS, ...FILE_HREFS, ...LINKS])
      return nodes.paragraph.create(null, schema.text(nonEmptyText(), [marks.link.create({ href, title: null })]))
    }
    return nodes.paragraph.create(null, Fragment.fromArray(inline(true, true)))
  }

  function codeText(): string {
    const lines: string[] = []
    const n = int(5)
    for (let i = 0; i < n; i++) {
      lines.push(pick(['const x = 1', '```', '~~~', '````js', '', '  indented', '\ttab', '# not heading', '- not list', '</details>', '中文 code', '$$']))
    }
    let s = lines.join('\n')
    if (chance(0.1)) s += '\n'
    return s
  }

  function listItem(depth: number, todo: boolean | null): PMNode {
    const first = chance(0.15) ? nodes.paragraph.create() : paragraph(false)
    const kids: PMNode[] = [first]
    if (depth < maxDepth && chance(0.35)) {
      const n = 1 + int(2)
      for (let i = 0; i < n; i++) kids.push(block(depth + 1, false))
    }
    const checked = todo === null ? (chance(0.1) ? pick([true, false]) : null) : chance(0.8) ? todo : null
    return nodes.list_item.create({ checked }, kids)
  }

  function list(depth: number, ordered: boolean): PMNode {
    const long = chance(0.1)
    const n = long ? 9 + int(15) : 1 + int(4)
    const todo = chance(0.3) ? pick([true, false]) : null
    const items: PMNode[] = []
    for (let i = 0; i < n; i++) items.push(listItem(depth, todo === null ? null : chance(0.5)))
    if (ordered) {
      const start = pick([1, 1, 1, 0, 2, 7, 9, 98, 999, -3, 1.5])
      return nodes.ordered_list.create({ start }, items)
    }
    return nodes.bullet_list.create(null, items)
  }

  function table(): PMNode {
    const rows = 1 + int(4)
    const cols = 1 + int(4)
    const out: PMNode[] = []
    for (let r = 0; r < rows; r++) {
      const cells: PMNode[] = []
      const width = chance(0.15) ? 1 + int(5) : cols
      for (let c = 0; c < width; c++) {
        const type = (r === 0) !== chance(0.05) ? nodes.table_header : nodes.table_cell
        const content = chance(0.15) ? [] : inline(false, chance(0.1))
        cells.push(
          type.create(
            {
              align: chance(0.4) ? pick(['left', 'center', 'right', null]) : null,
              colspan: chance(0.03) ? 2 : 1,
            },
            content,
          ),
        )
      }
      out.push(nodes.table_row.create(null, cells))
    }
    return nodes.table.create(null, out)
  }

  function nested(depth: number): PMNode[] {
    const n = int(3) + (chance(0.5) ? 1 : 0)
    const out: PMNode[] = []
    for (let i = 0; i < n; i++) out.push(block(depth + 1, false))
    return out
  }

  function block(depth: number, top: boolean): PMNode {
    const containers = depth < maxDepth
    const r = rand()
    if (r < 0.22) return paragraph()
    if (r < 0.28) return nodes.heading.create({ level: chance(0.05) ? 5 : 1 + int(3) }, inline(false, chance(0.1)))
    if (r < 0.32) return nodes.code_block.create({ language: pick(LANGUAGES) }, (() => { const t = codeText(); return t ? schema.text(t) : null })())
    if (r < 0.34) return nodes.horizontal_rule.create()
    if (r < 0.37) {
      return nodes.image.create({ src: pick(IMAGE_SRCS), alt: chance(0.2) ? '' : text(1, 3, chance(0.1)), title: chance(0.2) ? pick(['t', '', 'a "b"']) : null })
    }
    if (r < 0.39) return nodes.file.create({ href: pick(FILE_HREFS), name: chance(0.1) ? '' : text(1, 3) })
    if (r < 0.42) return nodes.page_link.create({ href: pick(PAGE_HREFS), title: chance(0.1) ? '' : text(1, 3) })
    if (containers && r < 0.52) return list(depth, false)
    if (containers && r < 0.6) return list(depth, true)
    if (containers && r < 0.66) {
      const content = nested(depth)
      return nodes.blockquote.create(null, content.length ? content : [paragraph(false)])
    }
    if (top && r < 0.72) {
      const content = nested(depth)
      return nodes.callout.create(
        { kind: pick(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION', 'BOGUS']), icon: pick(ICONS) },
        content.length ? content : [nodes.paragraph.create()],
      )
    }
    if (containers && r < 0.8) {
      const summary = chance(0.1) ? '' : text(1, 3, chance(0.1))
      return nodes.toggle.create({ open: chance(0.5) }, [
        nodes.toggle_summary.create(null, summary ? schema.text(summary) : null),
        ...nested(depth),
      ])
    }
    if (r < 0.86) return table()
    if (top && r < 0.92) return nodes.raw.create(null, schema.text(pick(RAW_SAMPLES)))
    return paragraph()
  }

  const blocks: PMNode[] = []
  const n = 1 + int(maxBlocks)
  for (let i = 0; i < n; i++) {
    let b = block(0, true)
    // Two raw lists with the same marker next to each other would read back as one list.
    const prev = blocks[blocks.length - 1]
    if (b.type === nodes.raw && prev?.type === nodes.raw) b = paragraph(false)
    blocks.push(b)
  }
  return nodes.doc.create(null, blocks)
}

/**
 * Editor document → Markdown (§3.4). Block structure is written here; inline content goes
 * through `mdast-util-to-markdown`, which does the escaping and chooses emphasis markers so that
 * they pair as intended (its "attention" handling), with character references where needed.
 *
 * Input must be canonical (see `canonicalize.ts`): `serializeMarkdown` canonicalizes first.
 *
 * Layout:
 * - Top-level blocks, and the blocks inside quotes, callouts and toggles, are separated by one
 *   blank line.
 * - Inside a list item, a nested list that can interrupt a paragraph follows the item's text on
 *   the next line (tight); anything else is separated by a blank line.
 * - List items follow each other on the next line. Children are indented by the width of the
 *   marker (DATA-13): 2 under `- `, 3 under `1.`–`9.`, 4 under `10.`–`99.`, …
 */
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model'
import type { PhrasingContent, Paragraph } from 'mdast'
import { toMarkdown, defaultHandlers, type Handle, type Info, type State, type Unsafe } from 'mdast-util-to-markdown'
import { schema } from '../schema'
import { MARK_LEVELS } from './canonicalize'
import { escapeHtmlText } from './html'
import { inlineContentsFromMarkdown, inlineFromMarkdown } from './parse'

const nodes = schema.nodes
const marks = schema.marks

const TRACK = { now: { line: 1, column: 1 }, lineShift: 0 }

/** Escapes beyond to-markdown's CommonMark set, for the syntax our parser also reads. */
const EXTRA_UNSAFE: Unsafe[] = [
  // GFM strikethrough (single and double tilde).
  {
    character: '~',
    inConstruct: 'phrasing',
    notInConstruct: ['autolink', 'destinationLiteral', 'destinationRaw', 'reference', 'titleQuote', 'titleApostrophe'],
  },
  // Math (`$x$`, `$$`), parsed so that it is kept raw.
  {
    character: '$',
    inConstruct: 'phrasing',
    notInConstruct: ['autolink', 'destinationLiteral', 'destinationRaw', 'reference', 'titleQuote', 'titleApostrophe'],
  },
  // GFM tables: a paragraph line must not look like a delimiter row.
  { atBreak: true, character: '|', after: '[\t :-]' },
  { atBreak: true, character: ':', after: '-' },
  { atBreak: true, character: '-', after: '[:|-]' },
  // In cells: pipes, and line breaks (a row is one line).
  { character: '|', inConstruct: 'tableCell' as never },
  { character: '\n', inConstruct: 'tableCell' as never },
  // A line break in text next to another line break, or at the start/end of the paragraph,
  // would make a blank line or be stripped: write it as `&#xA;`.
  { character: '\n', before: '[\\r\\n]', inConstruct: 'phrasing' },
  { character: '\n', after: '[\\r\\n]', inConstruct: 'phrasing' },
  // Image alt text: a line break could make a blank line.
  { character: '\n', inConstruct: 'image' },
]

/** GFM strikethrough as attention, like `mdast-util-gfm-strikethrough`. */
const handleDelete = Object.assign(
  ((node: unknown, _parent: unknown, state: State, info: Info) => {
    const exit = state.enter('phrasing')
    const value = state.containerPhrasing({ type: 'root', children: [node] } as never, info)
    exit()
    return value
  }) as Handle,
  {
    attention: () => ({ construct: 'strikethrough' as never, markers: ['~'], sizes: [2, 1] }),
    peek: () => '~',
  },
)

/** Inline code; in a table cell `|` is written `\|` (GFM reads it back as `|` inside code). */
const handleInlineCode = Object.assign(
  ((node: unknown, parent: Parameters<Handle>[1], state: State) => {
    const value = defaultHandlers.inlineCode(node as never, parent, state)
    return state.stack.includes('tableCell' as never) ? value.replace(/\|/g, '\\|') : value
  }) as Handle,
  { peek: () => '`' },
)

/**
 * Text. Two things to-markdown's own text handler gets wrong, handled here:
 * - Every backslash is written escaped (as two backslashes). to-markdown leaves a backslash
 *   alone when the next character is not punctuation, but that character may afterwards become
 *   a character reference (`&#x20;` next to emphasis), which would turn the backslash into an
 *   escape.
 * - Each line is escaped on its own. to-markdown's line-start escapes (`+ `, `# `, `1. `…) miss
 *   a line when the previous line also needed one (its pattern consumes the line break).
 * A line break is written as is, or as `&#xA;` next to another line break or at the start or
 * end of the paragraph (where it would make a blank line or be stripped), and always in
 * headings and table cells.
 */
const handleText = ((node: { value: string }, parent: Parameters<Handle>[1], state: State, info: Info) => {
  const value = node.value
  if (!/[\\\n]/.test(value)) return defaultHandlers.text(node as never, parent, state, info)
  const pieces = value.split(/(\\|\n)/)
  const isEol = (c: string | undefined) => c === '\n' || c === '\r'
  // Headings and table cells are one line.
  const oneLine = state.stack.includes('headingAtx') || state.stack.includes('tableCell' as never)
  let out = ''
  let pos = 0
  pieces.forEach((piece, k) => {
    if (piece === '') return
    if (piece === '\\') {
      out += '\\\\'
    } else if (piece === '\n') {
      const before = pos === 0 ? info.before.slice(-1) : value[pos - 1]
      const after = pos === value.length - 1 ? info.after.charAt(0) : value[pos + 1]
      out += isEol(before) || isEol(after) || oneLine ? '&#xA;' : '\n'
    } else {
      // Pieces alternate text / separator, so the next piece is a backslash or a line break.
      out += state.safe(piece, {
        ...info,
        before: out === '' ? info.before : out.slice(-1),
        after: pieces[k + 1] ?? info.after,
      })
    }
    pos += piece.length
  })
  return out
}) as Handle

/** Serialize a canonical document. */
export function serializeCanonical(doc: PMNode): string {
  session = { pending: [], forceHtml: new Set() }
  try {
    const first = runSerializer(doc)
    const failed = failedChecks(session.pending)
    if (failed.size === 0) return first
    session = { pending: [], forceHtml: failed }
    return runSerializer(doc)
  } finally {
    session = { pending: [], forceHtml: new Set() }
  }
}

function runSerializer(doc: PMNode): string {
  return toMarkdown({ type: 'root', children: [] }, {
    handlers: {
      root: ((_node: unknown, _parent: unknown, state: State) => serializeDoc(doc, state)) as Handle,
      delete: handleDelete,
      inlineCode: handleInlineCode,
      text: handleText,
    },
    unsafe: EXTRA_UNSAFE,
    emphasis: '*',
    strong: '*',
    quote: '"',
  })
}

/** The Markdown of a link label holding `text` (escaped), without the brackets. */
export function linkLabelMarkdown(text: string): string {
  const out = toMarkdown({ type: 'root', children: [] }, {
    handlers: {
      root: ((_node: unknown, _parent: unknown, state: State) =>
        phrasing(state, [{ type: 'link', url: 'x', title: null, children: text ? [{ type: 'text', value: text }] : [] }])) as Handle,
      delete: handleDelete,
      inlineCode: handleInlineCode,
      text: handleText,
    },
    unsafe: EXTRA_UNSAFE,
  })
  // `[label](x)\n`
  return out.slice(1, out.lastIndexOf('](x)'))
}

function serializeDoc(doc: PMNode, state: State): string {
  const parts: string[] = []
  const blocks = childrenOf(doc)
  blocks.forEach((block, i) => {
    let s: string
    if (block.type === nodes.paragraph && block.content.size === 0) s = ''
    else if (block.type === nodes.bullet_list || block.type === nodes.ordered_list) {
      s = list(block, state, listMarkerFor(block, blocks[i - 1], blocks[i + 1]))
    } else s = serializeBlock(block, state)
    if (s !== '') parts.push(s)
  })
  return parts.join('\n\n')
}

/** The bullet (`-`) or number delimiter (`.`) a raw block's list uses, if it is a list. */
function rawListMarker(node: PMNode | undefined): string | null {
  if (!node || node.type !== nodes.raw) return null
  const m = /^ {0,3}(?:([-+*])|\d{1,9}([.)]))(?:[ \t\n]|$)/.exec(node.textContent)
  return m ? (m[1] ?? m[2]) : null
}

/**
 * Lists use `-` and `1.`, except next to a raw block that is a list with the same marker
 * (kept as written, e.g. `- item <br>`): Markdown would join the two into one list, so this list
 * uses `*` / `+` (or `1)`) instead.
 */
function listMarkerFor(node: PMNode, prev: PMNode | undefined, next: PMNode | undefined): string {
  const taken = [rawListMarker(prev), rawListMarker(next)]
  const options = node.type === nodes.ordered_list ? ['.', ')'] : ['-', '*', '+']
  return options.find((o) => !taken.includes(o)) ?? options[0]
}

function serializeBlocks(blocks: readonly PMNode[], state: State): string {
  return blocks.map((b) => serializeBlock(b, state)).join('\n\n')
}

function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((c) => out.push(c))
  return out
}

function serializeBlock(node: PMNode, state: State): string {
  switch (node.type.name) {
    case 'paragraph':
      return inlineMarkdown(node, state, 'paragraph')
    case 'heading':
      return inlineMarkdown(node, state, 'heading')
    case 'code_block':
      return codeBlock(node)
    case 'horizontal_rule':
      return '---'
    case 'image':
    case 'file':
    case 'page_link':
      return phrasing(state, [aloneNode(node)])
    case 'bullet_list':
    case 'ordered_list':
      return list(node, state)
    case 'blockquote':
      return prefixLines(serializeBlocks(childrenOf(node), state), '> ', '>')
    case 'callout':
      return callout(node, state)
    case 'toggle':
      return toggle(node, state)
    case 'table':
      return table(node, state)
    case 'raw':
      return node.textContent
    default:
      throw new Error(`markdown: cannot serialize ${node.type.name}`)
  }
}

/** Image / File / Link to page block as the one inline node of its paragraph. */
function aloneNode(node: PMNode): PhrasingContent {
  if (node.type === nodes.image) {
    return { type: 'image', url: node.attrs.src as string, alt: node.attrs.alt as string, title: node.attrs.title as string | null }
  }
  const href = node.attrs.href as string
  const text = (node.type === nodes.file ? node.attrs.name : node.attrs.title) as string
  return { type: 'link', url: href, title: null, children: text ? [{ type: 'text', value: text }] : [] }
}

function isAloneBlock(node: PMNode): boolean {
  return node.type === nodes.image || node.type === nodes.file || node.type === nodes.page_link
}

function prefixLines(text: string, prefix: string, blankPrefix: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? blankPrefix : prefix + line))
    .join('\n')
}

/** Run inline mdast through to-markdown's phrasing serializer. */
function phrasing(
  state: State,
  children: PhrasingContent[],
  constructs: string[] = ['paragraph'],
  before = '\n',
  after = '\n',
): string {
  const exits = [...constructs, 'phrasing'].map((c) => state.enter(c as never))
  const paragraph: Paragraph = { type: 'paragraph', children }
  const value = state.containerPhrasing(paragraph, { before, after, ...TRACK })
  for (let i = exits.length - 1; i >= 0; i--) exits[i]()
  return value
}

type InlineKind = 'paragraph' | 'heading' | 'cell'

/**
 * The Markdown of a paragraph's, heading's or table cell's inline content (a heading includes
 * its `#` sequence). Where emphasis/strong/strikethrough spans touch (one right after another,
 * or one at the edge of another), CommonMark's delimiter rules can defeat even to-markdown's
 * choice of markers, so the result is parsed back and compared; if it differs, those spans are
 * written as `<strong>`, `<em>`, `<del>` instead (the parser reads those as the same marks).
 * (Spans with text between them pair as intended: no failure in tens of thousands of random
 * paragraphs, and the round-trip tests cover them.)
 */
function inlineMarkdown(node: PMNode, state: State, kind: InlineKind): string {
  const children = toPhrasing(node)
  if (session.forceHtml.has(node)) return renderInline(node, state, kind, htmlAttention(children))
  const md = renderInline(node, state, kind, children)
  if (attentionTouches(children)) session.pending.push({ kind, md, node })
  return md
}

interface PendingCheck {
  kind: InlineKind
  md: string
  node: PMNode
}

/** State of one `serializeCanonical` call (serializing is synchronous, never re-entered). */
let session: { pending: PendingCheck[]; forceHtml: Set<PMNode> } = { pending: [], forceHtml: new Set() }

/** The containers whose Markdown does not read back as their content. One parse for all. */
function failedChecks(pending: readonly PendingCheck[]): Set<PMNode> {
  const failed = new Set<PMNode>()
  if (pending.length === 0) return failed
  const results = inlineContentsFromMarkdown(pending.map((p) => ({ kind: p.kind, md: p.md })))
  pending.forEach((p, i) => {
    const back = results ? results[i] : inlineFromMarkdown(p.kind, p.md)
    if (!back || !Fragment.fromArray(back).eq(p.node.content)) failed.add(p.node)
  })
  return failed
}

function renderInline(node: PMNode, state: State, kind: InlineKind, children: PhrasingContent[]): string {
  if (kind === 'paragraph') return phrasing(state, children)
  if (kind === 'cell') return encodeEdgeWhitespace(phrasing(state, children, ['table', 'tableRow', 'tableCell'], ' ', ' '))
  const sequence = '#'.repeat(node.attrs.level as number)
  let value = phrasing(state, children, ['headingAtx'], '# ', '\n')
  if (/^[\t ]/.test(value)) value = `&#x${value.charCodeAt(0).toString(16).toUpperCase()};${value.slice(1)}`
  return value ? `${sequence} ${value}` : sequence
}

const ATTENTION_TAGS: Partial<Record<string, string>> = { strong: 'strong', emphasis: 'em', delete: 'del' }

/** Whether two emphasis-like spans are next to each other, or one is at the edge of another. */
function attentionTouches(children: readonly PhrasingContent[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    if (!('children' in c)) continue
    if (ATTENTION_TAGS[c.type]) {
      const next = children[i + 1]
      const kids = c.children
      if (next && ATTENTION_TAGS[next.type]) return true
      if (kids.length > 0 && (ATTENTION_TAGS[kids[0].type] || ATTENTION_TAGS[kids[kids.length - 1].type])) return true
    }
    if (attentionTouches(c.children)) return true
  }
  return false
}

/** The same phrasing with emphasis, strong and strikethrough as HTML tags. */
function htmlAttention(children: readonly PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = []
  for (const c of children) {
    const tag = ATTENTION_TAGS[c.type]
    if (tag && 'children' in c) {
      out.push(html(`<${tag}>`), ...htmlAttention(c.children), html(`</${tag}>`))
    } else if (c.type === 'link') {
      out.push({ ...c, children: htmlAttention(c.children) })
    } else {
      out.push(c)
    }
  }
  return out
}

function longestRun(text: string, char: string): number {
  let max = 0
  let run = 0
  for (const c of text) {
    if (c === char) {
      run++
      if (run > max) max = run
    } else {
      run = 0
    }
  }
  return max
}

/** Escape what an info string would decode: backslash escapes and character references. */
function escapeInfo(info: string): string {
  return info.replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\').replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&')
}

function codeBlock(node: PMNode): string {
  const text = node.textContent
  const language = node.attrs.language as string
  const char = language.includes('`') ? '~' : '`'
  const fence = char.repeat(Math.max(3, longestRun(text, char) + 1))
  return `${fence}${escapeInfo(language)}\n${text}${text ? '\n' : ''}${fence}`
}

function isParagraphLike(node: PMNode): boolean {
  return node.type === nodes.paragraph || isAloneBlock(node)
}

/**
 * Whether a nested list can start on the line right after a paragraph (it interrupts the
 * paragraph): a numbered list only from 1, and not when its first item starts with an empty
 * line (`-` alone, which after text would even read as a setext heading underline).
 */
function listCanFollowText(node: PMNode): boolean {
  if (node.type === nodes.ordered_list && node.attrs.start !== 1) return false
  const item = node.firstChild
  if (!item) return false
  const text = item.firstChild
  return item.attrs.checked !== null || Boolean(text && text.content.size > 0) || (item.childCount > 1 && isAloneBlock(item.child(1)))
}

function list(node: PMNode, state: State, marker?: string): string {
  const ordered = node.type === nodes.ordered_list
  const start = ordered ? (node.attrs.start as number) : 0
  const items: string[] = []
  node.forEach((item, _offset, index) => {
    items.push(listItem(item, ordered ? `${start + index}${marker ?? '.'}` : (marker ?? '-'), state))
  })
  return items.join('\n')
}

function listItem(item: PMNode, marker: string, state: State): string {
  const checked = item.attrs.checked as boolean | null
  const box = checked === true ? '[x]' : checked === false ? '[ ]' : null
  const children = childrenOf(item)
  const first = children[0]
  let rest = children.slice(1)
  let head: string
  let headIsText: boolean
  if (first.content.size > 0) {
    head = inlineMarkdown(first, state, 'paragraph')
    headIsText = true
  } else if (rest.length > 0 && isAloneBlock(rest[0])) {
    head = serializeBlock(rest[0], state)
    rest = rest.slice(1)
    headIsText = true
  } else {
    head = ''
    headIsText = box !== null
  }
  if (box) head = head ? `${box} ${head}` : box
  let body = head
  let prev: PMNode | null = headIsText ? first : null
  for (const child of rest) {
    const text = serializeBlock(child, state)
    if (prev === null) {
      // Empty first line (`-`): the block starts on the next line, inside the item.
      body += `\n${text}`
    } else if (isParagraphLike(prev) && (child.type === nodes.bullet_list || child.type === nodes.ordered_list) && listCanFollowText(child)) {
      body += `\n${text}`
    } else {
      body += `\n\n${text}`
    }
    prev = child
  }
  const indent = ' '.repeat(marker.length + 1)
  return body
    .split('\n')
    .map((line, i) => (i === 0 ? (line ? `${marker} ${line}` : marker) : line === '' ? '' : indent + line))
    .join('\n')
}

function callout(node: PMNode, state: State): string {
  const icon = node.attrs.icon as string | null
  let out = `[!${node.attrs.kind as string}]`
  if (icon) out += `\n<!-- icon: ${icon} -->`
  const children = childrenOf(node).filter((c) => !(c.type === nodes.paragraph && c.content.size === 0))
  children.forEach((child, i) => {
    const text = serializeBlock(child, state)
    // A paragraph right after the marker shares its Markdown paragraph (GitHub's form); any
    // other block gets a blank line, so nothing depends on interrupting the marker paragraph.
    if (i === 0 && (icon || isParagraphLike(child))) out += `\n${text}`
    else out += `\n\n${text}`
  })
  return prefixLines(out, '> ', '>')
}

function toggle(node: PMNode, state: State): string {
  const children = childrenOf(node)
  const summary = children[0]?.type === nodes.toggle_summary ? children[0].textContent : ''
  const body = serializeBlocks(children.slice(1), state)
  return `<details>\n<summary>${escapeHtmlText(summary)}</summary>\n\n${body ? `${body}\n\n` : ''}</details>`
}

function encodeEdgeWhitespace(cell: string): string {
  let out = cell
  if (/^[ \t]/.test(out)) out = `&#x${out.charCodeAt(0).toString(16).toUpperCase()};${out.slice(1)}`
  if (/[ \t]$/.test(out) && out.length > 0) {
    const c = out.charCodeAt(out.length - 1)
    out = `${out.slice(0, -1)}&#x${c.toString(16).toUpperCase()};`
  }
  return out
}

function table(node: PMNode, state: State): string {
  const rows: string[] = []
  const aligns: (string | null)[] = []
  node.forEach((row, _o, r) => {
    const cells: string[] = []
    row.forEach((cell) => {
      if (r === 0) aligns.push(cell.attrs.align as string | null)
      cells.push(inlineMarkdown(cell, state, 'cell'))
    })
    rows.push(`| ${cells.join(' | ')} |`)
    if (r === 0) {
      const delims = aligns.map((a) => (a === 'left' ? ':---' : a === 'right' ? '---:' : a === 'center' ? ':---:' : '---'))
      rows.push(`| ${delims.join(' | ')} |`)
    }
  })
  return rows.join('\n')
}

// ---------------------------------------------------------------------------------------------
// Inline content → mdast phrasing, marks nested in the fixed DATA-14 order.

function markAt(node: PMNode, level: number): Mark | null {
  return MARK_LEVELS[level].isInSet(node.marks) ?? null
}

function sameMark(a: Mark | null, b: Mark | null): boolean {
  return a === b || (a !== null && b !== null && a.eq(b))
}

/**
 * Inline nodes → mdast phrasing. Level by level in the DATA-14 order (outermost mark type
 * first), consecutive nodes that share that level's mark go into one span; so every text's marks
 * are nested in the fixed order, and neighbours share the spans they have in common.
 */
function toPhrasing(parent: PMNode): PhrasingContent[] {
  const items: PMNode[] = []
  parent.forEach((node) => items.push(node))
  return group(items, 0)
}

function group(items: PMNode[], level: number): PhrasingContent[] {
  if (level === MARK_LEVELS.length) return items.map(leaf)
  const out: PhrasingContent[] = []
  let i = 0
  while (i < items.length) {
    const mark = markAt(items[i], level)
    let j = i + 1
    while (j < items.length && sameMark(markAt(items[j], level), mark)) j++
    const inner = group(items.slice(i, j), level + 1)
    if (mark === null) out.push(...inner)
    else out.push(...wrap(mark, inner))
    i = j
  }
  return out
}

function html(value: string): PhrasingContent {
  return { type: 'html', value }
}

function wrap(mark: Mark, inner: PhrasingContent[]): PhrasingContent[] {
  switch (mark.type) {
    case marks.bg:
      return [html(`<span data-bg="${mark.attrs.color as string}">`), ...inner, html('</span>')]
    case marks.color:
      return [html(`<span data-color="${mark.attrs.color as string}">`), ...inner, html('</span>')]
    case marks.link:
      return [{ type: 'link', url: mark.attrs.href as string, title: (mark.attrs.title as string | null) || null, children: inner }]
    case marks.bold:
      return [{ type: 'strong', children: inner }]
    case marks.italic:
      return [{ type: 'emphasis', children: inner }]
    case marks.strike:
      return [{ type: 'delete', children: inner }]
    case marks.underline:
      return [html('<u>'), ...inner, html('</u>')]
    default:
      return inner
  }
}

function leaf(node: PMNode): PhrasingContent {
  if (node.type === nodes.hard_break) return { type: 'break' }
  const text = node.text ?? ''
  if (marks.code.isInSet(node.marks)) return { type: 'inlineCode', value: text }
  return { type: 'text', value: text }
}


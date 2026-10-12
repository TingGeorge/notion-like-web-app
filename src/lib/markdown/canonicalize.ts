/**
 * DATA-16: the canonical form of an editor document — the document `parse(serialize(doc))`
 * gives back. `parseMarkdown` always returns canonical documents, and `serializeMarkdown`
 * writes `canonicalize(doc)`, so `parse(serialize(doc))` equals `canonicalize(doc)`.
 *
 * Only changes that Markdown cannot express (or that are invisible) are made. Everything that
 * can be written exactly — whitespace at the edges of paragraphs and marks, line breaks inside
 * text, `#` at the end of headings, `|` in cells… — is written with escapes or character
 * references instead of being normalised here.
 *
 * The normalisations, in full:
 *
 * Text (everywhere)
 *  1. CR LF and lone CR become LF; NUL becomes U+FFFD (what micromark reads).
 *
 * Blocks
 *  2. Empty paragraphs are dropped. Exceptions: the first child of a list item (the item's own
 *     text), and one empty paragraph is kept where content is required (an empty quote, callout
 *     or document).
 *  3. Adjacent lists of the same type are merged (`- a` and `- b` with nothing between them are
 *     one list in Markdown). A merged numbered list keeps the first list's `start`.
 *  4. Ordered list `start` becomes an integer in 0…999 999 999 − (items − 1) (markers have at
 *     most 9 digits); non-numbers become 1.
 *  5. A paragraph that holds only one text with only a link mark (no title) to `/_assets/…`
 *     becomes a File block, to a root-relative `….md` a Link to page block (that is how the
 *     Markdown reads back, §3.4). Conversely a File / Link to page block whose href does not
 *     have that form becomes a paragraph with a linked text (or is dropped if its text is empty).
 *  6. List items: `checked` is true, false or null. A bulleted/numbered (not to-do) item whose
 *     own text is empty and whose next child is a paragraph takes that paragraph as its text
 *     (`-` followed by an indented paragraph is the same Markdown as `- text`). An item whose
 *     own text would become a File / Link to page block (5) gets an empty text and the block as
 *     its first child.
 *  7. `toggle.open` becomes false (UI state, never written).
 *  8. Callout `kind` outside the five alert types becomes NOTE; an `icon` that is empty or
 *     cannot be written in an HTML comment (`--`, `>`, line breaks) becomes null; it is
 *     trimmed.
 *  9. Headings: level clamped to 1–3.
 * 10. Code block language: trimmed, line breaks become spaces, and the space between the first
 *     word and the rest is one space (`js  title` → `js title`, as an info string reads back).
 * 11. Tables: every row is padded with empty cells to the widest row; first-row cells are
 *     header cells and the others normal cells; `colspan`/`rowspan` become 1 and `colwidth`
 *     null; each cell's `align` is its column's header-cell `align` (left/center/right/null).
 *     Tables without cells are dropped.
 * 12. `raw` blocks: leading blank lines and trailing blank lines/line breaks are removed; an
 *     empty one is dropped. A raw block whose first line is indented, placed right after a list
 *     (or after a raw block containing one), loses that indentation: it would otherwise continue
 *     the list's last item. (Never the case for a parsed document, where such a block would
 *     already be part of the list.)
 * 13. Image `title` '' becomes null; link mark `title` '' becomes null.
 *
 * Inline content
 * 14. Hard breaks at the end of a paragraph are dropped (a backslash there is a literal `\`).
 * 15. A hard break's marks become the marks the texts on both sides share, taken from the
 *     outermost mark type inwards up to the first type where they differ (never inline code):
 *     marks are invisible on a break, and Markdown can only place a break inside spans that
 *     continue across it (emphasis cannot close right after a line break).
 * 16. Inline code: line breaks become spaces (Markdown turns them into spaces). In table
 *     cells, a run of backslashes right before `|` is made even (GFM cannot write an odd run
 *     there inside code).
 * 17. Colour / background marks with a colour outside DATA-11 are removed.
 */
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model'
import { CALLOUT_KINDS, isNotionColor, schema } from '../schema'
import { aloneLinkKind, isFileHref, isPageHref } from './hrefs'

const nodes = schema.nodes
const marks = schema.marks

const MAX_ORDINAL = 999_999_999

/** Mark types in nesting order, outermost first (DATA-14; inline code, innermost, excluded). */
export const MARK_LEVELS = [marks.bg, marks.color, marks.link, marks.bold, marks.italic, marks.strike, marks.underline]

function normalizeText(text: string): string {
  return /[\r\0]/.test(text) ? text.replace(/\r\n?/g, '\n').replace(/\0/g, '�') : text
}

export function canonicalize(doc: PMNode): PMNode {
  const blocks = canonBlocks(doc.content)
  return nodes.doc.create(null, blocks.length > 0 ? blocks : [nodes.paragraph.create()])
}

function isList(node: PMNode): boolean {
  return node.type === nodes.bullet_list || node.type === nodes.ordered_list
}

/** Canonical children of a block container (doc, quote, callout, toggle, list item rest). */
function canonBlocks(content: Fragment): PMNode[] {
  const out: PMNode[] = []
  content.forEach((child) => {
    const n = canonBlock(child)
    if (!n) return
    const prev = out[out.length - 1]
    if (prev && isList(n) && prev.type === n.type) {
      out[out.length - 1] = prev.type.create(prev.attrs, prev.content.append(n.content))
    } else {
      out.push(n)
    }
  })
  for (let i = 0; i < out.length; i++) {
    if (out[i].type === nodes.ordered_list) out[i] = clampStart(out[i])
    if (out[i].type === nodes.raw && i > 0 && /^[ \t]/.test(out[i].textContent) && endsWithList(out[i - 1])) {
      out[i] = nodes.raw.create(null, schema.text(out[i].textContent.replace(/^[ \t]+/, '')))
    }
  }
  return out
}

/** A block after which an indented line (after a blank line) would continue a list item. */
function endsWithList(node: PMNode): boolean {
  if (isList(node)) return true
  return node.type === nodes.raw && /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/m.test(node.textContent)
}

function clampStart(list: PMNode): PMNode {
  const raw = list.attrs.start as unknown
  let start = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 1
  start = Math.max(0, Math.min(start, MAX_ORDINAL - (list.childCount - 1)))
  return start === raw ? list : nodes.ordered_list.create({ start }, list.content)
}

function canonBlock(node: PMNode): PMNode | null {
  switch (node.type.name) {
    case 'paragraph': {
      const inline = canonInline(node.content, { breaks: true, cell: false })
      if (inline.length === 0) return null
      return aloneLinkBlock(inline) ?? nodes.paragraph.create(null, inline)
    }
    case 'heading': {
      const raw = node.attrs.level as unknown
      const level = typeof raw === 'number' && raw >= 1 ? Math.min(3, Math.floor(raw)) : 1
      return nodes.heading.create({ level }, canonInline(node.content, { breaks: false, cell: false }))
    }
    case 'code_block': {
      const language = canonLanguage(String(node.attrs.language ?? ''))
      const text = normalizeText(node.textContent)
      return nodes.code_block.create({ language }, text ? schema.text(text) : null)
    }
    case 'horizontal_rule':
      return nodes.horizontal_rule.create()
    case 'image': {
      const title = node.attrs.title as string | null
      return nodes.image.create({
        src: normalizeText(String(node.attrs.src ?? '')),
        alt: normalizeText(String(node.attrs.alt ?? '')),
        title: title ? normalizeText(title) : null,
      })
    }
    case 'file':
    case 'page_link': {
      const href = normalizeText(String(node.attrs.href ?? ''))
      const text = normalizeText(String((node.type === nodes.file ? node.attrs.name : node.attrs.title) ?? ''))
      if (isFileHref(href)) return nodes.file.create({ href, name: text })
      if (isPageHref(href)) return nodes.page_link.create({ href, title: text })
      if (!text) return null
      return nodes.paragraph.create(null, schema.text(text, [marks.link.create({ href, title: null })]))
    }
    case 'bullet_list':
    case 'ordered_list': {
      const items: PMNode[] = []
      node.forEach((item) => items.push(canonListItem(item)))
      if (items.length === 0) return null
      return node.type.create(node.type === nodes.ordered_list ? { start: node.attrs.start as number } : null, items)
    }
    case 'blockquote':
    case 'callout': {
      const content = canonBlocks(node.content)
      const filled = content.length > 0 ? content : [nodes.paragraph.create()]
      if (node.type === nodes.blockquote) return nodes.blockquote.create(null, filled)
      return nodes.callout.create(canonCalloutAttrs(node.attrs.kind, node.attrs.icon), filled)
    }
    case 'toggle': {
      const summaryNode = node.firstChild
      const summary =
        summaryNode && summaryNode.type === nodes.toggle_summary ? normalizeText(summaryNode.textContent) : ''
      const rest: PMNode[] = []
      node.forEach((child, _offset, index) => {
        if (index > 0 || child.type !== nodes.toggle_summary) rest.push(child)
      })
      return nodes.toggle.create({ open: false }, [
        nodes.toggle_summary.create(null, summary ? schema.text(summary) : null),
        ...canonBlocks(Fragment.fromArray(rest)),
      ])
    }
    case 'table':
      return canonTable(node)
    case 'raw': {
      const text = normalizeText(node.textContent)
        .replace(/^(?:[ \t]*\n)+/, '')
        .replace(/(?:\n[ \t]*)+$/, '')
      return text.trim() ? nodes.raw.create(null, schema.text(text)) : null
    }
    default:
      return node
  }
}

function canonCalloutAttrs(kind: unknown, icon: unknown): { kind: string; icon: string | null } {
  const k = typeof kind === 'string' && (CALLOUT_KINDS as readonly string[]).includes(kind) ? kind : 'NOTE'
  let i = typeof icon === 'string' ? icon.trim() : ''
  if (/--|>|[\r\n]/.test(i)) i = ''
  return { kind: k, icon: i || null }
}

function canonLanguage(language: string): string {
  const t = language.replace(/[\r\n]+/g, ' ').trim()
  const m = /^(\S+)\s+([\s\S]*)$/.exec(t)
  return m ? `${m[1]} ${m[2]}` : t
}

/** A paragraph's canonical inline content that is a File / Link to page block (5). */
function aloneLinkBlock(inline: readonly PMNode[]): PMNode | null {
  if (inline.length !== 1) return null
  const only = inline[0]
  if (!only.isText || only.marks.length !== 1 || only.marks[0].type !== marks.link) return null
  const link = only.marks[0]
  const kind = aloneLinkKind(link.attrs.href as string, link.attrs.title as string | null)
  if (kind === 'file') return nodes.file.create({ href: link.attrs.href as string, name: only.text ?? '' })
  if (kind === 'page_link') return nodes.page_link.create({ href: link.attrs.href as string, title: only.text ?? '' })
  return null
}

function canonListItem(item: PMNode): PMNode {
  const rawChecked = item.attrs.checked as unknown
  const checked = rawChecked === true ? true : rawChecked === false ? false : null
  let firstInline: PMNode[] = []
  const restNodes: PMNode[] = []
  item.forEach((child, _offset, index) => {
    if (index === 0 && child.type === nodes.paragraph) {
      firstInline = canonInline(child.content, { breaks: true, cell: false })
    } else {
      restNodes.push(child)
    }
  })
  const rest = canonBlocks(Fragment.fromArray(restNodes))
  const alone = aloneLinkBlock(firstInline)
  if (alone) {
    firstInline = []
    rest.unshift(alone)
  }
  if (firstInline.length === 0 && checked === null && rest.length > 0 && rest[0].type === nodes.paragraph) {
    firstInline = nodesOf(rest.shift() as PMNode)
  }
  return nodes.list_item.create({ checked }, [nodes.paragraph.create(null, firstInline), ...rest])
}

function nodesOf(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((c) => out.push(c))
  return out
}

function canonTable(table: PMNode): PMNode | null {
  const rows: PMNode[][] = []
  let width = 0
  table.forEach((row) => {
    const cells: PMNode[] = []
    row.forEach((cell) => cells.push(cell))
    rows.push(cells)
    width = Math.max(width, cells.length)
  })
  if (width === 0 || rows.length === 0) return null
  const aligns: (string | null)[] = []
  for (let c = 0; c < width; c++) {
    const a = rows[0][c]?.attrs.align as unknown
    aligns.push(a === 'left' || a === 'center' || a === 'right' ? a : null)
  }
  const outRows = rows.map((cells, r) => {
    const type = r === 0 ? nodes.table_header : nodes.table_cell
    const outCells: PMNode[] = []
    for (let c = 0; c < width; c++) {
      const cell = cells[c]
      const inline = cell ? canonInline(cell.content, { breaks: false, cell: true }) : []
      outCells.push(type.create({ align: aligns[c] }, inline))
    }
    return nodes.table_row.create(null, outCells)
  })
  return nodes.table.create(null, outRows)
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!a[i].eq(b[i])) return false
  return true
}

function canonMarks(set: readonly Mark[]): readonly Mark[] {
  let changed = false
  const out: Mark[] = []
  for (const m of set) {
    if ((m.type === marks.color || m.type === marks.bg) && !isNotionColor(m.attrs.color)) {
      changed = true
      continue
    }
    if (m.type === marks.link && (m.attrs.title === '' || /[\r\0]/.test(String(m.attrs.href)) || /[\r\0]/.test(String(m.attrs.title ?? '')))) {
      changed = true
      const title = m.attrs.title ? normalizeText(String(m.attrs.title)) : null
      out.push(marks.link.create({ href: normalizeText(String(m.attrs.href)), title }))
      continue
    }
    out.push(m)
  }
  return changed ? out : set
}

/** Canonical inline content (text nodes and hard breaks) as a node array. */
function canonInline(content: Fragment, opts: { breaks: boolean; cell: boolean }): PMNode[] {
  const items: { text: string | null; marks: readonly Mark[] }[] = []
  content.forEach((child) => {
    if (child.isText) {
      let text = normalizeText(child.text ?? '')
      const ms = canonMarks(child.marks)
      if (marks.code.isInSet(ms)) {
        text = text.replace(/\n/g, ' ')
        if (opts.cell) text = text.replace(/(\\+)(?=\|)/g, (run: string) => (run.length % 2 === 1 ? `${run}\\` : run))
      }
      if (text) items.push({ text, marks: ms })
    } else if (child.type === nodes.hard_break && opts.breaks) {
      items.push({ text: null, marks: [] })
    }
  })
  while (items.length > 0 && items[items.length - 1].text === null) items.pop()
  const out: PMNode[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.text !== null) {
      const prev = out[out.length - 1]
      if (prev && prev.isText && sameMarks(prev.marks, it.marks)) {
        out[out.length - 1] = schema.text((prev.text ?? '') + it.text, prev.marks)
      } else {
        out.push(schema.text(it.text, it.marks))
      }
      continue
    }
    out.push(nodes.hard_break.create(null, null, sharedAround(items, i)))
  }
  return out
}

/**
 * The marks of the break at `i`: going from the outermost mark type inwards (the order marks are
 * nested in when written), the marks the nearest texts on both sides share, up to the first
 * type where they differ. So the break is always strictly inside every span it is in —
 * emphasis cannot close right after a line break.
 */
function sharedAround(items: { text: string | null; marks: readonly Mark[] }[], i: number): readonly Mark[] {
  let a = i - 1
  while (a >= 0 && items[a].text === null) a--
  let b = i + 1
  while (b < items.length && items[b].text === null) b++
  if (a < 0 || b >= items.length) return []
  const out: Mark[] = []
  for (const type of MARK_LEVELS) {
    const before = type.isInSet(items[a].marks)
    const after = type.isInSet(items[b].marks)
    if (!before && !after) continue
    if (!before || !after || !before.eq(after)) break
    out.push(before)
  }
  return out
}

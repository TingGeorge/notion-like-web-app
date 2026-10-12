/**
 * Markdown → editor document (§3.4). The mdast tree (with positions) is converted block by
 * block. A top-level block that contains anything the editor does not understand, anywhere
 * inside it, becomes one `raw` node holding its exact source (DATA-15).
 */
import type { Mark, Node as PMNode } from 'prosemirror-model'
import type { Blockquote, List, ListItem, Paragraph, PhrasingContent, RootContent, Table } from 'mdast'
import { CALLOUT_KINDS, schema, type CalloutKind } from '../schema'
import { canonicalize } from './canonicalize'
import { aloneLinkKind } from './hrefs'
import { isDetailsClose, looksLikeDetailsOpen, parseDetailsOpen, parseIconComment, parseInlineTag, type InlineTagName } from './html'
import { parseMdastPiece, parseTopLevel } from './mdast'

const nodes = schema.nodes
const marks = schema.marks

/** The mark each HTML inline tag stands for. */
const TAG_MARKS = {
  u: marks.underline,
  strong: marks.bold,
  b: marks.bold,
  em: marks.italic,
  i: marks.italic,
  del: marks.strike,
  s: marks.strike,
} as const

/** Thrown for anything the editor does not understand; the top-level block becomes raw. */
class Unsupported extends Error {}

const unsupported = (): never => {
  throw new Unsupported()
}

/** Normalise line endings and NUL the way the serializer and micromark see them. */
export function normalizeSource(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\0/g, '�')
}

interface Ctx {
  /** The whole (normalised) body. */
  text: string
  /** Offset of the chunk the current nodes were parsed in. */
  base: number
}

function emptyParagraph(): PMNode {
  return nodes.paragraph.create()
}

export function rawNode(text: string): PMNode {
  return nodes.raw.create(null, text ? schema.text(text) : null)
}

function startOf(node: RootContent, ctx: Ctx): number {
  return ctx.base + (node.position?.start.offset ?? 0)
}

function endOf(node: RootContent, ctx: Ctx): number {
  return ctx.base + (node.position?.end.offset ?? 0)
}

function sourceOf(node: RootContent, ctx: Ctx): string {
  return ctx.text.slice(startOf(node, ctx), endOf(node, ctx))
}

/** Move an offset back to the start of its line when only spaces or tabs precede it. */
function lineStart(text: string, offset: number): number {
  let i = offset
  while (i > 0 && (text.charCodeAt(i - 1) === 32 || text.charCodeAt(i - 1) === 9)) i--
  return i === 0 || text.charCodeAt(i - 1) === 10 ? i : offset
}

/** Parse a page body. Never throws. */
export function parseBody(body: string, chunkTarget?: number): PMNode {
  const text = normalizeSource(body)
  try {
    const top = parseTopLevel(text, false, chunkTarget)
    const blocks: PMNode[] = []
    let i = 0
    while (i < top.length) {
      const { node, base } = top[i]
      const ctx: Ctx = { text, base }
      if (node.type === 'html' && looksLikeDetailsOpen(node.value)) {
        const close = findDetailsClose(
          top.map((t) => t.node),
          i,
        )
        if (close !== -1) {
          const closeCtx: Ctx = { text, base: top[close].base }
          try {
            // Each node keeps its own chunk offset.
            const inner = top.slice(i + 1, close)
            blocks.push(convertToggle(node.value, inner.map((t) => ({ node: t.node, ctx: { text, base: t.base } }))))
          } catch (e) {
            if (!(e instanceof Unsupported)) throw e
            blocks.push(rawNode(text.slice(lineStart(text, startOf(node, ctx)), endOf(top[close].node, closeCtx))))
          }
          i = close + 1
          continue
        }
      }
      try {
        blocks.push(convertBlock(node, ctx, true))
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e
        blocks.push(rawNode(text.slice(lineStart(text, startOf(node, ctx)), endOf(node, ctx))))
      }
      i++
    }
    return canonicalize(nodes.doc.create(null, blocks.length > 0 ? blocks : [emptyParagraph()]))
  } catch {
    // Last resort (a bug): keep the whole body as one Markdown block rather than lose it.
    const trimmed = text.replace(/\s+$/, '')
    return nodes.doc.create(null, trimmed ? [rawNode(trimmed)] : [emptyParagraph()])
  }
}

/** Index of the `</details>` that closes the `<details>` at `open` among siblings, or -1. */
function findDetailsClose(siblings: readonly RootContent[], open: number): number {
  let depth = 0
  for (let j = open; j < siblings.length; j++) {
    const n = siblings[j]
    if (n.type !== 'html') continue
    if (looksLikeDetailsOpen(n.value)) depth++
    else if (isDetailsClose(n.value)) {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

interface Located {
  node: RootContent
  ctx: Ctx
}

function convertToggle(openHtml: string, inner: Located[]): PMNode {
  const summary = parseDetailsOpen(openHtml)
  if (summary === null) unsupported()
  const children = convertFlow(inner)
  return nodes.toggle.create(null, [
    nodes.toggle_summary.create(null, summary ? schema.text(summary) : null),
    ...children,
  ])
}

/** Convert the children of a container (list item, quote, callout, toggle): nested blocks. */
function convertFlow(items: Located[]): PMNode[] {
  const out: PMNode[] = []
  let i = 0
  while (i < items.length) {
    const { node, ctx } = items[i]
    if (node.type === 'html' && looksLikeDetailsOpen(node.value)) {
      const close = findDetailsClose(
        items.map((t) => t.node),
        i,
      )
      if (close === -1) unsupported()
      out.push(convertToggle(node.value, items.slice(i + 1, close)))
      i = close + 1
      continue
    }
    out.push(convertBlock(node, ctx, false))
    i++
  }
  return out
}

function located(children: readonly RootContent[], ctx: Ctx): Located[] {
  return children.map((node) => ({ node, ctx }))
}

function convertBlock(node: RootContent, ctx: Ctx, top: boolean): PMNode {
  switch (node.type) {
    case 'paragraph':
      return convertParagraph(node, ctx)
    case 'heading':
      if (node.depth > 3) unsupported()
      return nodes.heading.create({ level: node.depth }, convertInline(node.children, ctx, false))
    case 'thematicBreak':
      return nodes.horizontal_rule.create()
    case 'code': {
      const language = [node.lang, node.meta].filter((s) => s).join(' ')
      return nodes.code_block.create({ language }, node.value ? schema.text(node.value) : null)
    }
    case 'blockquote':
      return convertBlockquote(node, ctx, top)
    case 'list':
      return convertList(node, ctx)
    case 'table':
      return convertTable(node, ctx)
    default:
      // html (other than toggles), math, footnote and link definitions, …
      return unsupported()
  }
}

/** An image, file or page link alone in a paragraph, as its block node; else null. */
function aloneBlock(children: readonly PhrasingContent[]): PMNode | null {
  if (children.length !== 1) return null
  const c = children[0]
  if (c.type === 'image') {
    return nodes.image.create({ src: c.url, alt: c.alt ?? '', title: c.title || null })
  }
  if (c.type === 'link' && c.children.every((k) => k.type === 'text')) {
    const kind = aloneLinkKind(c.url, c.title ?? null)
    if (kind === null) return null
    const text = c.children.map((k) => (k.type === 'text' ? k.value : '')).join('')
    return kind === 'file'
      ? nodes.file.create({ href: c.url, name: text })
      : nodes.page_link.create({ href: c.url, title: text })
  }
  return null
}

function convertParagraph(node: Paragraph, ctx: Ctx): PMNode {
  return aloneBlock(node.children) ?? nodes.paragraph.create(null, convertInline(node.children, ctx, true))
}

/** Inline content → text nodes with marks. Inline HTML may only be the mark tags. */
function convertInline(children: readonly PhrasingContent[], _ctx: Ctx, allowBreak: boolean): PMNode[] {
  const out: PMNode[] = []
  /** Marks opened by `<u>` / `<span>` tags, innermost last. */
  const open: { tag: InlineTagName; marks: Mark[] }[] = []
  const withHtml = (base: readonly Mark[]): readonly Mark[] => {
    let set = base
    for (const entry of open) for (const m of entry.marks) set = m.addToSet(set)
    return set
  }
  const walk = (list: readonly PhrasingContent[], active: readonly Mark[]): void => {
    for (const n of list) {
      switch (n.type) {
        case 'text':
          if (n.value) out.push(schema.text(n.value, withHtml(active)))
          break
        case 'strong':
          walk(n.children, marks.bold.create().addToSet(active))
          break
        case 'emphasis':
          walk(n.children, marks.italic.create().addToSet(active))
          break
        case 'delete':
          walk(n.children, marks.strike.create().addToSet(active))
          break
        case 'inlineCode':
          if (n.value) out.push(schema.text(n.value, marks.code.create().addToSet(withHtml(active))))
          break
        case 'link':
          if (n.children.length === 0) unsupported()
          walk(n.children, marks.link.create({ href: n.url, title: n.title || null }).addToSet(active))
          break
        case 'break':
          if (!allowBreak) unsupported()
          out.push(nodes.hard_break.create(null, null, withHtml(active)))
          break
        case 'html': {
          const tag = parseInlineTag(n.value)
          if (!tag) return unsupported()
          if (tag.kind === 'open') {
            open.push({ tag: tag.name, marks: [TAG_MARKS[tag.name].create()] })
          } else if (tag.kind === 'span-open') {
            const ms: Mark[] = []
            if (tag.bg) ms.push(marks.bg.create({ color: tag.bg }))
            if (tag.color) ms.push(marks.color.create({ color: tag.color }))
            open.push({ tag: 'span', marks: ms })
          } else {
            let k = open.length - 1
            while (k >= 0 && open[k].tag !== tag.name) k--
            if (k < 0) unsupported()
            open.splice(k, 1)
          }
          break
        }
        default:
          // image (not alone), inlineMath, footnoteReference, linkReference, imageReference
          unsupported()
      }
    }
  }
  walk(children, [])
  if (open.length > 0) unsupported()
  return out
}

function convertBlockquote(node: Blockquote, ctx: Ctx, top: boolean): PMNode {
  if (top) {
    const callout = convertCallout(node, ctx)
    if (callout) return callout
  }
  const content = convertFlow(located(node.children, ctx))
  return nodes.blockquote.create(null, content.length > 0 ? content : [emptyParagraph()])
}

const CALLOUT_MARKER = /^\[!(note|tip|important|warning|caution)\](\n|$)/i

/** DATA-12: a top-level quote whose first line is `[!KIND]` (written literally). */
function convertCallout(node: Blockquote, ctx: Ctx): PMNode | null {
  const first = node.children[0]
  if (!first || first.type !== 'paragraph') return null
  const head = first.children[0]
  if (!head || head.type !== 'text') return null
  const m = CALLOUT_MARKER.exec(head.value)
  if (!m) return null
  // The marker must be written as is: `\[!NOTE]` is a quote that starts with the text.
  const marker = `[!${m[1]}]`
  if (ctx.text.slice(startOf(first, ctx), startOf(first, ctx) + marker.length) !== marker) return null
  const kind = m[1].toUpperCase() as CalloutKind
  if (!(CALLOUT_KINDS as readonly string[]).includes(kind)) return null
  let rest = node.children.slice(1)
  const content: PMNode[] = []
  let icon: string | null = null
  if (m[2] === '\n') {
    // The first content paragraph shares the marker's paragraph.
    const remaining = head.value.slice(m[0].length)
    const inline: PhrasingContent[] = [
      ...(remaining ? [{ ...head, value: remaining }] : []),
      ...first.children.slice(1),
    ]
    if (inline.length > 0) {
      content.push(aloneBlock(inline) ?? nodes.paragraph.create(null, convertInline(inline, ctx, true)))
    }
  } else {
    if (first.children.length !== 1) return null
    const next = rest[0]
    if (next && next.type === 'html') {
      const parsed = parseIconComment(next.value)
      if (parsed !== null) {
        icon = parsed
        rest = rest.slice(1)
      }
    }
  }
  content.push(...convertFlow(located(rest, ctx)))
  return nodes.callout.create({ kind, icon }, content.length > 0 ? content : [emptyParagraph()])
}

function convertList(node: List, ctx: Ctx): PMNode {
  const items = node.children.map((item) => convertListItem(item, ctx))
  return node.ordered
    ? nodes.ordered_list.create({ start: node.start ?? 1 }, items)
    : nodes.bullet_list.create(null, items)
}

const EMPTY_TODO = /^\[([ xX])\]$/

function convertListItem(item: ListItem, ctx: Ctx): PMNode {
  let checked: boolean | null = item.checked ?? null
  const kids = item.children
  let first = emptyParagraph()
  const content: PMNode[] = []
  let rest = kids
  const head = kids[0]
  if (head && head.type === 'paragraph') {
    rest = kids.slice(1)
    const todo = checked === null ? EMPTY_TODO.exec(sourceOf(head, ctx)) : null
    if (todo) {
      // `- [ ]` with no text: GFM does not see a task there, the editor does (an empty to-do).
      checked = todo[1] !== ' '
    } else {
      const alone = aloneBlock(head.children)
      if (alone) content.push(alone)
      else first = nodes.paragraph.create(null, convertInline(head.children, ctx, true))
    }
  }
  content.push(...convertFlow(located(rest, ctx)))
  return nodes.list_item.create({ checked }, [first, ...content])
}

function convertTable(node: Table, ctx: Ctx): PMNode {
  const width = node.children[0]?.children.length ?? 0
  if (width === 0) unsupported()
  const rows = node.children.map((row, r) => {
    // GitHub drops cells past the header's width; keep such a table as it is.
    if (row.children.length > width) unsupported()
    const cells: PMNode[] = []
    for (let c = 0; c < width; c++) {
      const cell = row.children[c]
      const type = r === 0 ? nodes.table_header : nodes.table_cell
      cells.push(type.create({ align: node.align?.[c] ?? null }, cell ? convertInline(cell.children, ctx, false) : []))
    }
    return nodes.table_row.create(null, cells)
  })
  return nodes.table.create(null, rows)
}

/**
 * The inline content that `md` — one paragraph, one heading line, or one table cell's content —
 * reads back as, or null if it does not read back as that one container. Used by the
 * serializer to check its output.
 */
export function inlineFromMarkdown(kind: 'paragraph' | 'heading' | 'cell', md: string): PMNode[] | null {
  const source = kind === 'cell' ? `| ${md} |\n| --- |` : md
  try {
    const root = parseMdastPiece(source)
    if (root.children.length !== 1) return null
    const block = root.children[0]
    const ctx: Ctx = { text: source, base: 0 }
    if (kind === 'paragraph' && block.type === 'paragraph') return convertInline(block.children, ctx, true)
    if (kind === 'heading' && block.type === 'heading') return convertInline(block.children, ctx, false)
    if (kind === 'cell' && block.type === 'table') {
      return convertInline(block.children[0]?.children[0]?.children ?? [], ctx, false)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Like `inlineFromMarkdown` for many containers at once (one parse): the containers are written
 * one after the other, separated by blank lines. Null if they do not read back as as many
 * top-level blocks.
 */
export function inlineContentsFromMarkdown(
  items: readonly { kind: 'paragraph' | 'heading' | 'cell'; md: string }[],
): (PMNode[] | null)[] | null {
  const source = items.map((it) => (it.kind === 'cell' ? `| ${it.md} |\n| --- |` : it.md)).join('\n\n')
  try {
    const root = parseMdastPiece(source)
    if (root.children.length !== items.length) return null
    const ctx: Ctx = { text: source, base: 0 }
    return items.map((it, i) => {
      const block = root.children[i]
      try {
        if (it.kind === 'paragraph' && block.type === 'paragraph') return convertInline(block.children, ctx, true)
        if (it.kind === 'heading' && block.type === 'heading') return convertInline(block.children, ctx, false)
        if (it.kind === 'cell' && block.type === 'table') {
          return convertInline(block.children[0]?.children[0]?.children ?? [], ctx, false)
        }
      } catch {
        // unsupported: does not read back
      }
      return null
    })
  } catch {
    return null
  }
}

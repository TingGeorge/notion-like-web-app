/**
 * Block-level operations: what "turn into", "insert", "duplicate", "move" and "delete" mean for the
 * schema in `src/lib/schema.ts`. Everything here is pure (state in, transaction out) so it can be
 * unit-tested without a view.
 *
 * Vocabulary: a *block* is what the block handle grabs. That is a list item (with its children), a
 * toggle (summary + children), a quote or callout holding a single text block, or any other node
 * that is a child of the page, a toggle, a quote or a list item.
 */
import { Fragment, type Node as PMNode, type NodeType } from 'prosemirror-model'
import { NodeSelection, Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { isNotionColor, schema } from '../lib/schema'

const N = schema.nodes
const M = schema.marks

export type BlockKind =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'number'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'code'

export const CONVERTIBLE_KINDS: BlockKind[] = [
  'text',
  'h1',
  'h2',
  'h3',
  'todo',
  'bullet',
  'number',
  'toggle',
  'code',
  'quote',
  'callout',
]

export interface BlockRef {
  /** Position directly before the block node. */
  pos: number
  node: PMNode
  /** Null for blocks that cannot be converted (divider, image, table, …). */
  kind: BlockKind | null
}

export function kindOf(node: PMNode, parent?: PMNode | null): BlockKind | null {
  switch (node.type) {
    case N.paragraph:
      return 'text'
    case N.heading:
      return `h${node.attrs.level as number}` as BlockKind
    case N.list_item:
      if (node.attrs.checked !== null) return 'todo'
      return parent?.type === N.ordered_list ? 'number' : 'bullet'
    case N.toggle:
      return 'toggle'
    case N.blockquote:
      return 'quote'
    case N.callout:
      return 'callout'
    case N.code_block:
      return 'code'
    default:
      return null
  }
}

export function blockRefAt(doc: PMNode, pos: number): BlockRef | null {
  const node = doc.nodeAt(pos)
  if (!node) return null
  const $pos = doc.resolve(pos)
  return { pos, node, kind: kindOf(node, $pos.parent) }
}

/** The block the selection is in (see the vocabulary above). */
export function blockAtSelection(state: EditorState): BlockRef | null {
  return blockForSelection(state.doc, state.selection)
}

/** The block containing the text position nearest to `pos`. */
export function blockAtPos(doc: PMNode, pos: number): BlockRef | null {
  return blockForSelection(doc, Selection.near(doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))))
}

export function blockForSelection(doc: PMNode, sel: Selection): BlockRef | null {
  if (sel instanceof NodeSelection) {
    const $p = doc.resolve(sel.from)
    return { pos: sel.from, node: sel.node, kind: kindOf(sel.node, $p.parent) }
  }
  const $from = sel.$from
  let d = $from.depth
  while (d > 0 && !$from.node(d).isTextblock) d--
  if (d === 0) return null
  const tb = $from.node(d)
  if (tb.type === N.table_cell || tb.type === N.table_header) {
    // The table is two levels up (table > row > cell).
    const td = d - 2
    return td >= 1 ? { pos: $from.before(td), node: $from.node(td), kind: null } : null
  }
  const parent = $from.node(d - 1)
  if (tb.type === N.toggle_summary) {
    return { pos: $from.before(d - 1), node: parent, kind: 'toggle' }
  }
  if (parent.type === N.list_item && $from.index(d - 1) === 0) {
    const list = $from.node(d - 2)
    return { pos: $from.before(d - 1), node: parent, kind: kindOf(parent, list) }
  }
  if ((parent.type === N.blockquote || parent.type === N.callout) && parent.childCount === 1) {
    return { pos: $from.before(d - 1), node: parent, kind: kindOf(parent) }
  }
  return { pos: $from.before(d), node: tb, kind: kindOf(tb, parent) }
}

/** True if the block holds no text and no children (an empty line). */
export function isEmptyBlock(node: PMNode): boolean {
  switch (node.type) {
    case N.paragraph:
    case N.heading:
    case N.code_block:
      return node.content.size === 0
    case N.list_item:
      return node.childCount === 1 && node.firstChild!.content.size === 0
    case N.toggle:
      return node.childCount === 1 && node.firstChild!.content.size === 0
    case N.blockquote:
    case N.callout:
      return node.childCount === 1 && isEmptyBlock(node.firstChild!)
    default:
      return false
  }
}

// ---------------------------------------------------------------------------------------------
// Inline content conversion

function inlineToText(inline: Fragment, br: string): string {
  let s = ''
  inline.forEach((n) => {
    if (n.isText) s += n.text!
    else if (n.type === N.hard_break) s += br
  })
  return s
}

function textToInline(text: string): Fragment {
  const parts = text.split('\n')
  const nodes: PMNode[] = []
  parts.forEach((line, i) => {
    if (i > 0) nodes.push(N.hard_break.create())
    if (line) nodes.push(schema.text(line))
  })
  return Fragment.fromArray(nodes)
}

/** Inline content as the target block type allows it (headings: no breaks; code/summary: no marks). */
export function inlineFor(target: NodeType, inline: Fragment): Fragment {
  if (target === N.paragraph) return inline
  if (target === N.heading) {
    const out: PMNode[] = []
    inline.forEach((n) => out.push(n.type === N.hard_break ? schema.text(' ') : n))
    return Fragment.fromArray(out)
  }
  const text = inlineToText(inline, target === N.code_block ? '\n' : ' ')
  return text ? Fragment.from(schema.text(text)) : Fragment.empty
}

function paragraphInline(node: PMNode): Fragment {
  return node.type === N.code_block ? textToInline(node.textContent) : node.content
}

interface Extracted {
  inline: Fragment
  children: PMNode[]
}

function extract(node: PMNode): Extracted | null {
  switch (node.type) {
    case N.paragraph:
    case N.heading:
    case N.code_block:
      return { inline: paragraphInline(node), children: [] }
    case N.list_item:
    case N.toggle:
    case N.blockquote:
    case N.callout: {
      const first = node.firstChild
      if (!first) return null
      const children: PMNode[] = []
      node.forEach((c, _o, i) => {
        if (i > 0) children.push(c)
      })
      if (first.isTextblock) return { inline: paragraphInline(first), children }
      // A quote/callout that starts with a non-text block: keep everything as children.
      return { inline: Fragment.empty, children: [first, ...children] }
    }
    default:
      return null
  }
}

/** Build the node(s) for a kind from inline content and children. */
export function buildBlock(kind: BlockKind, inline: Fragment = Fragment.empty, children: PMNode[] = []): PMNode[] {
  const para = () => N.paragraph.create(null, inlineFor(N.paragraph, inline))
  switch (kind) {
    case 'text':
      return [para(), ...children]
    case 'h1':
    case 'h2':
    case 'h3':
      return [N.heading.create({ level: Number(kind[1]) }, inlineFor(N.heading, inline)), ...children]
    case 'code':
      return [N.code_block.create({ language: '' }, inlineFor(N.code_block, inline)), ...children]
    case 'bullet':
      return [N.bullet_list.create(null, N.list_item.create({ checked: null }, [para(), ...children]))]
    case 'todo':
      return [N.bullet_list.create(null, N.list_item.create({ checked: false }, [para(), ...children]))]
    case 'number':
      return [N.ordered_list.create({ start: 1 }, N.list_item.create({ checked: null }, [para(), ...children]))]
    case 'toggle':
      return [
        N.toggle.create({ open: children.length > 0 }, [
          N.toggle_summary.create(null, inlineFor(N.toggle_summary, inline)),
          ...children,
        ]),
      ]
    case 'quote':
      return [N.blockquote.create(null, [para(), ...children])]
    case 'callout':
      return [N.callout.create({ kind: 'NOTE', icon: null }, [para(), ...children])]
  }
}

// ---------------------------------------------------------------------------------------------
// Lists

/**
 * Replace (or insert around) one list item by splitting its list. `mode`:
 * - `replace`: the item is removed and `nodes` take its place between the two halves;
 * - `after`: the item stays in the first half and `nodes` follow it;
 * - `before`: the item stays in the second half and `nodes` precede it.
 * Returns the position of the first inserted node.
 */
export function splitListAt(tr: Transaction, itemPos: number, mode: 'replace' | 'after' | 'before', nodes: PMNode[]): number {
  const $p = tr.doc.resolve(itemPos)
  const list = $p.parent
  const index = $p.index()
  const listPos = $p.before()
  const cut = mode === 'before' ? index : mode === 'after' ? index + 1 : index
  const afterFrom = mode === 'replace' ? index + 1 : cut
  const items = (from: number, to: number) => {
    const out: PMNode[] = []
    for (let i = from; i < to; i++) out.push(list.child(i))
    return Fragment.fromArray(out)
  }
  const before = items(0, cut)
  const after = items(afterFrom, list.childCount)
  const out: PMNode[] = []
  if (before.childCount) out.push(list.type.create(list.attrs, before))
  let offset = 0
  for (const n of out) offset += n.nodeSize
  out.push(...nodes)
  if (after.childCount) out.push(list.type.create(list.type === N.ordered_list ? { start: 1 } : list.attrs, after))
  tr.replaceWith(listPos, listPos + list.nodeSize, out)
  return listPos + offset
}

/** DATA-16: Markdown cannot express two adjacent lists of one kind, so they are always one list. */
export function joinAdjacentLists(tr: Transaction): boolean {
  const joins: number[] = []
  const scan = (node: PMNode, contentStart: number) => {
    if (node.childCount < 2) return
    let offset = contentStart
    let prev: PMNode | null = null
    node.forEach((child) => {
      if (prev && prev.type === child.type && (child.type === N.bullet_list || child.type === N.ordered_list)) {
        joins.push(offset)
      }
      prev = child
      offset += child.nodeSize
    })
  }
  scan(tr.doc, 0)
  tr.doc.descendants((node, pos) => {
    if (!node.isTextblock && !node.isLeaf) scan(node, pos + 1)
  })
  for (let i = joins.length - 1; i >= 0; i--) tr.join(joins[i])
  return joins.length > 0
}

// ---------------------------------------------------------------------------------------------
// Turn into

/** Start (inside) position of the first textblock within `from..to`. */
function firstTextblockStart(doc: PMNode, from: number, to: number): number | null {
  let found: number | null = null
  doc.nodesBetween(from, to, (node, pos) => {
    if (found !== null) return false
    if (node.isTextblock) {
      found = pos + 1
      return false
    }
    return true
  })
  return found
}

function canHold(doc: PMNode, pos: number, nodes: PMNode[], replaceSize: number): boolean {
  const $p = doc.resolve(pos)
  return $p.parent.canReplace($p.index(), $p.index() + (replaceSize ? 1 : 0), Fragment.from(nodes))
}

/**
 * Convert the block `ref` to `kind`. Returns null when nothing would change or the conversion
 * is not possible here (callouts live only at the top level, DATA-13).
 */
export function turnIntoTr(state: EditorState, ref: BlockRef, kind: BlockKind): Transaction | null {
  if (ref.kind === null || ref.kind === kind) return null
  const { node, pos } = ref
  const doc = state.doc
  const $pos = doc.resolve(pos)
  const tr = state.tr

  // Cursor offset inside the block's first text block, restored afterwards.
  let offset: number | null = null
  const sel = state.selection
  if (sel instanceof TextSelection && sel.from >= pos && sel.from <= pos + node.nodeSize) {
    const start = firstTextblockStart(doc, pos, pos + node.nodeSize)
    const tbNode = start === null ? null : doc.resolve(start).parent
    if (start !== null && tbNode && sel.head >= start && sel.head <= start + tbNode.content.size) offset = sel.head - start
  }

  const place = (insertedFrom: number, insertedSize: number) => {
    if (offset === null) return
    const start = firstTextblockStart(tr.doc, insertedFrom, insertedFrom + insertedSize)
    if (start === null) return
    const tb = tr.doc.resolve(start).parent
    tr.setSelection(TextSelection.create(tr.doc, start + Math.min(offset, tb.content.size)))
  }

  // Containers swap in place (quote <-> callout) keeping their children.
  if ((node.type === N.blockquote || node.type === N.callout) && (kind === 'quote' || kind === 'callout')) {
    if (kind === 'callout' && $pos.parent.type !== N.doc) return null
    const replacement =
      kind === 'callout' ? N.callout.create({ kind: 'NOTE', icon: null }, node.content) : N.blockquote.create(null, node.content)
    tr.replaceWith(pos, pos + node.nodeSize, replacement)
    place(pos, replacement.nodeSize)
    return tr
  }

  const ex = extract(node)
  if (!ex) return null

  if (node.type === N.list_item) {
    const list = $pos.parent
    // Bullet <-> to-do inside one bulleted list is just the checkbox.
    if ((kind === 'todo' || kind === 'bullet') && list.type === N.bullet_list) {
      tr.setNodeMarkup(pos, null, { ...node.attrs, checked: kind === 'todo' ? false : null })
      return tr
    }
    if (kind === 'number' && list.type === N.ordered_list) return null
    if (kind === 'callout' && $pos.node($pos.depth - 1).type !== N.doc) return null
    const nodes = buildBlock(kind, ex.inline, ex.children)
    const from = splitListAt(tr, pos, 'replace', nodes)
    place(from, nodes.reduce((s, n) => s + n.nodeSize, 0))
    joinAdjacentLists(tr)
    return tr
  }

  if (kind === 'callout' && $pos.parent.type !== N.doc) return null
  const nodes = buildBlock(kind, ex.inline, ex.children)
  const size = nodes.reduce((s, n) => s + n.nodeSize, 0)
  if (!canHold(doc, pos, nodes, node.nodeSize)) return null
  tr.replaceWith(pos, pos + node.nodeSize, nodes)
  place(pos, size)
  joinAdjacentLists(tr)
  return tr
}

/** Turn the block at the selection into `kind`; true when something changed. */
export function turnIntoAtSelection(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  kind: BlockKind,
): boolean {
  const ref = blockAtSelection(state)
  if (!ref) return false
  const tr = turnIntoTr(state, ref, kind)
  if (!tr) return false
  dispatch?.(tr.scrollIntoView())
  return true
}

/** True when `kind` is possible for `ref` here (used to grey out menu rows). */
export function canTurnInto(state: EditorState, ref: BlockRef, kind: BlockKind): boolean {
  if (ref.kind === null) return false
  if (ref.kind === kind) return true
  return turnIntoTr(state, ref, kind) !== null
}

// ---------------------------------------------------------------------------------------------
// Insert

export function createTable(rows = 3, cols = 3): PMNode {
  const trs: PMNode[] = []
  for (let r = 0; r < rows; r++) {
    const cells: PMNode[] = []
    for (let c = 0; c < cols; c++) cells.push((r === 0 ? N.table_header : N.table_cell).createAndFill()!)
    trs.push(N.table_row.create(null, cells))
  }
  return N.table.create(null, trs)
}

/** Block nodes that need an empty paragraph after them so the caret can leave them. */
const NEEDS_TRAILING = new Set<NodeType>([
  N.horizontal_rule,
  N.image,
  N.file,
  N.page_link,
  N.table,
  N.code_block,
  N.raw,
  N.callout,
])

export function needsTrailingParagraph(node: PMNode | null | undefined): boolean {
  return !!node && NEEDS_TRAILING.has(node.type)
}

/**
 * Place `nodes` at `ref`: replacing it when `replace`, otherwise after it. Splits lists when the
 * nodes are not list items. Returns the position of the first inserted node.
 */
export function placeBlocks(tr: Transaction, ref: BlockRef | null, nodes: PMNode[], replace: boolean): number {
  if (!ref) {
    const at = tr.doc.content.size
    tr.insert(at, nodes)
    return at
  }
  if (ref.node.type === N.list_item) {
    return splitListAt(tr, ref.pos, replace ? 'replace' : 'after', nodes)
  }
  if (replace) {
    tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, nodes)
    return ref.pos
  }
  const at = ref.pos + ref.node.nodeSize
  tr.insert(at, nodes)
  return at
}

/**
 * Insert `nodes` as new block(s) at the selection: in place of an empty block, otherwise below the
 * current one. The caret moves into the first text block of the new nodes, or into the paragraph
 * after an atom (divider, image, …).
 */
export function insertBlocksTr(state: EditorState, nodes: PMNode[], opts: { forceAfter?: boolean } = {}): Transaction {
  const tr = state.tr
  const ref = blockAtSelection(state)
  const replace =
    !!ref && !opts.forceAfter && isEmptyBlock(ref.node) && (ref.node.type === N.paragraph || ref.node.type === N.list_item)
  const from = placeBlocks(tr, ref, nodes, replace)
  const size = nodes.reduce((s, n) => s + n.nodeSize, 0)
  const end = Math.min(tr.doc.content.size, from + size)
  const first = nodes[0]
  if (!first.isAtom && first.type !== N.horizontal_rule) {
    const start = firstTextblockStart(tr.doc, from, end)
    if (start !== null) tr.setSelection(TextSelection.create(tr.doc, start))
  } else {
    // Atom: the caret goes to the text after it; an empty paragraph is added when nothing follows.
    if (tr.doc.resolve(end).nodeAfter === null) tr.insert(end, N.paragraph.create())
    const sel = Selection.findFrom(tr.doc.resolve(end), 1, true)
    if (sel) tr.setSelection(sel)
  }
  joinAdjacentLists(tr)
  return tr.scrollIntoView()
}

// ---------------------------------------------------------------------------------------------
// Delete, duplicate, move

/** Remove the block at `pos`, also removing a parent that would be left empty. */
export function deleteBlockTr(tr: Transaction, pos: number): Transaction {
  for (;;) {
    const node = tr.doc.nodeAt(pos)
    if (!node) return tr
    const $p = tr.doc.resolve(pos)
    const parent = $p.parent
    if ($p.depth === 0 && parent.childCount === 1) {
      tr.replaceWith(pos, pos + node.nodeSize, N.paragraph.create())
      return tr
    }
    if (parent.childCount === 1 && $p.depth > 0) {
      pos = $p.before()
      continue
    }
    tr.delete(pos, pos + node.nodeSize)
    return tr
  }
}

/** Copy of the block directly after it. The selection follows into the copy. */
export function duplicateBlockTr(state: EditorState, ref: BlockRef): Transaction {
  const tr = state.tr
  const end = ref.pos + ref.node.nodeSize
  tr.insert(end, ref.node)
  const sel = state.selection
  if (sel.from >= ref.pos && sel.to <= end) {
    const delta = ref.node.nodeSize
    if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, sel.from + delta))
    else tr.setSelection(TextSelection.create(tr.doc, sel.anchor + delta, sel.head + delta))
  }
  return tr.scrollIntoView()
}

/** Swap the block with its previous (`-1`) or next (`1`) sibling. */
export function moveBlockTr(state: EditorState, ref: BlockRef, dir: -1 | 1): Transaction | null {
  const $p = state.doc.resolve(ref.pos)
  const index = $p.index()
  const parent = $p.parent
  const sibIndex = index + dir
  if (sibIndex < 0 || sibIndex >= parent.childCount) return null
  const sib = parent.child(sibIndex)
  if (parent.type === N.toggle && sibIndex === 0) return null // never above the summary
  const tr = state.tr
  const size = ref.node.nodeSize
  let delta: number
  if (dir === -1) {
    const at = ref.pos - sib.nodeSize
    tr.delete(ref.pos, ref.pos + size).insert(at, ref.node)
    delta = -sib.nodeSize
  } else {
    const at = ref.pos + size + sib.nodeSize
    tr.insert(at, ref.node).delete(ref.pos, ref.pos + size)
    delta = sib.nodeSize
  }
  const sel = state.selection
  if (sel.from >= ref.pos && sel.to <= ref.pos + size) {
    if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, sel.from + delta))
    else tr.setSelection(TextSelection.create(tr.doc, sel.anchor + delta, sel.head + delta))
  }
  return tr.scrollIntoView()
}

/**
 * Move the block at `srcPos` next to the block at `dstPos` (before or after it). Handles the list
 * cases: a list item dropped among page blocks gets its own list; a block dropped among list items
 * splits the list. Returns null for no-ops and for dropping a block into itself.
 */
export function moveBlockToTr(
  state: EditorState,
  srcPos: number,
  dstPos: number,
  where: 'before' | 'after',
): Transaction | null {
  const doc = state.doc
  const src = doc.nodeAt(srcPos)
  const dst = doc.nodeAt(dstPos)
  if (!src || !dst) return null
  const srcEnd = srcPos + src.nodeSize
  if (dstPos >= srcPos && dstPos < srcEnd) return null
  const dstEnd = dstPos + dst.nodeSize
  const $src = doc.resolve(srcPos)
  const $dst = doc.resolve(dstPos)
  // No-op: dropping right where it already is.
  if (where === 'before' && dstPos === srcEnd && $src.parent === $dst.parent) return null
  if (where === 'after' && dstEnd === srcPos && $src.parent === $dst.parent) return null

  const tr = state.tr
  let moving: PMNode[] = [src]
  if (src.type === N.list_item && dst.type !== N.list_item) {
    const list = $src.parent
    moving = [list.type.create(list.type === N.ordered_list ? { start: 1 } : list.attrs, src)]
  }
  const needsSplit = dst.type === N.list_item && src.type !== N.list_item
  if (needsSplit && src.type === N.callout && $dst.node($dst.depth - 1).type !== N.doc) return null

  let insertedAt: number
  if (needsSplit) {
    insertedAt = splitListAt(tr, dstPos, where === 'before' ? 'before' : 'after', moving)
  } else {
    insertedAt = where === 'before' ? dstPos : dstEnd
    const $at = doc.resolve(insertedAt)
    if (!$at.parent.canReplace($at.index(), $at.index(), Fragment.from(moving))) return null
    tr.insert(insertedAt, moving)
  }
  const afterInsert = tr.steps.length
  // Find the original again (positions shifted if the list was rebuilt) and remove it.
  const target = locateNode(tr.doc, src, tr.mapping.map(srcPos, -1), insertedAt, moving)
  if (target === null) return null
  deleteBlockTr(tr, target)
  joinAdjacentLists(tr)
  const at = tr.mapping.slice(afterInsert).map(insertedAt)
  const start = firstTextblockStart(tr.doc, at, Math.min(tr.doc.content.size, at + moving[0].nodeSize))
  if (start !== null) tr.setSelection(TextSelection.create(tr.doc, start))
  return tr.scrollIntoView()
}

/**
 * The original (not the moved copy) of `node`. A split rebuilds the list that held it, so match by
 * identity first (untouched nodes keep their identity), then by the closest equal node that is not
 * the freshly inserted copy.
 */
function locateNode(doc: PMNode, node: PMNode, near: number, insertedAt: number, moving: PMNode[]): number | null {
  const insertedEnd = insertedAt + moving.reduce((s, n) => s + n.nodeSize, 0)
  let identity: number | null = null
  let equal: number | null = null
  doc.descendants((n, pos) => {
    if (pos >= insertedAt && pos < insertedEnd) return false
    if (n === node && identity === null) identity = pos
    else if (n.eq(node) && (equal === null || Math.abs(pos - near) < Math.abs(equal - near))) equal = pos
    return identity === null
  })
  return identity ?? equal
}

// ---------------------------------------------------------------------------------------------
// Colours

export function parseColorSpec(spec: string): { type: 'color' | 'bg'; name: string } | null {
  const m = /^(color|bg):(.+)$/.exec(spec)
  if (!m) return null
  if (m[2] !== 'default' && !isNotionColor(m[2])) return null
  return { type: m[1] as 'color' | 'bg', name: m[2] }
}

export function applyColorRange(tr: Transaction, from: number, to: number, spec: string): boolean {
  const parsed = parseColorSpec(spec)
  if (!parsed) return false
  const markType = parsed.type === 'color' ? M.color : M.bg
  if (parsed.name === 'default') tr.removeMark(from, to, markType)
  else tr.addMark(from, to, markType.create({ color: parsed.name }))
  return true
}

export function applyColor(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, spec: string): boolean {
  const parsed = parseColorSpec(spec)
  if (!parsed) return false
  const markType = parsed.type === 'color' ? M.color : M.bg
  const tr = state.tr
  const sel = state.selection
  if (sel.empty) {
    // The next typed text gets the colour.
    const marks = state.storedMarks ?? sel.$from.marks()
    tr.setStoredMarks(
      parsed.name === 'default' ? markType.removeFromSet(marks) : markType.create({ color: parsed.name }).addToSet(marks),
    )
  } else {
    for (const r of sel.ranges) applyColorRange(tr, r.$from.pos, r.$to.pos, spec)
  }
  dispatch?.(tr)
  return true
}

/** The block's text range for whole-block colouring; null when its text cannot carry marks. */
export function blockTextRange(ref: BlockRef): [number, number] | null {
  const { node, pos } = ref
  switch (node.type) {
    case N.paragraph:
    case N.heading:
      return [pos + 1, pos + node.nodeSize - 1]
    case N.list_item:
      return [pos + 1, pos + 1 + node.firstChild!.nodeSize]
    case N.blockquote:
    case N.callout:
      return [pos + 1, pos + node.nodeSize - 1]
    default:
      return null
  }
}

/** The colour name when every text in the range has the same mark, else null. */
export function commonColor(doc: PMNode, from: number, to: number, type: 'color' | 'bg'): string | null {
  const markType = type === 'color' ? M.color : M.bg
  let value: string | null | undefined
  let mixed = false
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true
    const mark = markType.isInSet(node.marks)
    const v = mark ? (mark.attrs.color as string) : null
    if (value === undefined) value = v
    else if (value !== v) mixed = true
    return false
  })
  return mixed || value === undefined ? null : value
}

/** Colour names active at the selection (or shared by the whole range). */
export function activeColors(state: EditorState): { color: string | null; bg: string | null } {
  const { from, to, empty, $from } = state.selection
  if (empty) {
    const marks = state.storedMarks ?? $from.marks()
    return {
      color: (M.color.isInSet(marks)?.attrs.color as string | undefined) ?? null,
      bg: (M.bg.isInSet(marks)?.attrs.color as string | undefined) ?? null,
    }
  }
  return { color: commonColor(state.doc, from, to, 'color'), bg: commonColor(state.doc, from, to, 'bg') }
}

// ---------------------------------------------------------------------------------------------
// Block handle

/**
 * The block the handle belongs to for a point in the page (from `posAtCoords`): the deepest list
 * item, a child of a toggle, or a top-level block.
 */
export function handleBlockAt(doc: PMNode, hit: { pos: number; inside: number }): number | null {
  const atom = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null
  const $r = doc.resolve(atom?.isAtom ? hit.inside : hit.pos)
  if (atom?.isAtom) {
    if ($r.depth === 0) return hit.inside
    if ($r.parent.type === N.toggle && $r.index() >= 1) return hit.inside
  }
  for (let d = $r.depth; d >= 1; d--) {
    if ($r.node(d).type === N.list_item) return $r.before(d)
  }
  if ($r.depth >= 2 && $r.node(1).type === N.toggle && $r.index(1) >= 1) return $r.before(2)
  if ($r.depth >= 1) return $r.before(1)
  // Between top-level blocks.
  if ($r.nodeAfter) return $r.pos
  if ($r.nodeBefore) return $r.pos - $r.nodeBefore.nodeSize
  return null
}

/** `+` on the handle: an empty paragraph below the block. Returns the transaction and the caret position. */
export function addParagraphBelowTr(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos)
  if (!node) return null
  const tr = state.tr
  const para = N.paragraph.create()
  const ref: BlockRef = { pos, node, kind: kindOf(node, state.doc.resolve(pos).parent) }
  const from = placeBlocks(tr, ref, [para], false)
  tr.setSelection(TextSelection.create(tr.doc, from + 1))
  return tr.scrollIntoView()
}

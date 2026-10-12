/**
 * Editing commands bound to keys (SPEC §7.1). Notion-style Enter / Backspace / Tab behaviour.
 */
import { chainCommands, createParagraphNear, deleteSelection, joinBackward, liftEmptyBlock, selectNodeBackward, splitBlock } from 'prosemirror-commands'
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
import { Fragment, type Node as PMNode, type NodeType } from 'prosemirror-model'
import { NodeSelection, Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { goToNextCell } from 'prosemirror-tables'
import { schema } from '../lib/schema'
import {
  blockAtSelection,
  blockRefAt,
  duplicateBlockTr,
  moveBlockTr,
  turnIntoTr,
  type BlockKind,
} from './blocks'

const N = schema.nodes

/** The depth of the closest ancestor of the selection start with this type, or -1. */
function ancestorDepth(state: EditorState, type: NodeType): number {
  const $from = state.selection.$from
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === type) return d
  return -1
}

function atTextblockStart(state: EditorState): boolean {
  const sel = state.selection
  return sel instanceof TextSelection && sel.empty && sel.$from.parentOffset === 0
}

// --- Enter ------------------------------------------------------------------------------------

/** Enter in code and raw blocks inserts a newline. */
export const newlineInCodeBlock: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  if (!$from.parent.type.spec.code || !$from.sameParent($to)) return false
  dispatch?.(state.tr.insertText('\n').scrollIntoView())
  return true
}

/** ⌘Enter inside code: leave the block (new paragraph after it). */
export const exitCodeBlock: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!$from.parent.type.spec.code) return false
  const d = $from.depth
  const after = $from.after(d)
  const tr = state.tr.insert(after, N.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, after + 1))
  dispatch?.(tr.scrollIntoView())
  return true
}

/**
 * Enter in a toggle summary: at the end it opens the toggle and creates the first child; in the
 * middle the tail moves into the first child; an empty summary without children turns the toggle
 * into text.
 */
export const enterInToggleSummary: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type !== N.toggle_summary) return false
  const toggleDepth = $from.depth - 1
  const toggle = $from.node(toggleDepth)
  const togglePos = $from.before(toggleDepth)
  const summary = $from.parent
  if (summary.content.size === 0 && toggle.childCount === 1) {
    const ref = blockRefAt(state.doc, togglePos)
    const tr = ref && turnIntoTr(state, ref, 'text')
    if (!tr) return false
    dispatch?.(tr.scrollIntoView())
    return true
  }
  const tail = summary.content.cut($from.parentOffset)
  const tr = state.tr
  const summaryEnd = $from.end()
  if (tail.size) tr.delete($from.pos, summaryEnd)
  const childPos = tr.mapping.map(summaryEnd) + 1 // after the summary node's closing token
  const para = N.paragraph.create(null, tail)
  tr.insert(childPos, para)
  tr.setNodeMarkup(togglePos, null, { ...toggle.attrs, open: true })
  tr.setSelection(TextSelection.create(tr.doc, childPos + 1))
  dispatch?.(tr.scrollIntoView())
  return true
}

/** Split a list item; a new to-do starts unchecked. Empty items exit the list or outdent. */
export const enterInListItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty) return false
  const itemDepth = ancestorDepth(state, N.list_item)
  if (itemDepth < 0 || $from.depth !== itemDepth + 1) return false
  const item = $from.node(itemDepth)
  if ($from.index(itemDepth) !== 0) return false
  if ($from.parent.content.size === 0) {
    // Empty item: outdent when nested, otherwise leave the list.
    return liftListItem(N.list_item)(state, dispatch)
  }
  return splitListItem(N.list_item)(state, (tr) => {
    if (item.attrs.checked !== null) {
      // The new item is the one that now holds the cursor.
      const $h = tr.selection.$from
      for (let d = $h.depth; d > 0; d--) {
        if ($h.node(d).type === N.list_item) {
          tr.setNodeMarkup($h.before(d), null, { ...$h.node(d).attrs, checked: false })
          break
        }
      }
    }
    dispatch?.(tr)
  })
}

/** Shift+Enter: a line break where the schema allows one. */
export const insertHardBreak: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!$from.parent.canReplaceWith($from.parentOffset, $from.parentOffset, N.hard_break)) return true // swallow
  dispatch?.(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView())
  return true
}

/** Enter in a table cell: next row's cell, or nothing. */
export const enterInTableCell: Command = (state, dispatch) => {
  const { $from } = state.selection
  const d = $from.depth
  const cell = $from.node(d)
  if (cell.type !== N.table_cell && cell.type !== N.table_header) return false
  const rowDepth = d - 1
  const tableDepth = d - 2
  const row = $from.node(rowDepth)
  const table = $from.node(tableDepth)
  const col = $from.index(rowDepth)
  const rowIndex = $from.index(tableDepth)
  if (rowIndex + 1 >= table.childCount) return true
  let pos = $from.start(tableDepth)
  for (let i = 0; i <= rowIndex; i++) pos += table.child(i).nodeSize
  // pos is now the start of the next row (before it); step into it, then to column `col`.
  const nextRow = table.child(rowIndex + 1)
  let cellPos = pos + 1
  for (let i = 0; i < Math.min(col, nextRow.childCount - 1); i++) cellPos += nextRow.child(i).nodeSize
  void row
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, cellPos + 1)).scrollIntoView())
  return true
}

/** Enter with a block selected (Esc) goes back into its text. */
export const enterOnNodeSelection: Command = (state, dispatch) => {
  const sel = state.selection
  if (!(sel instanceof NodeSelection)) return false
  if (sel.node.isAtom) {
    // Divider, image, …: a new paragraph below.
    const tr = state.tr.insert(sel.to, N.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, sel.to + 1))
    dispatch?.(tr.scrollIntoView())
    return true
  }
  dispatch?.(state.tr.setSelection(Selection.near(state.doc.resolve(sel.to - 1), -1)).scrollIntoView())
  return true
}

export const splitBlockKeepEmptyAware: Command = chainCommands(createParagraphNear, liftEmptyBlock, splitBlock)

// --- Backspace --------------------------------------------------------------------------------

/**
 * Backspace at the start of a text block that has a "style" (heading, list item, code, toggle,
 * quote, callout) first turns it into plain text.
 */
export function backspaceToText(onExitTop?: () => boolean): Command {
  return (state, dispatch) => {
    if (!atTextblockStart(state)) return false
    const ref = blockAtSelection(state)
    if (!ref) return false
    const { $from } = state.selection
    if ($from.parent.type === N.table_cell || $from.parent.type === N.table_header) return true
    if (ref.kind && ref.kind !== 'text') {
      // Only when the caret is at the start of the block's own text.
      const tr = turnIntoTr(state, ref, 'text')
      if (tr) {
        dispatch?.(tr.scrollIntoView())
        return true
      }
      return false
    }
    // Plain paragraph at the very start of the page: hand over to the title.
    if (ref.kind === 'text' && state.doc.firstChild === ref.node && ref.pos === 0) {
      if (ref.node.content.size === 0 && state.doc.childCount > 1) return false // delete the empty first block normally
      return onExitTop?.() ?? false
    }
    return false
  }
}

// --- Tab --------------------------------------------------------------------------------------

export const indentListItem: Command = (state, dispatch) => {
  if (ancestorDepth(state, N.list_item) >= 0) {
    sinkListItem(N.list_item)(state, dispatch)
    return true
  }
  return false
}

export const outdentListItem: Command = (state, dispatch) => {
  if (ancestorDepth(state, N.list_item) >= 0) {
    liftListItem(N.list_item)(state, dispatch)
    return true
  }
  return false
}

export const tabInTable: (dir: 1 | -1) => Command = (dir) => goToNextCell(dir)

// --- Block commands ---------------------------------------------------------------------------

export const duplicateBlock: Command = (state, dispatch) => {
  const ref = blockAtSelection(state)
  if (!ref) return false
  dispatch?.(duplicateBlockTr(state, ref))
  return true
}

export const moveBlock =
  (dir: -1 | 1): Command =>
  (state, dispatch) => {
    const ref = blockAtSelection(state)
    if (!ref) return false
    const tr = moveBlockTr(state, ref, dir)
    if (!tr) return true
    dispatch?.(tr)
    return true
  }

/** Esc: select the block the caret is in. */
export const selectBlock: Command = (state, dispatch) => {
  if (state.selection instanceof NodeSelection) return false
  const ref = blockAtSelection(state)
  if (!ref) return false
  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, ref.pos)))
  return true
}

/** ⌘Enter: check a to-do, open or close a toggle. */
export const toggleCheckOrOpen: Command = (state, dispatch) => {
  const ref = blockAtSelection(state)
  if (!ref) return false
  if (ref.node.type === N.list_item && ref.node.attrs.checked !== null) {
    dispatch?.(state.tr.setNodeMarkup(ref.pos, null, { ...ref.node.attrs, checked: !ref.node.attrs.checked }))
    return true
  }
  if (ref.node.type === N.toggle) {
    dispatch?.(setToggleOpen(state.tr, ref.pos, !ref.node.attrs.open))
    return true
  }
  return false
}

/** UI-only change: not undoable and not reported through `onChange`. */
export function setToggleOpen(tr: Transaction, pos: number, open: boolean): Transaction {
  const node = tr.doc.nodeAt(pos)
  if (!node || node.type !== N.toggle) return tr
  tr.setNodeMarkup(pos, null, { ...node.attrs, open })
  tr.setMeta('addToHistory', false)
  tr.setMeta('gn-ui-only', true)
  if (!open) {
    // The caret must not stay in a hidden child.
    const sel = tr.selection
    const end = pos + node.nodeSize
    const summaryEnd = pos + 1 + node.firstChild!.nodeSize
    if (sel.from >= summaryEnd && sel.from < end) {
      tr.setSelection(TextSelection.create(tr.doc, summaryEnd - 1))
    }
  }
  return tr
}

export const KIND_SHORTCUT_ORDER: BlockKind[] = ['text', 'h1', 'h2', 'h3', 'todo', 'bullet', 'number', 'toggle', 'code']

/** Plain-text paragraphs for pasted text without Markdown. */
export function paragraphsFromText(text: string, breaks = false) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (breaks) {
    const nodes: PMNode[] = []
    lines.forEach((l, i) => {
      if (i > 0) nodes.push(N.hard_break.create())
      if (l) nodes.push(schema.text(l))
    })
    return Fragment.from(N.paragraph.create(null, nodes))
  }
  return Fragment.fromArray(lines.map((l) => N.paragraph.create(null, l ? schema.text(l) : undefined)))
}

/** The base Backspace chain after our own rules. */
export const baseBackspace: Command = chainCommands(deleteSelection, joinBackward, selectNodeBackward)

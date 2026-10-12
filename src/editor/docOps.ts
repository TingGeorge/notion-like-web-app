/**
 * Whole-document operations behind the imperative handle: `replaceDoc` (after a sync merge) and
 * `setContent` (page starters).
 */
import { Fragment, type Node as PMNode } from 'prosemirror-model'
import { Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { schema } from '../lib/schema'
import { withTrailingParagraph } from './normalize'

const N = schema.nodes

/** Carry the open/closed state of toggles over to a freshly loaded doc (matched by order and title). */
export function withToggleState(oldDoc: PMNode, newDoc: PMNode): PMNode {
  const olds: { text: string; open: boolean }[] = []
  oldDoc.descendants((n) => {
    if (n.type === N.toggle) olds.push({ text: n.firstChild?.textContent ?? '', open: !!n.attrs.open })
  })
  if (!olds.length) return newDoc
  let i = 0
  const walk = (node: PMNode): PMNode => {
    const idx = node.type === N.toggle ? i++ : -1
    const kids: PMNode[] = []
    let changed = false
    node.forEach((c) => {
      const m = walk(c)
      if (m !== c) changed = true
      kids.push(m)
    })
    let out = changed ? node.copy(Fragment.fromArray(kids)) : node
    const old = idx >= 0 ? olds[idx] : undefined
    if (old && old.text === (node.firstChild?.textContent ?? '') && !!node.attrs.open !== old.open) {
      out = out.type.create({ ...out.attrs, open: old.open }, out.content, out.marks)
    }
    return out
  }
  return walk(newDoc)
}

/**
 * SYNC-5: swap in new content, replacing only the part that differs. The caret stays at the same
 * top-level block index and text offset where its block was touched. Not undoable, no `onChange`.
 */
export function replaceDocTr(state: EditorState, incoming: PMNode): Transaction | null {
  const oldDoc = state.doc
  const next = withToggleState(oldDoc, withTrailingParagraph(incoming))
  const start = oldDoc.content.findDiffStart(next.content)
  if (start === null) return null
  const ends = oldDoc.content.findDiffEnd(next.content)
  if (!ends) return null
  let { a: endA, b: endB } = ends
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  const head = state.selection.head
  const $head = oldDoc.resolve(head)
  const blockIndex = $head.depth >= 1 ? $head.index(0) : 0
  const offset = $head.depth >= 1 ? head - $head.before(1) : 0

  let tr = state.tr.replace(start, endA, next.slice(start, endB))
  let from = start
  let to = endA
  if (!tr.doc.eq(next)) {
    // A replace that starts or ends inside a table or list can be "fitted" into a different
    // structure (cells moving to another row or table). Replace the differing top-level blocks
    // whole instead, which always gives exactly `next`.
    let i = 0
    while (i < oldDoc.childCount && i < next.childCount && oldDoc.child(i).eq(next.child(i))) i++
    let endOld = oldDoc.childCount
    let endNew = next.childCount
    while (endOld > i && endNew > i && oldDoc.child(endOld - 1).eq(next.child(endNew - 1))) {
      endOld--
      endNew--
    }
    from = 0
    for (let k = 0; k < i; k++) from += oldDoc.child(k).nodeSize
    to = from
    for (let k = i; k < endOld; k++) to += oldDoc.child(k).nodeSize
    const blocks: PMNode[] = []
    for (let k = i; k < endNew; k++) blocks.push(next.child(k))
    tr = state.tr.replaceWith(from, to, blocks)
  }
  tr.setMeta('addToHistory', false)
  tr.setMeta('gn-silent', true)

  if (head >= from && head <= to) {
    const index = Math.min(blockIndex, tr.doc.childCount - 1)
    let blockStart = 0
    for (let i = 0; i < index; i++) blockStart += tr.doc.child(i).nodeSize
    const block = tr.doc.child(index)
    const pos = blockStart + Math.min(offset, Math.max(block.nodeSize - 1, 0))
    const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size))
    tr.setSelection(Selection.near($pos, -1))
  }
  return tr
}

/** UI-10: put starter content at the top. An empty page is replaced; otherwise it is inserted first. */
export function setContentTr(state: EditorState, content: PMNode): Transaction {
  const doc = state.doc
  const empty = doc.childCount === 1 && doc.firstChild!.type === N.paragraph && doc.firstChild!.content.size === 0
  const tr = state.tr
  if (empty) tr.replaceWith(0, doc.content.size, content.content)
  else tr.insert(0, content.content)
  const end = content.content.size
  const sel = Selection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1)
  tr.setSelection(sel instanceof TextSelection ? sel : Selection.atStart(tr.doc))
  return tr.scrollIntoView()
}

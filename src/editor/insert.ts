/**
 * Insert a block chosen from the `/` menu or the iPhone insert sheet (UI-7).
 */
import type { EditorView } from 'prosemirror-view'
import { schema } from '../lib/schema'
import {
  blockAtSelection,
  buildBlock,
  createTable,
  insertBlocksTr,
  isEmptyBlock,
  turnIntoTr,
  type BlockKind,
} from './blocks'
import type { EditorContext } from './context'
import type { InsertItemId } from './slash'
import { insertFiles, pickFiles } from './upload'

const N = schema.nodes

const KIND_OF: Partial<Record<InsertItemId, BlockKind>> = {
  text: 'text',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  bullet: 'bullet',
  number: 'number',
  todo: 'todo',
  toggle: 'toggle',
  quote: 'quote',
  callout: 'callout',
  code: 'code',
}

/** Turn an empty block into `kind`, or add a new block of that kind below a block with content. */
function insertKind(view: EditorView, kind: BlockKind) {
  const { state } = view
  const ref = blockAtSelection(state)
  if (ref && isEmptyBlock(ref.node)) {
    if (ref.kind === kind) return
    const tr = turnIntoTr(state, ref, kind)
    if (tr) {
      view.dispatch(tr.scrollIntoView())
      return
    }
  }
  const nodes = buildBlock(kind)
  view.dispatch(insertBlocksTr(state, nodes, { forceAfter: !(ref && isEmptyBlock(ref.node)) }))
}

/**
 * Run an insert item. `range` is the `/query` text to remove first. Always ends with the editor
 * focused.
 */
export function runInsertItem(view: EditorView, id: InsertItemId, ctx: EditorContext, range?: { from: number; to: number }) {
  if (range) view.dispatch(view.state.tr.delete(range.from, range.to))
  const kind = KIND_OF[id]
  if (kind) {
    insertKind(view, kind)
  } else {
    switch (id) {
      case 'divider':
        view.dispatch(insertBlocksTr(view.state, [N.horizontal_rule.create()]))
        break
      case 'table':
        view.dispatch(insertBlocksTr(view.state, [createTable(3, 3)]))
        break
      case 'image':
      case 'file':
        // The picker must open inside this user gesture.
        void pickFiles(id === 'image' ? 'image/*' : '', true).then((files) => {
          if (files.length) void insertFiles(view, files, ctx)
        })
        break
      case 'link':
        ctx.ui.set({ link: { mode: 'block', anchor: caretRect(view) } })
        return
      case 'page':
        void ctx
          .services()
          .createChildPage()
          .then((page) => {
            if (view.isDestroyed) return
            view.dispatch(insertBlocksTr(view.state, [N.page_link.create({ href: page.href, title: page.title })]))
            view.focus()
          })
          .catch((e: unknown) => console.error(e))
        break
    }
  }
  view.focus()
}

export function caretRect(view: EditorView): DOMRect | null {
  try {
    const c = view.coordsAtPos(view.state.selection.head)
    return new DOMRect(c.left, c.top, Math.max(1, c.right - c.left), c.bottom - c.top)
  } catch {
    return null
  }
}

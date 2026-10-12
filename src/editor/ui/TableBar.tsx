import { createPortal } from 'react-dom'
import { BetweenHorizontalEnd, BetweenVerticalEnd, Columns3, Rows3, Trash2 } from 'lucide-react'
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable } from 'prosemirror-tables'
import type { Command } from 'prosemirror-state'
import { t } from '../../strings/zh-TW'
import { blockAtSelection } from '../blocks'
import { keepFocus, useEditorUI, useViewportTick } from './shared'
import { schema } from '../../lib/schema'

/** Row and column controls shown above a table while the caret is inside it. */
export function TableBar() {
  const { view } = useEditorUI()
  const ref = view.editable ? blockAtSelection(view.state) : null
  const inTable = !!ref && ref.node.type === schema.nodes.table
  useViewportTick(inTable)
  if (!ref || !inTable) return null
  const dom = view.nodeDOM(ref.pos)
  if (!(dom instanceof HTMLElement)) return null
  const r = dom.getBoundingClientRect()
  if (r.bottom < 0 || r.top > window.innerHeight) return null
  const run = (cmd: Command) => () => {
    cmd(view.state, view.dispatch)
    view.focus()
  }
  const buttons: { label: string; icon: React.ReactNode; cmd: Command; danger?: boolean }[] = [
    { label: t.editor.tableAddRow, icon: <BetweenHorizontalEnd size={16} />, cmd: addRowAfter },
    { label: t.editor.tableAddColumn, icon: <BetweenVerticalEnd size={16} />, cmd: addColumnAfter },
    { label: t.editor.tableDeleteRow, icon: <Rows3 size={16} />, cmd: deleteRow, danger: true },
    { label: t.editor.tableDeleteColumn, icon: <Columns3 size={16} />, cmd: deleteColumn, danger: true },
    { label: t.editor.deleteBlock, icon: <Trash2 size={16} />, cmd: deleteTable, danger: true },
  ]
  const top = r.top - 38 < 8 ? r.top + 6 : r.top - 38
  return createPortal(
    <div
      className="gn-toolbar gn-table-bar"
      role="toolbar"
      aria-label={t.editor.blocks.table}
      style={{ right: Math.max(8, window.innerWidth - r.right), top }}
      onMouseDown={keepFocus}
    >
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          className={b.danger ? 'gn-tb-btn is-danger' : 'gn-tb-btn'}
          aria-label={b.label}
          title={b.label}
          onClick={run(b.cmd)}
        >
          {b.icon}
        </button>
      ))}
    </div>,
    document.body,
  )
}

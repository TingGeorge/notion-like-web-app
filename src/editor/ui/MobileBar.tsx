import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bold,
  Camera,
  Code,
  Italic,
  KeyboardOff,
  Link as LinkIcon,
  List,
  Palette,
  Plus,
  Search,
  SquareCheck,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  X,
} from 'lucide-react'
import { undo } from 'prosemirror-history'
import { TextSelection } from 'prosemirror-state'
import { schema } from '../../lib/schema'
import { t } from '../../strings'
import { Sheet, cx } from '../../ui/primitives'
import { activeColors, blockAtSelection, canTurnInto, type BlockKind } from '../blocks'
import { focusKey } from '../decorations'
import { runInsertItem, caretRect } from '../insert'
import { SLASH_ITEMS, filterSlashItems } from '../slash'
import { insertFiles, pickFiles } from '../upload'
import { isMarkActive, lastColorParts, pickColor, toggleMarkByName, turnInto } from './actions'
import { EditorMenu } from './EditorMenu'
import { colorEntries, turnIntoEntries } from './menus'
import { ITEM_ICONS, keepFocus, useEditorUI, useUIState, useViewportTick, visibleViewport } from './shared'

const M = schema.marks

/** UI-12 / M04 / M09: the iPhone keyboard toolbar and the format bar that replaces it for a selection. */
export function MobileBar() {
  const { view, ctx } = useEditorUI()
  const ui = useUIState(ctx)
  const focused = focusKey.getState(view.state) ?? false
  const sheetOpen = ui.insertSheet || ui.mobileSheet !== null || ui.link !== null
  const visible = view.editable && (focused || sheetOpen)
  useViewportTick(visible)
  if (!visible) return null

  const sel = view.state.selection
  const formatting =
    sel instanceof TextSelection && !sel.empty && sel.$from.parent.inlineContent && sel.$from.parent.type.spec.marks !== ''
  const vp = visibleViewport()
  const keyboard = window.innerHeight - vp.height - vp.top > 80
  const style: React.CSSProperties = {
    left: vp.left,
    width: vp.width,
    bottom: Math.max(0, window.innerHeight - (vp.top + vp.height)),
    paddingBottom: keyboard ? 0 : 'env(safe-area-inset-bottom)',
  }
  const block = blockAtSelection(view.state)
  const toggleKind = (kind: BlockKind) => turnInto(view, block?.kind === kind ? 'text' : kind)
  const last = lastColorParts(ctx.services().getLastColor())

  const btn = (label: string, icon: React.ReactNode, onClick: () => void, opts: { active?: boolean; className?: string; id?: string } = {}) => (
    <button
      key={opts.id ?? label}
      type="button"
      className={cx('gn-kb-btn', opts.active && 'is-active', opts.className)}
      aria-label={label}
      aria-pressed={opts.active}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {icon}
    </button>
  )

  const done = () => {
    // Collapse the selection; the normal bar returns.
    const pos = view.state.selection.to
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    view.focus()
  }
  const hideKeyboard = () => {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    view.dom.blur()
  }
  const markBtn = (name: 'bold' | 'italic' | 'underline' | 'strike' | 'code', label: string, Icon: typeof Bold) =>
    btn(label, <Icon size={20} />, () => toggleMarkByName(view, name), { active: isMarkActive(view.state, M[name]) })

  return createPortal(
    <>
      <div className="gn-kbbar" role="toolbar" aria-label={t.editor.keyboardBar} style={style}>
        {formatting ? (
          <>
            {markBtn('bold', t.editor.bold, Bold)}
            {markBtn('italic', t.editor.italic, Italic)}
            {markBtn('underline', t.editor.underline, Underline)}
            {markBtn('strike', t.editor.strike, Strikethrough)}
            {markBtn('code', t.editor.inlineCode, Code)}
            {btn(t.editor.link, <LinkIcon size={20} />, () => ctx.ui.set({ link: { mode: 'mark', anchor: null }, toolbarMenu: 'link' }), {
              active: isMarkActive(view.state, M.link),
            })}
            {btn(
              t.editor.color,
              <span
                className="gn-tb-a is-bar"
                style={{
                  color: last?.type === 'color' ? `var(--palette-text-${last.name})` : undefined,
                  textDecorationColor: last?.type === 'color' ? `var(--palette-text-${last.name})` : undefined,
                }}
              >
                A
              </span>,
              () => ctx.ui.set({ mobileSheet: 'color' }),
              { id: 'color-a' },
            )}
            {btn(t.editor.color, <Palette size={20} />, () => ctx.ui.set({ mobileSheet: 'color' }))}
            <button
              type="button"
              className="gn-kb-done"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={done}
            >
              {t.common.done}
            </button>
          </>
        ) : (
          <>
            {btn(t.editor.insertBlock, <Plus size={22} />, () => ctx.ui.set({ insertSheet: true }))}
            {btn(t.editor.turnIntoShort, <Type size={22} />, () => ctx.ui.set({ mobileSheet: 'turnInto' }))}
            {btn(t.editor.blocks.todo, <SquareCheck size={22} />, () => toggleKind('todo'), { active: block?.kind === 'todo' })}
            {btn(t.editor.blocks.bullet, <List size={22} />, () => toggleKind('bullet'), { active: block?.kind === 'bullet' })}
            {btn(t.editor.camera, <Camera size={22} />, () => {
              void pickFiles('image/*').then((files) => {
                if (files.length) void insertFiles(view, files, ctx)
              })
            })}
            {btn(t.editor.link, <LinkIcon size={22} />, () => ctx.ui.set({ link: { mode: 'block', anchor: caretRect(view) } }))}
            {btn(t.editor.color, <Palette size={22} />, () => ctx.ui.set({ mobileSheet: 'color' }))}
            {btn(t.common.undo, <Undo2 size={22} />, () => {
              undo(view.state, view.dispatch)
              view.focus()
            })}
            {btn(t.editor.keyboardHide, <KeyboardOff size={22} />, hideKeyboard, { className: 'is-end' })}
          </>
        )}
      </div>
      <InsertSheet />
      <Sheet
        open={ui.mobileSheet === 'turnInto'}
        onClose={() => ctx.ui.set({ mobileSheet: null })}
        title={t.editor.turnIntoShort}
        className="gn-sheet"
      >
        <EditorMenu
          autoFocus={false}
          label={t.editor.turnIntoShort}
          entries={turnIntoEntries(
            block?.kind ?? null,
            (k) => !!block && canTurnInto(view.state, block, k),
            (k) => {
              ctx.ui.set({ mobileSheet: null })
              turnInto(view, k)
            },
          )}
        />
      </Sheet>
      <Sheet open={ui.mobileSheet === 'color'} onClose={() => ctx.ui.set({ mobileSheet: null })} title={t.editor.color} className="gn-sheet">
        <EditorMenu
          autoFocus={false}
          label={t.editor.color}
          entries={colorEntries(activeColors(view.state), (spec) => {
            ctx.ui.set({ mobileSheet: null })
            pickColor(view, ctx, spec)
          })}
        />
      </Sheet>
    </>,
    document.body,
  )
}

/** M06: the iPhone insert sheet, a grid of block types. */
function InsertSheet() {
  const { view, ctx } = useEditorUI()
  const ui = useUIState(ctx)
  const [query, setQuery] = useState('')
  const close = () => {
    ctx.ui.set({ insertSheet: false })
    setQuery('')
  }
  const items = filterSlashItems(query, SLASH_ITEMS)
  const sections: { id: 'basic' | 'media'; label: string }[] = [
    { id: 'basic', label: t.editor.basicBlocks },
    { id: 'media', label: t.editor.mediaBlocks },
  ]
  return (
    <Sheet open={ui.insertSheet} onClose={close} title={t.editor.insertBlock} className="gn-sheet gn-insert-sheet">
      <button type="button" className="gn-sheet-close" aria-label={t.common.close} onClick={close}>
        <X size={16} />
      </button>
      <label className="gn-sheet-search">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          placeholder={t.editor.searchBlocks}
          aria-label={t.editor.searchBlocks}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {items.length === 0 && <div className="gn-slash-empty">{t.editor.noMatch}</div>}
      {sections.map((s) => {
        const list = items.filter((i) => i.section === s.id)
        if (!list.length) return null
        return (
          <div key={s.id}>
            <div className="gn-sheet-section">{s.label}</div>
            <div className="gn-sheet-grid">
              {list.map((item) => {
                const Icon = ITEM_ICONS[item.id]
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="gn-sheet-item"
                    onClick={() => {
                      // Run first: the file picker has to open inside this tap.
                      runInsertItem(view, item.id, ctx)
                      close()
                    }}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </Sheet>
  )
}

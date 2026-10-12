import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bold, ChevronDown, Code, Italic, Link as LinkIcon, MoreHorizontal, Strikethrough, Trash2, Underline, Eraser } from 'lucide-react'
import { TextSelection } from 'prosemirror-state'
import { schema } from '../../lib/schema'
import { t } from '../../strings/zh-TW'
import { Popover, cx } from '../../ui/primitives'
import { activeColors, blockAtSelection, canTurnInto } from '../blocks'
import { focusKey } from '../decorations'
import { EditorMenu } from './EditorMenu'
import { colorEntries, turnIntoEntries } from './menus'
import { isMarkActive, lastColorParts, pickColor, toggleMarkByName, turnInto } from './actions'
import { keepFocus, useEditorUI, useUIState, useViewportTick, visibleViewport } from './shared'

const M = schema.marks

/** True while the pointer is down inside the editor (a drag selection in progress). */
function usePointerSelecting(root: HTMLElement) {
  const [down, setDown] = useState(false)
  useEffect(() => {
    const onDown = () => setDown(true)
    const onUp = () => setDown(false)
    root.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      root.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [root])
  return down
}

/** UI-8 / D04: the format toolbar above a non-empty text selection. */
export function FormatToolbar() {
  const { view, ctx, mobile } = useEditorUI()
  const ui = useUIState(ctx)
  const selecting = usePointerSelecting(view.dom)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const sel = view.state.selection
  const focused = focusKey.getState(view.state) ?? false
  const menuOpen = ui.toolbarMenu !== null
  const markable =
    sel instanceof TextSelection && !sel.empty && sel.$from.parent.inlineContent && !sel.$from.parent.type.spec.code && sel.$from.parent.type.spec.marks !== ''
  const visible = !mobile && view.editable && markable && !selecting && !view.composing && (focused || menuOpen)
  useViewportTick(visible)
  if (!visible) return null

  let a, b
  try {
    a = view.coordsAtPos(sel.from)
    b = view.coordsAtPos(sel.to)
  } catch {
    return null
  }
  const vp = visibleViewport()
  const WIDTH = 330
  const centre = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2
  const left = Math.max(vp.left + 8 + WIDTH / 2, Math.min(centre, vp.left + vp.width - 8 - WIDTH / 2))
  const aboveTop = Math.min(a.top, b.top) - 40
  const placeBelow = aboveTop < vp.top + 4
  const top = placeBelow ? Math.max(a.bottom, b.bottom) + 8 : aboveTop

  const block = blockAtSelection(view.state)
  const last = lastColorParts(ctx.services().getLastColor())
  const colors = activeColors(view.state)
  const close = () => {
    ctx.ui.set({ toolbarMenu: null })
    view.focus()
  }
  const open = (menu: 'turnInto' | 'color' | 'more', el: HTMLElement) => {
    setAnchorEl(el)
    ctx.ui.set({ toolbarMenu: ui.toolbarMenu === menu ? null : menu })
  }
  const markButton = (name: 'bold' | 'italic' | 'underline' | 'strike' | 'code', label: string, Icon: typeof Bold) => (
    <button
      key={name}
      type="button"
      className={cx('gn-tb-btn', isMarkActive(view.state, M[name]) && 'is-active')}
      aria-label={label}
      aria-pressed={isMarkActive(view.state, M[name])}
      title={label}
      onClick={() => toggleMarkByName(view, name)}
    >
      <Icon size={16} />
    </button>
  )
  const linkActive = isMarkActive(view.state, M.link)

  return createPortal(
    <>
      <div
        className="gn-toolbar is-centered"
        role="toolbar"
        aria-label={t.editor.formatToolbar}
        style={{ left, top }}
        onMouseDown={keepFocus}
      >
        <button
          type="button"
          className="gn-tb-btn gn-tb-text"
          aria-haspopup="menu"
          aria-expanded={ui.toolbarMenu === 'turnInto'}
          aria-label={t.editor.turnIntoShort}
          onClick={(e) => open('turnInto', e.currentTarget)}
        >
          <span>{t.editor.blocks.text}</span>
          <ChevronDown size={12} />
        </button>
        <span className="gn-tb-sep" />
        {markButton('bold', t.editor.bold, Bold)}
        {markButton('italic', t.editor.italic, Italic)}
        {markButton('underline', t.editor.underline, Underline)}
        {markButton('strike', t.editor.strike, Strikethrough)}
        {markButton('code', t.editor.inlineCode, Code)}
        <button
          type="button"
          className={cx('gn-tb-btn', linkActive && 'is-active')}
          aria-label={t.editor.link}
          aria-pressed={linkActive}
          title={t.editor.link}
          onClick={() => ctx.ui.set({ link: { mode: 'mark', anchor: null }, toolbarMenu: 'link' })}
        >
          <LinkIcon size={16} />
        </button>
        <span className="gn-tb-sep" />
        <button
          type="button"
          className="gn-tb-btn gn-tb-color"
          aria-haspopup="menu"
          aria-expanded={ui.toolbarMenu === 'color'}
          aria-label={t.editor.color}
          title={t.editor.color}
          onClick={(e) => open('color', e.currentTarget)}
        >
          <span
            className="gn-tb-a"
            style={{
              color: last?.type === 'color' ? `var(--palette-text-${last.name})` : undefined,
              background: last?.type === 'bg' ? `var(--palette-bg-${last.name})` : undefined,
            }}
          >
            A
          </span>
          <ChevronDown size={12} />
        </button>
        <span className="gn-tb-sep" />
        <button
          type="button"
          className="gn-tb-btn"
          aria-haspopup="menu"
          aria-label={t.common.more}
          title={t.common.more}
          onClick={(e) => open('more', e.currentTarget)}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      {ui.toolbarMenu === 'turnInto' && anchorEl && (
        <Popover anchor={anchorEl} onClose={close}>
          <EditorMenu
            label={t.editor.turnIntoShort}
            onClose={close}
            entries={turnIntoEntries(
              block?.kind ?? null,
              (k) => !!block && canTurnInto(view.state, block, k),
              (k) => {
                ctx.ui.set({ toolbarMenu: null })
                turnInto(view, k)
              },
            )}
          />
        </Popover>
      )}
      {ui.toolbarMenu === 'color' && anchorEl && (
        <Popover anchor={anchorEl} onClose={close} className="gn-color-popover">
          <EditorMenu
            label={t.editor.color}
            onClose={close}
            entries={colorEntries(colors, (spec) => {
              ctx.ui.set({ toolbarMenu: null })
              pickColor(view, ctx, spec)
            })}
          />
        </Popover>
      )}
      {ui.toolbarMenu === 'more' && anchorEl && (
        <Popover anchor={anchorEl} onClose={close} placement="bottom-end">
          <EditorMenu
            label={t.common.more}
            onClose={close}
            entries={[
              {
                key: 'clear',
                label: t.editor.clearFormat,
                icon: <Eraser size={16} />,
                onSelect: () => {
                  const { from, to } = view.state.selection
                  const tr = view.state.tr
                  for (const mark of Object.values(M)) tr.removeMark(from, to, mark)
                  view.dispatch(tr)
                  close()
                },
              },
              {
                key: 'delete',
                label: t.editor.deleteBlock,
                icon: <Trash2 size={16} />,
                danger: true,
                onSelect: () => {
                  view.dispatch(view.state.tr.deleteSelection())
                  close()
                },
              },
            ]}
          />
        </Popover>
      )}
    </>,
    document.body,
  )
}

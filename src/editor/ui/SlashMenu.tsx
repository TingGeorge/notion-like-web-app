import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../strings/zh-TW'
import { cx } from '../../ui/primitives'
import { filterSlashItems, slashKey, setSlashSelected, type SlashItem } from '../slash'
import { ITEM_ICONS, useEditorUI, useViewportTick, visibleViewport } from './shared'
import { runInsertItem } from '../insert'

const MENU_WIDTH = 270
/** D03: about eleven rows, then the list scrolls. */
const MENU_MAX_HEIGHT = 420

/** UI-7 / D03: the `/` menu at the caret. */
export function SlashMenu() {
  const { view, ctx } = useEditorUI()
  const st = slashKey.getState(view.state)
  useViewportTick(!!st)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const selected = st?.selected ?? 0
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, st?.query])
  if (!st) return null
  const items = filterSlashItems(st.query)
  const head = view.state.selection.head
  let caret: { left: number; top: number; bottom: number }
  try {
    caret = view.coordsAtPos(head)
  } catch {
    return null
  }
  const vp = visibleViewport()
  const left = Math.max(vp.left + 8, Math.min(caret.left, vp.left + vp.width - MENU_WIDTH - 8))
  const spaceBelow = vp.top + vp.height - caret.bottom
  const above = spaceBelow < 260 && caret.top - vp.top > spaceBelow
  const style: React.CSSProperties = above
    ? { left, bottom: window.innerHeight - caret.top + 6, maxHeight: Math.min(MENU_MAX_HEIGHT, caret.top - vp.top - 16) }
    : { left, top: caret.bottom + 6, maxHeight: Math.min(MENU_MAX_HEIGHT, spaceBelow - 16) }

  const choose = (item: SlashItem) => runInsertItem(view, item.id, ctx, { from: st.from, to: view.state.selection.head })

  const sections: { id: 'basic' | 'media'; label: string }[] = [
    { id: 'basic', label: t.editor.basicBlocks },
    { id: 'media', label: t.editor.mediaBlocks },
  ]
  let index = -1
  return createPortal(
    <div
      className="gn-slash"
      role="listbox"
      aria-label={t.editor.insertBlock}
      style={{ ...style, width: MENU_WIDTH }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="gn-slash-scroll">
        {items.length === 0 && <div className="gn-slash-empty">{t.editor.noMatch}</div>}
        {sections.map((section) => {
          const inSection = items.filter((i) => i.section === section.id)
          if (inSection.length === 0) return null
          return (
            <div key={section.id} role="group" aria-label={section.label}>
              <div className="menu-section">{section.label}</div>
              {inSection.map((item) => {
                index++
                const i = index
                const Icon = ITEM_ICONS[item.id]
                const active = i === selected
                return (
                  <button
                    key={item.id}
                    ref={active ? selectedRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={cx('menu-row', active && 'is-highlighted')}
                    onMouseMove={() => !active && setSlashSelected(view, i)}
                    onClick={() => choose(item)}
                  >
                    <span className="menu-icon">
                      <Icon size={16} />
                    </span>
                    <span className="menu-label">{item.label}</span>
                    {item.hint && <span className="menu-hint">{item.hint}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="gn-slash-footer">{t.editor.menuFooter}</div>
    </div>,
    document.body,
  )
}


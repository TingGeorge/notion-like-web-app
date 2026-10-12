import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cx } from '../../ui/primitives'

export type MenuEntry =
  | { type: 'section'; label: string }
  | { type: 'separator' }
  | {
      type?: 'item'
      key: string
      label: string
      icon?: ReactNode
      hint?: ReactNode
      checked?: boolean
      danger?: boolean
      disabled?: boolean
      submenu?: boolean
      onSelect: (el: HTMLElement) => void
    }

/**
 * A menu in the look of `Menu` from the shared primitives, with section labels and submenu rows.
 * Arrow keys move, Enter selects, → opens a submenu, Esc closes.
 */
export function EditorMenu({
  entries,
  onClose,
  className,
  label,
  autoFocus = true,
}: {
  entries: MenuEntry[]
  onClose?: () => void
  className?: string
  label?: string
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!autoFocus) return
    const el = ref.current
    const checked = el?.querySelector<HTMLElement>('[role=menuitem][data-checked=true]:not([disabled])')
    const first = checked ?? el?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')
    first?.focus({ preventScroll: true })
    checked?.scrollIntoView({ block: 'nearest' })
  }, [autoFocus])
  const onKeyDown = (e: React.KeyboardEvent) => {
    const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])
    const i = nodes.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      nodes[(i + 1) % nodes.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus()
    } else if (e.key === 'ArrowRight' && i >= 0 && nodes[i].dataset.submenu === 'true') {
      e.preventDefault()
      nodes[i].click()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }
  return (
    <div ref={ref} role="menu" aria-label={label} className={cx('menu', 'gn-menu', className)} onKeyDown={onKeyDown}>
      {entries.map((entry, i) => {
        if (entry.type === 'separator') return <div key={`sep-${i}`} className="menu-separator" role="separator" />
        if (entry.type === 'section')
          return (
            <div key={`sec-${i}`} className="menu-section" role="presentation">
              {entry.label}
            </div>
          )
        return (
          <button
            key={entry.key}
            type="button"
            role="menuitem"
            data-checked={entry.checked ? 'true' : undefined}
            data-submenu={entry.submenu ? 'true' : undefined}
            aria-haspopup={entry.submenu ? 'menu' : undefined}
            className={cx('menu-row', entry.danger && 'is-danger')}
            disabled={entry.disabled}
            onClick={(e) => entry.onSelect(e.currentTarget)}
          >
            {entry.icon && <span className="menu-icon">{entry.icon}</span>}
            <span className="menu-label">{entry.label}</span>
            {entry.hint && <span className="menu-hint">{entry.hint}</span>}
            {entry.checked && (
              <span className="menu-check" aria-hidden="true">
                ✓
              </span>
            )}
            {entry.submenu && <ChevronRight size={14} className="menu-chevron" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

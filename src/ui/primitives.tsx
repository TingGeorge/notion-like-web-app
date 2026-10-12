/**
 * Shared UI building blocks. Visual spec: Figma page 設計系統 → Components.
 * Styles live in `primitives.css`.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { t } from '../strings/zh-TW'
import './primitives.css'

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** NFR-3: icon-only buttons need a label for VoiceOver. */
  label: string
  size?: number
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 28, active, className, children, type = 'button', style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx('icon-btn', active && 'is-active', className)}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      {children}
    </button>
  )
})

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className, invalid, ...rest }, ref) {
    return <input ref={ref} className={cx('text-input', invalid && 'is-invalid', className)} {...rest} />
  },
)

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx('switch', checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

/** Locks body scroll and traps Tab focus inside `ref` while mounted. */
function useModalBehaviour(ref: React.RefObject<HTMLElement | null>, onClose: (() => void) | undefined) {
  // Callers pass a new `onClose` on every render; the effect below must run only once per mount,
  // or it would take the focus back from an input inside the dialog on every re-render.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  const closable = !!onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('[autofocus], [data-autofocus]')
    ;(first ?? el)?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closable) {
        e.stopPropagation()
        closeRef.current?.()
      } else if (e.key === 'Tab' && el) {
        const focusable = Array.from(
          el.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((n) => n.offsetParent !== null)
        if (focusable.length === 0) return
        const firstEl = focusable[0]
        const lastEl = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault()
          lastEl.focus()
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault()
          firstEl.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus?.({ preventScroll: true })
    }
  }, [ref, closable])
}

export interface ModalProps {
  open: boolean
  onClose?: () => void
  /** Accessible title; shown when `showTitle`. */
  title: string
  showTitle?: boolean
  width?: number | string
  className?: string
  children: ReactNode
  /** Show the ✕ button in the corner. */
  closeButton?: boolean
  /** Position near the top (like the search dialog) instead of centred. */
  top?: boolean
}

/** Centred dialog with a dimmed overlay (D06, D08, D10, D15). */
export function Modal({ open, onClose, title, showTitle, width = 480, className, children, closeButton, top }: ModalProps) {
  if (!open) return null
  return createPortal(
    <ModalInner onClose={onClose} title={title} showTitle={showTitle} width={width} className={className} closeButton={closeButton} top={top}>
      {children}
    </ModalInner>,
    document.body,
  )
}

function ModalInner({ onClose, title, showTitle, width, className, children, closeButton, top }: Omit<ModalProps, 'open'>) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalBehaviour(ref, onClose)
  return (
    <div className={cx('overlay', top && 'overlay-top')} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx('modal', className)}
        style={{ width }}
      >
        <h2 id={titleId} className={showTitle ? 'modal-title' : 'visually-hidden'}>
          {title}
        </h2>
        {closeButton && onClose && (
          <IconButton label={t.common.close} className="modal-close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        )}
        {children}
      </div>
    </div>
  )
}

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  showTitle?: boolean
  children: ReactNode
  className?: string
}

/** iPhone bottom sheet with a grabber (M06, M08, M20). */
export function Sheet({ open, onClose, title, showTitle = true, children, className }: SheetProps) {
  if (!open) return null
  return createPortal(
    <SheetInner onClose={onClose} title={title} showTitle={showTitle} className={className}>
      {children}
    </SheetInner>,
    document.body,
  )
}

function SheetInner({ onClose, title, showTitle, children, className }: Omit<SheetProps, 'open'>) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalBehaviour(ref, onClose)
  return (
    <div className="overlay overlay-sheet" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx('sheet', className)}>
        <div className="sheet-grabber" aria-hidden="true" />
        <h2 id={titleId} className={showTitle ? 'sheet-title' : 'visually-hidden'}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

export interface MenuItem {
  key: string
  label: string
  icon?: ReactNode
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  onSelect: () => void
}

/** A vertical menu (Menu/Row component). Arrow keys move, Enter selects. */
export function Menu({ items, onClose, className }: { items: (MenuItem | 'separator')[]; onClose?: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus()
  }, [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])
    const i = nodes.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      nodes[(i + 1) % nodes.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }
  return (
    <div ref={ref} role="menu" className={cx('menu', className)} onKeyDown={onKeyDown}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="menu-separator" role="separator" />
        ) : (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={cx('menu-row', item.danger && 'is-danger')}
            disabled={item.disabled}
            onClick={() => {
              // Close first: the action may open another overlay.
              onClose?.()
              item.onSelect()
            }}
          >
            {item.icon && <span className="menu-icon">{item.icon}</span>}
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
            {item.checked && <span className="menu-check">✓</span>}
          </button>
        ),
      )}
    </div>
  )
}

/**
 * A floating panel anchored to an element or a point; closes on outside click and Esc.
 * Positions itself below the anchor and flips/clamps to stay in the viewport.
 */
export function Popover({
  anchor,
  onClose,
  children,
  className,
  placement = 'bottom-start',
  offset = 6,
}: {
  anchor: HTMLElement | DOMRect | null
  onClose: () => void
  children: ReactNode
  className?: string
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start'
  offset?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !anchor) return
    const place = () => {
      const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      let left = placement === 'bottom-end' ? r.right - w : placement === 'right-start' ? r.right + offset : r.left
      let top = placement === 'top-start' ? r.top - h - offset : placement === 'right-start' ? r.top : r.bottom + offset
      if (top + h > vh - 8 && placement !== 'top-start') top = Math.max(8, r.top - h - offset)
      if (top < 8) top = 8
      left = Math.min(Math.max(8, left), vw - w - 8)
      el.style.left = `${left}px`
      el.style.top = `${top}px`
      el.style.visibility = 'visible'
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchor, placement, offset])
  useEffect(() => {
    // A dialog opened from inside the popover (a confirmation) lives in its own portal, after the
    // popover. While it is open, clicks and Esc are the dialog's.
    const dialogOnTop = () =>
      !!ref.current &&
      Array.from(document.querySelectorAll('.overlay')).some((o) => !!(ref.current!.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING))
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchor instanceof HTMLElement && anchor.contains(target)) return
      if (dialogOnTop()) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !dialogOnTop()) {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('touchstart', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('touchstart', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])
  return createPortal(
    <div ref={ref} className={cx('popover', className)} style={{ visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  )
}

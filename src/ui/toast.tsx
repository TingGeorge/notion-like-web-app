/**
 * UI-13: toasts confirm actions with no other visible result. Deletes and moves offer 復原 for 5 s.
 * Usage: `toast('已複製連結')` or `toast('已刪除「x」', { action: { label: '復原', run: undo } })`.
 */
import { useSyncExternalStore } from 'react'
import { t } from '../strings'
import './toast.css'

export interface ToastOptions {
  action?: { label: string; run: () => void }
  /** ms, default 3000, or 5000 with an action. */
  duration?: number
  tone?: 'default' | 'error'
}

interface ToastItem extends ToastOptions {
  id: number
  message: string
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function toast(message: string, options: ToastOptions = {}): void {
  const id = nextId++
  // Only the latest 復原 is offered: an older undo toast is replaced, so it can't be clicked by mistake.
  const kept = options.action ? items.filter((i) => !i.action) : items
  items = [...kept.slice(-2), { id, message, ...options }]
  emit()
  const duration = options.duration ?? (options.action ? 5000 : 3000)
  setTimeout(() => dismiss(id), duration)
}

/** A toast with 復原 (UI-13). */
export function toastWithUndo(message: string, undo: () => void): void {
  toast(message, { action: { label: t.common.undo, run: undo } })
}

export function dismiss(id: number): void {
  items = items.filter((i) => i.id !== id)
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items)
  return (
    <div className="toaster" role="status" aria-live="polite" data-print="hide">
      {list.map((item) => (
        <div key={item.id} className={`toast ${item.tone === 'error' ? 'is-error' : ''}`}>
          <span className="toast-message">{item.message}</span>
          {item.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                item.action?.run()
                dismiss(item.id)
              }}
            >
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

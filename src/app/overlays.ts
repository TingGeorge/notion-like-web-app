/** Which app-level dialog or panel is open. One at a time, like Notion. */
import { useSyncExternalStore } from 'react'

export type Overlay =
  | { kind: 'search'; query?: string }
  | { kind: 'settings'; section?: string }
  | { kind: 'history'; pageKey: string }
  | { kind: 'move'; pageKey: string }
  | { kind: 'trash'; anchor?: DOMRect }
  | { kind: 'link-device' }
  | { kind: 'conflict'; path: string }
  | { kind: 'page-menu'; pageKey: string; anchor?: DOMRect }
  | null

let current: Overlay = null
const listeners = new Set<() => void>()

export function openOverlay(next: Overlay): void {
  current = next
  listeners.forEach((l) => l())
}

export function closeOverlay(): void {
  openOverlay(null)
}

export function useOverlay(): Overlay {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

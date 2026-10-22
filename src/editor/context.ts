import type { EditorView } from 'prosemirror-view'
import type { EditorServices } from './types'

/** Overlay UI that plugins and node views ask the React layer to show. */
export interface UIState {
  /** Link popover for the selection (⌘K / toolbar / mobile bar), or for a link block (`/link`). */
  link: null | { mode: 'mark' | 'block'; anchor: DOMRect | null }
  /** Emoji picker for the callout at `pos`. */
  emoji: null | { pos: number; anchor: DOMRect }
  /** Block menu (⋮⋮). `anchor` is the handle button. */
  blockMenu: null | { pos: number; anchor: HTMLElement }
  /** iPhone M06 insert sheet. */
  insertSheet: boolean
  /** Which popup of the format toolbar / mobile bar is open (keeps the selection highlighted). */
  toolbarMenu: null | 'turnInto' | 'color' | 'more' | 'link'
  /** Mobile sheets opened from the keyboard toolbar. */
  mobileSheet: null | 'turnInto' | 'color'
  /** DATA-19: crop dialog for the image at `pos`. */
  crop: null | { pos: number }
}

export const initialUIState: UIState = {
  link: null,
  emoji: null,
  blockMenu: null,
  insertSheet: false,
  toolbarMenu: null,
  mobileSheet: null,
  crop: null,
}

/** A tiny observable store (for `useSyncExternalStore`). */
export class UIStore {
  private state: UIState = initialUIState
  private listeners = new Set<() => void>()
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getSnapshot = () => this.state
  set(patch: Partial<UIState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }
  reset() {
    this.state = initialUIState
    this.listeners.forEach((l) => l())
  }
}

export interface EditorContext {
  /** Always the latest services passed to the component. */
  services(): EditorServices
  /** Calls the `onExitTop` prop; false when the prop is not set. */
  onExitTop(): boolean
  ui: UIStore
  /** The block under the pointer (block handle); mapped through every transaction. */
  hover: { pos: number | null }
  /** The live view (null while constructing). */
  view(): EditorView | null
  /** Blob URL cache for attachments (revoked on unmount). */
  assets: AssetCache
}

export class AssetCache {
  private urls = new Map<string, Promise<string | null>>()
  constructor(private resolve: (href: string) => Promise<string | null>) {}
  get(href: string, force = false): Promise<string | null> {
    if (force) this.urls.delete(href)
    let p = this.urls.get(href)
    if (!p) {
      p = this.resolve(href).catch(() => null)
      this.urls.set(href, p)
      // Do not cache misses: the file may arrive later (sync, upload finishing).
      void p.then((v) => {
        if (v === null) this.urls.delete(href)
      })
    }
    return p
  }
  dispose() {
    this.urls.clear()
  }
}

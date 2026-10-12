/**
 * CONTRACT between the page view (app) and the editor (`src/editor`).
 * The page view owns loading/saving; the editor owns everything inside the document area.
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

export interface PageRef {
  /** Root-relative href, e.g. `/工作/會議記錄.md` (DATA-17 encoding). */
  href: string
  title: string
  icon: string | null
  /** Parent title for display, e.g. 「工作」. */
  parentTitle?: string | null
}

export interface UploadResult {
  /** Root-relative href, e.g. `/_assets/2026/10/3f9a2c1b.png`. */
  href: string
  /** Original file name (for File blocks). */
  name: string
  isImage: boolean
}

/** Services the app provides to the editor. */
export interface EditorServices {
  /** DATA-18/19: store an attachment locally (pushed later). Throws an Error with a user-facing message (e.g. > 25 MB). */
  uploadFile(file: File): Promise<UploadResult>
  /** SEC-5: a `blob:` URL for an attachment href, or null if it is not available (offline, not found). */
  resolveAsset(href: string): Promise<string | null>
  /** UI-7 `page`: create a child page of the current page and return a reference to it. */
  createChildPage(): Promise<PageRef>
  /** UI-5: open a page link inside the app. */
  openPage(href: string): void
  /** Page search for the link picker and 「移到頁面…」. Empty query → recent pages. */
  searchPages(query: string): Promise<PageRef[]>
  /** Live title and icon of a linked page (page link blocks show the current title), or null if missing. */
  pageInfo(href: string): PageRef | null
  /** 「移到頁面…」: append these blocks (serialised Markdown) to another page. */
  moveBlocksToPage(markdown: string, href: string): Promise<void>
  /** UI-8: the last colour used on this device, `color:<name>` / `bg:<name>`, or null. */
  getLastColor(): string | null
  setLastColor(value: string): void
}

export interface EditorProps {
  /** Initial document. To replace it later use the handle's `replaceDoc`. */
  doc: PMNode
  editable: boolean
  services: EditorServices
  /** Called after every transaction that changed the document (the page view debounces). */
  onChange: (doc: PMNode) => void
  /** Backspace at the very start of the doc, or ↑ on the first line: move focus to the title (UI-2). */
  onExitTop?: () => void
  /** Placeholder for an empty first paragraph (D11). */
  placeholder?: string
  /** Mobile: the keyboard toolbar (UI-12) is rendered by the editor when true. */
  mobile?: boolean
  className?: string
}

/** Imperative handle (React ref) of the editor component. */
export interface EditorHandle {
  view: EditorView | null
  /** Focus the start (or end) of the document. */
  focus(where?: 'start' | 'end'): void
  /**
   * SYNC-5 step 5: replace the content after a pull/merge, keeping the cursor at the same block
   * index and text offset where possible. Does not call `onChange` and is not undoable.
   */
  replaceDoc(doc: PMNode): void
  /** The current document. */
  getDoc(): PMNode
  /** Insert a document at the start, used by the 「或從這裡開始」 starters (UI-10). */
  setContent(doc: PMNode): void
}

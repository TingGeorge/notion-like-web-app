/**
 * User actions shared by the desktop and iPhone layouts: they call the workspace operations,
 * tell the sync engine, navigate and show toasts (UI-13).
 */
import { encodeLinkPath } from '../lib/data/links'
import { db } from '../lib/store/db'
import {
  createPage,
  deletePage,
  discardIfEmptyNew,
  duplicatePage,
  ensureId,
  getPage,
  movePage,
  pageFileText,
  purgeTrashEntry,
  restorePage,
  setFavorite,
} from '../lib/workspace/ops'
import { t } from '../strings/zh-TW'
import { toast, toastWithUndo } from '../ui/toast'
import { followKey, navigate, pageHash, parseHash } from './router'
import { broadcast, flushEditors, session } from './session'

/** Tell the sync engine a local change happened (SYNC-7). */
export function localChange(): void {
  session()?.engine.notifyLocalChange()
}

export async function newPage(parentKey: string | null = null, body?: string): Promise<string> {
  // Keystrokes typed while the page is being created must not land in the page being left.
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  const key = await createPage({ parentKey, body })
  localChange()
  navigate({ name: 'page', key })
  return key
}

export async function toggleFavorite(key: string, on: boolean): Promise<void> {
  const id = await setFavorite(key, on)
  localChange()
  toast(on ? t.toast.addedFavorite : t.toast.removedFavorite)
  // A page without an id just got one (DATA-9): the open view follows it without remounting.
  followKey(key, id)
}

/** 複製連結: an in-app link `#/p/<pageKey>` (M08). */
export async function copyPageLink(key: string): Promise<void> {
  const id = await ensureId(key)
  const url = `${location.origin}${location.pathname}${pageHash(id)}`
  try {
    await navigator.clipboard.writeText(url)
    toast(t.toast.linkCopied)
  } catch {
    toast(url)
  }
  localChange()
}

export async function duplicate(key: string): Promise<void> {
  const page = await getPage(key)
  const id = await duplicatePage(key)
  localChange()
  if (page) toast(t.toast.pageDuplicated(page.title))
  navigate({ name: 'page', key: id })
}

export async function trashPage(key: string): Promise<void> {
  const page = await getPage(key)
  if (!page) return
  const parentKey = page.parentKey
  // Save the last keystrokes first, so they go to the trash with the page.
  await flushEditors()
  const entryId = await deletePage(key)
  localChange()
  // Leave the page only if it is still the one shown: the user may have moved on meanwhile.
  const route = parseHash(location.hash)
  if (route.name === 'page' && (route.key === key || route.key === page.key)) {
    navigate(parentKey ? { name: 'page', key: parentKey } : { name: 'home' }, { replace: true })
  }
  toastWithUndo(t.toast.pageDeleted(page.title), () => {
    void restorePage(entryId)
      .then((restored) => {
        localChange()
        if (restored) navigate({ name: 'page', key: restored })
      })
      .catch((error: unknown) => console.warn('undo delete failed', error))
  })
}

export async function restoreFromTrash(entryId: string, title: string): Promise<void> {
  const key = await restorePage(entryId)
  localChange()
  toast(t.toast.pageRestored(title))
  if (key) navigate({ name: 'page', key })
}

export async function purgeFromTrash(entryId: string): Promise<void> {
  await purgeTrashEntry(entryId)
  localChange()
}

export async function moveTo(key: string, parentKey: string | null, index?: number): Promise<void> {
  const page = await getPage(key)
  const id = await movePage(key, parentKey, index)
  localChange()
  // A page without an id was open under its path, which just changed.
  followKey(key, id)
  if (page && page.parentKey !== parentKey) {
    toastWithUndo(t.toast.pageMoved(page.title), () => {
      // The page may have been deleted or moved again since; then there is nothing to undo.
      void movePage(id, page.parentKey)
        .then(localChange)
        .catch((error: unknown) => console.warn('undo move failed', error))
    })
  }
}

/** 匯出 Markdown: download the page file. */
export async function exportMarkdown(key: string): Promise<void> {
  const page = await getPage(key)
  if (!page) return
  const text = await pageFileText(key)
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${page.title || t.common.untitled}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * UI-16: 列印／存成 PDF. The menu that called this has asked to close, but React has not
 * removed it from the DOM yet, and window.print() blocks and snapshots the page as it is —
 * so print on the next task, once the menu is gone.
 */
export function printPage(): void {
  setTimeout(() => window.print(), 0)
}

/** Leaving a page: discard it if it is a new empty page (UI-10), and push soon (SYNC-7). */
export async function leavePage(key: string): Promise<void> {
  const discarded = await discardIfEmptyNew(key)
  if (!discarded) session()?.engine.pushSoon()
}

/** Settings: 「立即同步」. */
export async function syncNow(): Promise<void> {
  await session()?.engine.syncNow()
}

export function hrefForPath(path: string): string {
  return encodeLinkPath(path)
}

/** For SETUP-12: number of local changes that are not on GitHub yet. */
export async function dirtyFileCount(): Promise<number> {
  return db()
    .files.filter((f) => f.dirty)
    .count()
}

export function notifyWorkspaceChanged(): void {
  broadcast({ type: 'workspace-changed' })
}

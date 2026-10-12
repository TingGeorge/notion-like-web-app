import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { parseSettings } from '../lib/data/notesFiles'
import { db } from '../lib/store/db'
import { DEFAULT_UI, SETTINGS_PATH, type FileRow, type NotesSettings, type PageRow, type SyncState, type UiPrefs } from '../lib/types'
import { updateUi } from './session'

// --- Pages -----------------------------------------------------------------------------------

/** A synchronous snapshot of the pages index, for code outside React (editor services). */
export const pagesCache = {
  byKey: new Map<string, PageRow>(),
  byPath: new Map<string, PageRow>(),
  all: [] as PageRow[],
}

function updateCache(pages: PageRow[]) {
  pagesCache.all = pages
  pagesCache.byKey = new Map(pages.map((p) => [p.key, p]))
  pagesCache.byPath = new Map(pages.map((p) => [p.path, p]))
}

const NO_PAGES: PageRow[] = []

/** All pages (empty while loading). */
export function usePages(): PageRow[] {
  const pages = useLiveQuery(() => db().pages.toArray(), [])
  useEffect(() => {
    if (pages) updateCache(pages)
  }, [pages])
  return pages ?? NO_PAGES
}

/**
 * A live query about one key. `useLiveQuery` keeps returning the previous result while the query
 * for new deps runs, which here would be another key's answer (another page, or its "not found"),
 * so the answer carries its key and reads as `undefined` (loading) until it matches.
 */
function useLiveQueryFor<T>(key: string | null | undefined, query: () => Promise<T>): T | undefined {
  const result = useLiveQuery(async () => ({ key, value: await query() }), [key])
  return result && result.key === key ? result.value : undefined
}

/**
 * A page by key (an id, or `path:<repo path>`, which also finds a page that has since received an
 * id): `undefined` while loading, `null` if there is none.
 */
export function usePage(key: string | null): PageRow | null | undefined {
  return useLiveQueryFor(key, async () => {
    if (!key) return null
    const page = await db().pages.get(key)
    if (page) return page
    if (key.startsWith('path:')) return (await db().pages.where('path').equals(key.slice(5)).first()) ?? null
    return null
  })
}

export function useFile(path: string | null | undefined): FileRow | null | undefined {
  return useLiveQueryFor(path, async () => (path ? ((await db().files.get(path)) ?? null) : null))
}

export function useSettings(): NotesSettings {
  const text = useLiveQuery(async () => {
    const row = await db().files.get(SETTINGS_PATH)
    return row && !row.deleted ? row.text : null
  }, [])
  return parseSettings(text ?? null).value
}

// --- Sync ------------------------------------------------------------------------------------

export function useSyncState(): SyncState | undefined {
  return useLiveQuery(() => db().sync.get('state'), [])
}

/** Number of pages (and other files) waiting to be pushed. */
export function useDirtyCount(): number {
  return (
    useLiveQuery(
      () =>
        db()
          .files.filter((f) => f.dirty && (f.kind === 'page' || f.kind === 'trash'))
          .count(),
      [],
    ) ?? 0
  )
}

/** Pages currently in conflict (SYNC-6). */
export function useConflicts(): FileRow[] {
  return useLiveQuery(() => db().files.filter((f) => f.conflict !== null).toArray(), []) ?? []
}

// --- UI prefs --------------------------------------------------------------------------------

export function useUi(): [UiPrefs, (patch: Partial<UiPrefs>) => void] {
  const row = useLiveQuery(() => db().config.get('ui'), [])
  const prefs: UiPrefs = { ...DEFAULT_UI, ...(row && row.key === 'ui' ? row.value : {}) }
  return [prefs, (patch) => void updateUi(patch)]
}

// --- Environment -----------------------------------------------------------------------------

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine)
}

const MOBILE_QUERY = '(max-width: 767px)'

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(MOBILE_QUERY)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
  )
}

/** Re-render every `ms` (for 「N 分鐘前」). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

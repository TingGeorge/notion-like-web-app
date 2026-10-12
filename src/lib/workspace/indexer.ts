/**
 * STORE-4: the `pages` table (and the search index) are derived from `files` and updated on
 * every local write and every pull. They can always be rebuilt (`reindexAll`).
 */
import { analyzePage, readPageMeta, splitPageFile, type PageAnalysis } from '../markdown'
import { dirname, isPagePath, basename, titleOf, ancestorDirs } from '../data/names'
import { SearchIndex } from '../search'
import { db } from '../store/db'
import type { FileRow, PageRow } from '../types'

export function pathKey(path: string): string {
  return `path:${path}`
}

function safeAnalyze(text: string): PageAnalysis {
  try {
    return analyzePage(text)
  } catch (error) {
    console.error('analyzePage failed', error)
    // Keep the identity and title from the frontmatter even if the body cannot be analysed.
    const { frontmatter, body } = splitPageFile(text)
    return {
      meta: readPageMeta(frontmatter),
      links: [],
      headings: [],
      plainText: body,
      excerpt: body.slice(0, 200).replace(/\s+/g, ' '),
    }
  }
}

function isLivePage(row: FileRow | undefined): row is FileRow & { text: string } {
  return !!row && row.kind === 'page' && !row.deleted && row.text !== null && isPagePath(row.path)
}

// ---------------------------------------------------------------------------------------------
// Search index (one per tab, persisted in the `search` table).

let searchIndex: SearchIndex | null = null
let searchLoad: Promise<SearchIndex> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** The search index, loaded from IndexedDB or rebuilt from `files` if missing. */
export function getSearchIndex(): Promise<SearchIndex> {
  if (searchIndex) return Promise.resolve(searchIndex)
  searchLoad ??= (async () => {
    const stored = await db().search.get('index')
    let index: SearchIndex | null = null
    if (stored) {
      try {
        index = SearchIndex.create(stored.json)
      } catch {
        index = null
      }
    }
    if (!index) {
      index = SearchIndex.create()
      const rows = await db().files.where('kind').equals('page').toArray()
      const pages = await db().pages.toArray()
      const keyByPath = new Map(pages.map((p) => [p.path, p.key]))
      for (const row of rows) {
        if (!isLivePage(row)) continue
        const key = keyByPath.get(row.path)
        if (key) index.upsert(searchDoc(key, row, safeAnalyze(row.text)))
      }
      scheduleSave(index)
    }
    searchIndex = index
    return index
  })()
  return searchLoad
}

function scheduleSave(index: SearchIndex) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void db().search.put({ key: 'index', json: index.toJSON(), updatedAt: Date.now() })
  }, 2000)
}

function searchDoc(key: string, row: FileRow & { text: string }, analysis: PageAnalysis) {
  return {
    key,
    title: titleOf(row.path, analysis.meta.title),
    path: row.path,
    headings: analysis.headings,
    body: analysis.plainText,
    updatedAt: row.updatedAt,
  }
}

/** Drop the in-memory search index (after clearing the device data). */
export function resetSearchIndex(): void {
  searchIndex = null
  searchLoad = null
}

// ---------------------------------------------------------------------------------------------

interface Change {
  removedKeys: string[]
  upserts: { key: string; row: FileRow & { text: string }; analysis: PageAnalysis }[]
}

/** Re-index the given repo paths (pages that changed, appeared or disappeared). */
export async function reindexPaths(paths: Iterable<string>): Promise<void> {
  const unique = [...new Set(paths)].filter((p) => isPagePath(p))
  if (unique.length === 0) return
  const change: Change = { removedKeys: [], upserts: [] }
  await db().transaction('rw', db().files, db().pages, async () => {
    for (const path of unique) await indexOne(path, change)
    await rebuildStructure()
  })
  await applySearch(change)
}

/** Rebuild the whole `pages` table and the search index from `files`. */
export async function reindexAll(): Promise<void> {
  const change: Change = { removedKeys: [], upserts: [] }
  await db().transaction('rw', db().files, db().pages, async () => {
    await db().pages.clear()
    const rows = (await db().files.where('kind').equals('page').toArray()).sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    )
    for (const row of rows) {
      if (isLivePage(row)) await indexOne(row.path, change, row)
    }
    await rebuildStructure()
  })
  resetSearchIndex()
  await db().search.delete('index')
  const index = SearchIndex.create()
  for (const u of change.upserts) index.upsert(searchDoc(u.key, u.row, u.analysis))
  searchIndex = index
  searchLoad = Promise.resolve(index)
  scheduleSave(index)
}

async function indexOne(path: string, change: Change, known?: FileRow): Promise<void> {
  const pages = db().pages
  const previous = await pages.where('path').equals(path).toArray()
  for (const p of previous) {
    await pages.delete(p.key)
    change.removedKeys.push(p.key)
  }
  const row = known ?? (await db().files.get(path))
  if (!isLivePage(row)) return
  const analysis = safeAnalyze(row.text)
  let key = pathKey(path)
  const id = analysis.meta.id
  if (id) {
    // DATA-9a: if two files share an id, the lexicographically smaller path keeps it.
    const holder = await pages.get(id)
    if (!holder || holder.path === path) {
      key = id
    } else {
      const holderFile = await db().files.get(holder.path)
      const holderLive = isLivePage(holderFile)
      if (!holderLive || path < holder.path) {
        await pages.delete(id)
        if (holderLive) await pages.put({ ...holder, key: pathKey(holder.path) })
        key = id
      }
    }
  }
  const page: PageRow = {
    key,
    path,
    title: titleOf(path, analysis.meta.title),
    icon: analysis.meta.icon,
    cover: analysis.meta.cover,
    parentKey: null,
    links: analysis.links,
    excerpt: analysis.excerpt,
    updatedAt: row.updatedAt,
    created: analysis.meta.created,
    virtual: false,
    childCount: 0,
  }
  await pages.put(page)
  change.upserts.push({ key, row, analysis })
}

/** Virtual pages (DATA-3), parent keys and child counts, from the paths of all real pages. */
async function rebuildStructure(): Promise<void> {
  const pages = db().pages
  const all = await pages.toArray()
  // Copies: `all` keeps the stored values to compare against.
  const real = all.filter((p) => !p.virtual).map((p) => ({ ...p }))
  const byPath = new Map<string, PageRow>(real.map((p) => [p.path, p]))
  const virtualWanted = new Map<string, PageRow>()
  for (const p of real) {
    for (const dir of ancestorDirs(p.path)) {
      const path = `${dir}.md`
      if (byPath.has(path) || virtualWanted.has(path)) continue
      const old = all.find((x) => x.virtual && x.path === path)
      virtualWanted.set(path, {
        key: pathKey(path),
        path,
        title: basename(dir),
        icon: null,
        cover: null,
        parentKey: null,
        links: [],
        excerpt: '',
        updatedAt: old?.updatedAt ?? 0,
        created: null,
        virtual: true,
        childCount: 0,
      })
    }
  }
  const next = [...real, ...virtualWanted.values()]
  const keyByPath = new Map(next.map((p) => [p.path, p.key]))
  const counts = new Map<string, number>()
  for (const p of next) {
    const dir = dirname(p.path)
    p.parentKey = dir ? (keyByPath.get(`${dir}.md`) ?? null) : null
    if (p.parentKey) counts.set(p.parentKey, (counts.get(p.parentKey) ?? 0) + 1)
  }
  for (const p of next) p.childCount = counts.get(p.key) ?? 0

  const before = new Map(all.map((p) => [p.key, p]))
  const changed = next.filter((p) => {
    const old = before.get(p.key)
    return !old || old.parentKey !== p.parentKey || old.childCount !== p.childCount || old.path !== p.path || old.virtual !== p.virtual
  })
  const nextKeys = new Set(next.map((p) => p.key))
  const stale = all.filter((p) => !nextKeys.has(p.key)).map((p) => p.key)
  if (stale.length) await pages.bulkDelete(stale)
  if (changed.length) await pages.bulkPut(changed)
}

/**
 * Another tab re-indexed these paths (STORE-6): bring this tab's in-memory search index up to
 * date from the shared `files` and `pages` tables.
 */
export async function refreshSearchFor(paths: string[]): Promise<void> {
  if (!searchIndex) return
  const index = searchIndex
  for (const path of paths) {
    const rows = await db().pages.where('path').equals(path).toArray()
    const file = await db().files.get(path)
    for (const key of [pathKey(path)]) if (index.has(key)) index.remove(key)
    if (!isLivePage(file)) {
      for (const r of rows) if (index.has(r.key)) index.remove(r.key)
      continue
    }
    for (const r of rows) if (!r.virtual) index.upsert(searchDoc(r.key, file, safeAnalyze(file.text)))
  }
}

async function applySearch(change: Change): Promise<void> {
  let index: SearchIndex
  try {
    index = await getSearchIndex()
  } catch (error) {
    console.error('search index unavailable', error)
    return
  }
  for (const key of change.removedKeys) if (index.has(key)) index.remove(key)
  for (const u of change.upserts) index.upsert(searchDoc(u.key, u.row, u.analysis))
  scheduleSave(index)
}

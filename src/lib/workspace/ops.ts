/**
 * Local page operations (DATA-3 to DATA-9, DATA-17, DATA-21, DATA-22, SYNC-10, UI-10).
 * They only change the local `files` table; the sync engine pushes the result in one commit.
 */
import { encodeLinkPath, parseHref, withFragment } from '../data/links'
import {
  basename,
  childDirOf,
  dirname,
  isInside,
  isPagePath,
  pageNameOf,
  pagePathFor,
  trashEntryIdOf,
  trashPathFor,
  UNTITLED,
} from '../data/names'
import { parseSettings, parseTrashIndex, serializeSettings, serializeTrashIndex } from '../data/notesFiles'
import { isUlid, ulid } from '../data/ulid'
import { emptyFrontmatter, joinPageFile, readPageId, readPageMeta, rewriteLinks, splitPageFile } from '../markdown'
import { db } from '../store/db'
import {
  SETTINGS_PATH,
  TRASH_DIR,
  TRASH_INDEX_PATH,
  type FileRow,
  type NotesSettings,
  type PageRow,
  type TrashEntry,
  type TrashIndex,
} from '../types'
import { deleteFile, ensureBlobRow, moveFile, readText, rowsInside, treeBlobsInside, writeText } from './files'
import { pathKey, reindexPaths } from './indexer'

/** ISO 8601 with the local UTC offset, e.g. `2026-10-11T10:00:00+08:00` (DATA-8 `created`). */
export function isoLocal(date = new Date()): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  )
}

/**
 * One local operation = one transaction (the sync engine must never push half of it).
 * The callback must be an `async` function: Dexie only keeps the transaction alive across native
 * `await`s inside async callbacks, not for a plain function returning a promise.
 */
function tx<T>(fn: () => Promise<T>): Promise<T> {
  return db().transaction('rw', [db().files, db().pages, db().sync], async () => await fn())
}

// --- Lookups ---------------------------------------------------------------------------------

export async function getPage(key: string): Promise<PageRow | undefined> {
  const page = await db().pages.get(key)
  if (page) return page
  // A `path:` key that has since received an id.
  if (key.startsWith('path:')) return db().pages.where('path').equals(key.slice(5)).first()
  return undefined
}

async function requirePage(key: string): Promise<PageRow> {
  const page = await getPage(key)
  if (!page) throw new Error(`page not found: ${key}`)
  return page
}

/** Names already used by pages in a folder (including virtual ones), for DATA-6. */
async function takenNames(dir: string, exceptPath?: string): Promise<string[]> {
  const all = await db().pages.toArray()
  return all.filter((p) => dirname(p.path) === dir && p.path !== exceptPath).map((p) => pageNameOf(p.path))
}

/**
 * Where a page's file is now. Call inside the operation's transaction: the `pages` index is only
 * updated after an operation (or a pull) has finished, so it can still show a path the file has
 * just left. Follows `movedTo` (also into the trash), or finds a never-pushed file by its id.
 */
async function currentPath(page: PageRow): Promise<string> {
  let path = page.path
  let row = await db().files.get(path)
  for (let hops = 0; row?.deleted && row.movedTo && hops < 20; hops++) {
    path = row.movedTo
    row = await db().files.get(path)
  }
  if (row || page.virtual || !isUlid(page.key)) return path
  const id = page.key
  const found = await db()
    .files.where('kind')
    .anyOf('page', 'trash')
    .filter((r) => !r.deleted && r.text !== null && r.text.includes(id) && readPageId(r.text) === id)
    .first()
  return found?.path ?? path
}

/** The row kind for a page file at `path` (a page still being edited after it went to the trash). */
function textKind(path: string): 'page' | 'trash' {
  return path.startsWith(TRASH_DIR) ? 'trash' : 'page'
}

/**
 * `withIdentity` for a page being written. DATA-9a: a page keyed `path:…` whose file carries an id
 * that another file holds (a copy made on github.com, or the same page created on two devices)
 * gets a new id the next time it is saved, so operations never act on the other page.
 */
async function identityFor(page: PageRow, text: string): Promise<{ text: string; id: string }> {
  const { frontmatter, body } = splitPageFile(text)
  const id = readPageMeta(frontmatter).id
  if (id && page.key.startsWith('path:')) {
    const holder = await db().pages.get(id)
    if (holder && holder.path !== page.path) {
      const fresh = ulid()
      frontmatter.set('id', fresh)
      return { text: joinPageFile(frontmatter, body), id: fresh }
    }
  }
  return withIdentity(text)
}

async function childDirFor(parentKey: string | null): Promise<string> {
  if (!parentKey) return ''
  const parent = await requirePage(parentKey)
  return childDirOf(parent.path)
}

// --- Settings (DATA-21) ----------------------------------------------------------------------

export async function readSettings(): Promise<NotesSettings> {
  return parseSettings(await readText(SETTINGS_PATH)).value
}

async function updateSettings(fn: (s: NotesSettings) => void): Promise<void> {
  const settings = await readSettings()
  const before = serializeSettings(settings)
  fn(settings)
  const after = serializeSettings(settings)
  if (after !== before) await writeText(SETTINGS_PATH, 'meta', after)
}

async function readTrash(): Promise<TrashIndex> {
  return parseTrashIndex(await readText(TRASH_INDEX_PATH)).value
}

async function writeTrash(index: TrashIndex): Promise<void> {
  await writeText(TRASH_INDEX_PATH, 'meta', serializeTrashIndex(index))
}

// --- Page text -------------------------------------------------------------------------------

/** Make sure frontmatter has `id` and `created` (DATA-9). Returns the possibly new text and id. */
function withIdentity(text: string): { text: string; id: string } {
  const { frontmatter, body } = splitPageFile(text)
  const meta = readPageMeta(frontmatter)
  // A page that already has an id is never rewritten just for identity (DATA-9).
  if (meta.id) return { text, id: meta.id }
  const id = ulid()
  // New keys go first so `id` leads the block in files the app creates.
  const fresh = emptyFrontmatter()
  fresh.set('id', id)
  for (const key of frontmatter.keys()) {
    const raw = frontmatter.rawEntry(key)
    if (raw !== undefined) fresh.setRawEntry(key, raw)
  }
  if (!meta.created) fresh.set('created', isoLocal())
  return { text: joinPageFile(fresh, body), id }
}

/**
 * DATA-9: give a page a stable id (needed before favouriting, reordering, copying a link,
 * trashing, moving). Returns the page key (the id). A virtual page gets its file created.
 */
export async function ensureId(key: string): Promise<string> {
  const page = await requirePage(key)
  if (!key.startsWith('path:') && isUlid(page.key)) return page.key
  if (page.virtual) {
    const fm = emptyFrontmatter()
    const id = ulid()
    fm.set('id', id)
    fm.set('created', isoLocal())
    await tx(() => writeText(page.path, 'page', joinPageFile(fm, '')))
    await reindexPaths([page.path])
    return id
  }
  let id = ''
  let path = page.path
  let wrote = false
  await tx(async () => {
    path = await currentPath(page)
    const text = (await readText(path)) ?? ''
    const next = await identityFor(page, text)
    id = next.id
    if (next.text !== text) wrote = await writeText(path, textKind(path), next.text)
  })
  if (wrote) await reindexPaths([path])
  return id
}

/** UI-10: a new local page titled 未命名 (or `title`), with an optional starter body. */
export async function createPage(options: { parentKey?: string | null; title?: string; body?: string } = {}): Promise<string> {
  const dir = await childDirFor(options.parentKey ?? null)
  const title = options.title ?? UNTITLED
  const { path, titleInFrontmatter } = pagePathFor(title, dir, await takenNames(dir))
  const id = ulid()
  const fm = emptyFrontmatter()
  fm.set('id', id)
  if (titleInFrontmatter) fm.set('title', title)
  fm.set('created', isoLocal())
  await tx(() => writeText(path, 'page', joinPageFile(fm, options.body ?? '')))
  await reindexPaths([path])
  return id
}

/** Save the editor body of a page (STORE-3). Writes `id`/`created` the first time (DATA-9). */
export async function savePageBody(key: string, body: string): Promise<string> {
  const page = await requirePage(key)
  let id = page.key
  let path = page.path
  let wrote = false
  await tx(async () => {
    path = await currentPath(page)
    const current = (await readText(path)) ?? ''
    const { frontmatter, body: oldBody } = splitPageFile(current)
    if (oldBody.replace(/\n+$/, '') === body.replace(/\n+$/, '') && !page.virtual) return
    const next = await identityFor(page, joinPageFile(frontmatter, body))
    id = next.id
    wrote = await writeText(path, textKind(path), next.text)
  })
  if (wrote) await reindexPaths([path])
  return id
}

/** Set (or clear) a frontmatter field the app manages: icon or cover. */
export async function setPageField(key: string, field: 'icon' | 'cover', value: string | null): Promise<string> {
  const page = await requirePage(key)
  let id = page.key
  let path = page.path
  let wrote = false
  await tx(async () => {
    path = await currentPath(page)
    const current = (await readText(path)) ?? ''
    const { frontmatter, body } = splitPageFile(current)
    frontmatter.set(field, value)
    const next = await identityFor(page, joinPageFile(frontmatter, body))
    id = next.id
    if (next.text !== current || page.virtual) wrote = await writeText(path, textKind(path), next.text)
  })
  if (wrote) await reindexPaths([path])
  return id
}

/** UI-10: an empty new page is discarded when left (never pushed, SYNC-7). */
export async function discardIfEmptyNew(key: string): Promise<boolean> {
  const page = await getPage(key)
  if (!page || page.virtual || page.childCount > 0) return false
  const row = await db().files.get(page.path)
  if (!row || row.baseSha !== null || row.deleted || row.text === null) return false
  const { frontmatter, body } = splitPageFile(row.text)
  const meta = readPageMeta(frontmatter)
  const title = meta.title ?? pageNameOf(page.path)
  const untitled = title === UNTITLED || /^未命名 \(\d+\)$/.test(title) || title.trim() === ''
  if (body.trim() !== '' || !untitled || meta.icon || meta.cover) return false
  await tx(() => deleteFile(page.path))
  await reindexPaths([page.path])
  return true
}

// --- Moves and renames (DATA-7, DATA-17, SYNC-10) --------------------------------------------

interface MovePlan {
  /** old path → new path, for every file that moves (pages and other files). */
  map: Map<string, string>
}

/** Rewrite links in every page that points into the moved set (DATA-17). */
async function rewriteInboundLinks(
  plan: MovePlan,
  renamedPage: { oldPath: string; oldTitle: string; newTitle: string } | null,
): Promise<string[]> {
  const touched: string[] = []
  const rows = await db().files.where('kind').equals('page').filter((r) => !r.deleted && r.text !== null).toArray()
  const reverse = new Map([...plan.map].map(([a, b]) => [b, a]))
  const needles = new Set<string>()
  for (const oldPath of plan.map.keys()) {
    const name = basename(oldPath)
    needles.add(name)
    needles.add(encodeLinkPath(name).slice(1))
  }
  for (const row of rows) {
    const text = row.text as string
    const currentPath = row.path
    const oldPathOfThis = reverse.get(currentPath) ?? currentPath
    const thisMoved = reverse.has(currentPath)
    if (![...needles].some((n) => text.includes(n)) && !thisMoved) continue
    const { frontmatter, body } = splitPageFile(text)
    let next: string
    try {
      next = rewriteLinks(body, (link) => {
        const parsed = parseHref(link.href, oldPathOfThis)
        if (!parsed) return null
        const relative = !link.href.trim().startsWith('/')
        const target = plan.map.get(parsed.path)
        if (target === undefined && !(relative && thisMoved)) return null
        const href = withFragment(encodeLinkPath(target ?? parsed.path), parsed.fragment)
        const result: { href: string; text?: string } = { href }
        if (renamedPage && link.alone && !link.image && parsed.path === renamedPage.oldPath && link.text === renamedPage.oldTitle) {
          result.text = renamedPage.newTitle
        }
        return result
      })
    } catch (error) {
      console.error('rewriteLinks failed', error)
      continue
    }
    if (next !== body) {
      await writeText(currentPath, 'page', joinPageFile(frontmatter, next))
      touched.push(currentPath)
    }
  }
  return touched
}

/** Move a page file and its whole child folder (DATA-7). Returns every path that changed. */
async function relocate(page: PageRow, newPath: string, newText?: string): Promise<{ plan: MovePlan; changed: string[] }> {
  const map = new Map<string, string>()
  const oldDir = childDirOf(page.path)
  const newDir = childDirOf(newPath)
  if (!page.virtual) map.set(page.path, newPath)
  for (const blob of await treeBlobsInside(oldDir)) {
    const known = await db().files.get(blob.path)
    if (!known) await ensureBlobRow(blob.path, blob.sha, blob.mode)
  }
  for (const row of await rowsInside(oldDir)) {
    map.set(row.path, newDir + row.path.slice(oldDir.length))
  }
  for (const [from, to] of map) {
    await moveFile(from, to, from === page.path ? newText : undefined)
  }
  if (page.virtual && newText !== undefined) await writeText(newPath, 'page', newText)
  return { plan: { map }, changed: [...map.keys(), ...map.values()] }
}

/** Rename a page by title (DATA-4 to DATA-7). Returns the page key. */
export async function renamePage(key: string, title: string): Promise<string> {
  const id = await ensureId(key)
  const indexed = await requirePage(id)
  const oldTitle = indexed.title
  if (title === oldTitle) return id
  const changed: string[] = []
  await tx(async () => {
    // Read the file inside the transaction: an editor save may have landed since the lookup.
    const page = { ...indexed, path: await currentPath(indexed) }
    if (page.path.startsWith(TRASH_DIR)) return // deleted meanwhile
    const dir = dirname(page.path)
    const { path: newPath, titleInFrontmatter } = pagePathFor(title, dir, await takenNames(dir, page.path))
    const text = (await readText(page.path)) ?? ''
    const { frontmatter, body } = splitPageFile(text)
    frontmatter.set('title', titleInFrontmatter ? title : null)
    const newText = joinPageFile(frontmatter, body)
    if (newPath === page.path) {
      await writeText(page.path, 'page', newText)
      changed.push(page.path)
      return
    }
    const { plan, changed: moved } = await relocate(page, newPath, newText)
    changed.push(...moved)
    changed.push(...(await rewriteInboundLinks(plan, { oldPath: page.path, oldTitle, newTitle: title })))
  })
  await reindexPaths(changed)
  return id
}

/** Is `candidate` the page itself or one of its descendants? */
async function isSelfOrDescendant(page: PageRow, candidateKey: string | null): Promise<boolean> {
  if (!candidateKey) return false
  const candidate = await getPage(candidateKey)
  if (!candidate) return false
  return candidate.key === page.key || isInside(candidate.path, childDirOf(page.path))
}

/**
 * Move a page under another parent (null = top level), optionally at a position among its
 * new siblings (DATA-21 order). Rewrites inbound links and settings in the same push (SYNC-10).
 */
export async function movePage(key: string, newParentKey: string | null, index?: number): Promise<string> {
  const id = await ensureId(key)
  const indexed = await requirePage(id)
  if (await isSelfOrDescendant(indexed, newParentKey)) throw new Error('cannot move a page into itself')
  const parentId = newParentKey ? await ensureId(newParentKey) : null
  const newDir = await childDirFor(parentId)
  const oldParentKey = indexed.parentKey
  const changed: string[] = []
  await tx(async () => {
    const page = { ...indexed, path: await currentPath(indexed) }
    if (page.path.startsWith(TRASH_DIR)) return // deleted meanwhile
    if (dirname(page.path) !== newDir) {
      const { path: newPath } = pagePathFor(page.title, newDir, await takenNames(newDir))
      const text = (await readText(page.path)) ?? ''
      const { frontmatter, body } = splitPageFile(text)
      // The name may change on a clash (DATA-6); the title then lives in the frontmatter.
      const exact = pageNameOf(newPath) === page.title
      frontmatter.set('title', exact ? null : page.title)
      const { plan, changed: moved } = await relocate(page, newPath, joinPageFile(frontmatter, body))
      changed.push(...moved)
      changed.push(...(await rewriteInboundLinks(plan, null)))
    }
    if (index !== undefined || oldParentKey !== parentId) {
      const siblings = (await db().pages.toArray()).filter((p) => p.parentKey === parentId && p.key !== id)
      await updateSettings((s) => {
        const oldList = s.order[oldParentKey ?? 'root']
        if (oldList) s.order[oldParentKey ?? 'root'] = oldList.filter((k) => k !== id)
        if (index !== undefined) {
          const current = s.order[parentId ?? 'root'] ?? []
          const listed = current.filter((k) => k !== id && siblings.some((p) => p.key === k))
          // Keep the visual order: listed siblings first, then the rest as shown.
          for (const p of siblings) if (!listed.includes(p.key) && !p.key.startsWith('path:')) listed.push(p.key)
          listed.splice(Math.min(index, listed.length), 0, id)
          s.order[parentId ?? 'root'] = listed
        }
      })
      changed.push(SETTINGS_PATH)
    }
  })
  await reindexPaths(changed)
  return id
}

/** DATA-21: set the order of a parent's children (keys get ids first, DATA-9). */
export async function reorderChildren(parentKey: string | null, orderedKeys: string[]): Promise<void> {
  const ids: string[] = []
  for (const k of orderedKeys) ids.push(await ensureId(k))
  const parentId = parentKey ? await ensureId(parentKey) : null
  await tx(() =>
    updateSettings((s) => {
      s.order[parentId ?? 'root'] = ids
    }),
  )
}

// --- Favourites (DATA-21) --------------------------------------------------------------------

export async function setFavorite(key: string, on: boolean): Promise<string> {
  const id = await ensureId(key)
  await tx(async () => {
    await updateSettings((s) => {
      s.favorites = s.favorites.filter((k) => k !== id)
      if (on) s.favorites.push(id)
    })
  })
  return id
}

// --- Trash (DATA-22) -------------------------------------------------------------------------

/** Move a page and its child folder to `.notes/trash/<id>/`. Returns the trash entry id. */
export async function deletePage(key: string): Promise<string> {
  const id = await ensureId(key)
  const indexed = await requirePage(id)
  const parent = indexed.parentKey ? await getPage(indexed.parentKey) : undefined
  const changed: string[] = []
  let entryId = id
  await tx(async () => {
    const page = { ...indexed, path: await currentPath(indexed) }
    if (page.path.startsWith(TRASH_DIR)) return // already deleted
    const trash = await readTrash()
    if (trash.entries.some((e) => e.id === entryId)) entryId = ulid()
    const target = trashPathFor(entryId, page.path)
    const oldDir = childDirOf(page.path)
    const newDir = childDirOf(target)
    for (const blob of await treeBlobsInside(oldDir)) {
      if (!(await db().files.get(blob.path))) await ensureBlobRow(blob.path, blob.sha, blob.mode)
    }
    const moves: [string, string][] = []
    if (!page.virtual) moves.push([page.path, target])
    for (const row of await rowsInside(oldDir)) moves.push([row.path, newDir + row.path.slice(oldDir.length)])
    for (const [from, to] of moves) {
      const row = await db().files.get(from)
      await moveFile(from, to)
      // Trashed pages are `trash` rows: no longer pages, still text.
      if (row && row.kind === 'page') await db().files.update(to, { kind: 'trash' })
      changed.push(from)
    }
    const entry: TrashEntry = {
      id: entryId,
      title: page.title,
      originalPath: page.path,
      deletedAt: new Date().toISOString(),
      reason: 'deleted',
      parentTitle: parent?.title ?? null,
      icon: page.icon,
    }
    trash.entries.push(entry)
    await writeTrash(trash)
    await updateSettings((s) => {
      s.favorites = s.favorites.filter((k) => k !== id)
      for (const parentKey of Object.keys(s.order)) s.order[parentKey] = s.order[parentKey].filter((k) => k !== id)
    })
  })
  await reindexPaths(changed)
  return entryId
}

/** Restore a trashed page to its original place (DATA-6 if the name is taken). */
export async function restorePage(entryId: string): Promise<string | null> {
  const trash = await readTrash()
  const entry = trash.entries.find((e) => e.id === entryId)
  if (!entry) return null
  const changed: string[] = []
  let restoredPath = ''
  await tx(async () => {
    const trashed = trashPathFor(entryId, entry.originalPath)
    // Restore under the original parent if it still exists, otherwise at the top level.
    let dir = dirname(entry.originalPath)
    if (dir && !(await db().pages.where('path').equals(`${dir}.md`).first())) dir = ''
    const text = (await readText(trashed)) ?? ''
    const { frontmatter, body } = splitPageFile(text)
    const meta = readPageMeta(frontmatter)
    const title = entry.title || meta.title || pageNameOf(entry.originalPath)
    const { path, titleInFrontmatter } = pagePathFor(title, dir, await takenNames(dir))
    frontmatter.set('title', titleInFrontmatter ? title : null)
    // A replaced version shares the live page's id: give it a new one (DATA-9a).
    if (meta.id && (await db().pages.get(meta.id))) frontmatter.set('id', ulid())
    restoredPath = path
    const oldDir = childDirOf(trashed)
    const newDir = childDirOf(path)
    const moves: [string, string][] = [[trashed, path]]
    for (const row of await rowsInside(oldDir)) moves.push([row.path, newDir + row.path.slice(oldDir.length)])
    for (const blob of await treeBlobsInside(oldDir)) {
      if (!(await db().files.get(blob.path))) {
        await ensureBlobRow(blob.path, blob.sha, blob.mode)
        moves.push([blob.path, newDir + blob.path.slice(oldDir.length)])
      }
    }
    for (const [from, to] of moves) {
      const row = await db().files.get(from)
      await moveFile(from, to, from === trashed ? joinPageFile(frontmatter, body) : undefined)
      if (row && row.kind === 'trash' && isPagePath(to)) await db().files.update(to, { kind: 'page' })
      changed.push(to)
    }
    trash.entries = trash.entries.filter((e) => e.id !== entryId)
    await writeTrash(trash)
  })
  await reindexPaths(changed)
  const restored = await db().pages.where('path').equals(restoredPath).first()
  return restored?.key ?? null
}

/** 「永久刪除」: remove the files from `.notes/trash/` (they stay in git history). */
export async function purgeTrashEntry(entryId: string): Promise<void> {
  await tx(async () => {
    const prefix = `${TRASH_DIR}${entryId}/`
    const rows = await db().files.where('path').startsWith(prefix).toArray()
    for (const row of rows) await deleteFile(row.path)
    for (const blob of await treeBlobsInside(`${TRASH_DIR}${entryId}`)) {
      if (!(await db().files.get(blob.path))) await ensureBlobRow(blob.path, blob.sha, blob.mode)
      await deleteFile(blob.path)
    }
    const trash = await readTrash()
    trash.entries = trash.entries.filter((e) => e.id !== entryId)
    await writeTrash(trash)
  })
}

export async function listTrash(): Promise<TrashEntry[]> {
  return (await readTrash()).entries.slice().sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
}

/** The text of a trashed page (for previews). */
export async function readTrashedText(entry: TrashEntry): Promise<string | null> {
  return readText(trashPathFor(entry.id, entry.originalPath))
}

export { trashEntryIdOf }

// --- Duplicate -------------------------------------------------------------------------------

/** 複製頁面: copy a page and its children with new ids (DATA-9a), next to the original. */
export async function duplicatePage(key: string): Promise<string> {
  const page = await requirePage(key)
  const dir = dirname(page.path)
  const { path: newPath, titleInFrontmatter } = pagePathFor(page.title, dir, await takenNames(dir))
  const changed: string[] = []
  let newId = ''
  await tx(async () => {
    const sources: FileRow[] = []
    const main = page.virtual ? undefined : await db().files.get(page.path)
    if (main) sources.push(main)
    sources.push(...(await rowsInside(childDirOf(page.path))).filter((r) => r.kind === 'page'))
    for (const src of sources) {
      const target = src.path === page.path ? newPath : childDirOf(newPath) + src.path.slice(childDirOf(page.path).length)
      const { frontmatter, body } = splitPageFile(src.text ?? '')
      const id = ulid()
      frontmatter.set('id', id)
      frontmatter.set('created', isoLocal())
      if (src.path === page.path) {
        newId = id
        frontmatter.set('title', titleInFrontmatter ? page.title : null)
      }
      await writeText(target, 'page', joinPageFile(frontmatter, body))
      changed.push(target)
    }
    if (!main) {
      const fm = emptyFrontmatter()
      newId = ulid()
      fm.set('id', newId)
      if (titleInFrontmatter) fm.set('title', page.title)
      fm.set('created', isoLocal())
      await writeText(newPath, 'page', joinPageFile(fm, ''))
      changed.push(newPath)
    }
  })
  await reindexPaths(changed)
  return newId
}

// --- History (SYNC-15) -----------------------------------------------------------------------

/** 「還原這個版本」: replace the body with an old version as a normal edit. */
export async function restoreVersionText(key: string, oldText: string): Promise<string> {
  return savePageBody(key, splitPageFile(oldText).body)
}

/** 匯出 Markdown: the page file exactly as stored. */
export async function pageFileText(key: string): Promise<string> {
  const page = await requirePage(key)
  return (await readText(page.path)) ?? ''
}

export { pathKey }

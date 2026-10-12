/**
 * Helpers shared by the pull, push, trash and conflict code: an in-memory working copy of the
 * `files` table, and the row conventions from `types.ts` (FileRow).
 */
import { classifyPath, isMarkdownPath, pageNameOf, trashPathFor } from '../data/names'
import { emptyTrashIndex, parseTrashIndex, serializeTrashIndex } from '../data/notesFiles'
import { joinPageFile, splitPageFile } from '../markdown/frontmatter'
import { TRASH_DIR, TRASH_INDEX_PATH, type FileKind, type FileRow, type TrashEntry, type TreeItem } from '../types'
import { titleOfText } from './commitMessage'

/**
 * A working copy of `files` rows. The planners change it; the engine then writes the touched rows
 * in one transaction, after checking that none of them changed in the database meanwhile.
 */
export class WorkingSet {
  private rows = new Map<string, FileRow>()
  /** JSON of each row as read, for the optimistic check before writing. */
  private readonly signatures = new Map<string, string>()
  readonly touched = new Set<string>()

  constructor(rows: FileRow[]) {
    for (const r of rows) {
      this.rows.set(r.path, r)
      this.signatures.set(r.path, JSON.stringify(r))
    }
  }

  get(path: string): FileRow | undefined {
    return this.rows.get(path)
  }

  has(path: string): boolean {
    return this.rows.has(path)
  }

  put(row: FileRow): void {
    this.rows.set(row.path, row)
    this.touched.add(row.path)
  }

  remove(path: string): void {
    this.rows.delete(path)
    this.touched.add(path)
  }

  values(): FileRow[] {
    return [...this.rows.values()]
  }

  /** The row as it was read (JSON), or 'null'. */
  signature(path: string): string {
    return this.signatures.get(path) ?? 'null'
  }

  /** Touched paths whose content changed for the app (ignores `pushing` and `updatedAt`). */
  changedPaths(): string[] {
    const strip = (json: string) => {
      if (json === 'null') return json
      const { pushing: _p, updatedAt: _u, ...rest } = JSON.parse(json) as FileRow
      return JSON.stringify(rest)
    }
    return [...this.touched].filter((p) => {
      const now = this.rows.get(p)
      return strip(this.signature(p)) !== strip(now ? JSON.stringify(now) : 'null')
    })
  }
}

export const isTrashPath = (path: string) => path.startsWith(TRASH_DIR) && path !== TRASH_INDEX_PATH

/** A local delete (into the trash, or a purge): `deleted` with no `movedTo` outside the trash. */
export const isLocalDelete = (r: FileRow) => r.deleted && (!r.movedTo || isTrashPath(r.movedTo))

/** A local move or rename: `deleted` with `movedTo` outside the trash. */
export const isLocalMove = (r: FileRow) => r.deleted && !!r.movedTo && !isTrashPath(r.movedTo)

export const isTextKind = (kind: FileKind) => kind !== 'blob'

/** STORE-2: `dirty = text !== baseText || deleted` (for `blob` rows: `blobSha !== baseSha`). */
export function isDirty(r: FileRow): boolean {
  if (r.deleted) return true
  return r.kind === 'blob' ? (r.blobSha ?? null) !== r.baseSha : r.text !== r.baseText
}

export function cleanRow(path: string, kind: FileKind, sha: string, text: string, now: number): FileRow {
  return {
    path,
    kind,
    baseSha: sha,
    baseText: text,
    text,
    pushing: null,
    dirty: false,
    deleted: false,
    conflict: null,
    updatedAt: now,
  }
}

export function newRow(path: string, kind: FileKind, text: string, now: number): FileRow {
  return {
    path,
    kind,
    baseSha: null,
    baseText: null,
    text,
    pushing: null,
    dirty: true,
    deleted: false,
    conflict: null,
    updatedAt: now,
  }
}

export function kindOf(path: string): Exclude<FileKind, 'blob'> | null {
  return classifyPath(path)
}

/**
 * Set or remove app frontmatter keys on a page file (DATA-8). Unknown keys stay as they are.
 * A file without frontmatter only gets one when a value is set.
 */
export function withFrontmatter(text: string, values: Record<string, string | null>): string {
  const { frontmatter, body, hadFrontmatter } = splitPageFile(text)
  const setting = Object.values(values).some((v) => v !== null)
  if (!hadFrontmatter && !setting) return text
  for (const [k, v] of Object.entries(values)) frontmatter.set(k, v)
  return joinPageFile(frontmatter, body)
}

/** DATA-9a: a copy made by the app gets a new id (only when the original had one). */
export function withNewId(text: string, id: string): string {
  const { frontmatter, hadFrontmatter } = splitPageFile(text)
  if (!hadFrontmatter || !frontmatter.has('id')) return text
  return withFrontmatter(text, { id })
}

/**
 * DATA-6: the names (without `.md`) taken in a folder: page files and folders (virtual pages),
 * from the head tree and the local rows that are not deleted.
 */
export function namesInDir(dir: string, tree: Record<string, TreeItem> | Map<string, TreeItem> | null, work: WorkingSet, except?: string): Set<string> {
  const names = new Set<string>()
  const add = (path: string) => {
    if (path === except) return
    const rest = dir ? (path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : null) : path
    if (rest === null || rest === '') return
    const i = rest.indexOf('/')
    if (i === -1) {
      if (isMarkdownPath(rest)) names.add(pageNameOf(rest))
    } else {
      names.add(rest.slice(0, i))
    }
  }
  const treePaths = tree instanceof Map ? tree.keys() : Object.keys(tree ?? {})
  for (const p of treePaths) add(p)
  for (const r of work.values()) if (!r.deleted) add(r.path)
  return names
}

export interface TrashCopyOptions {
  work: WorkingSet
  entryId: string
  text: string
  originalPath: string
  reason: TrashEntry['reason']
  now: number
}

/**
 * DATA-22: save a version in the trash as its own entry (`.notes/trash/<entryId>/<name>.md` plus an
 * entry in `.notes/trash/index.json`). Used for versions replaced in a conflict (SYNC-6) and for
 * remote edits of a page deleted here (SYNC-5 rule 6). Returns the trash path.
 */
export function addTrashCopy({ work, entryId, text, originalPath, reason, now }: TrashCopyOptions): string {
  const path = trashPathFor(entryId, originalPath)
  const copy = withNewId(text, entryId)
  work.put(newRow(path, 'trash', copy, now))
  addTrashEntry(work, {
    id: entryId,
    title: titleOfText(originalPath, text),
    originalPath,
    deletedAt: new Date(now).toISOString(),
    reason,
  }, now)
  return path
}

export function addTrashEntry(work: WorkingSet, entry: TrashEntry, now: number): void {
  const row = work.get(TRASH_INDEX_PATH)
  const parsed = row?.text ? parseTrashIndex(row.text) : { value: emptyTrashIndex(), ok: true }
  const index = parsed.ok ? parsed.value : emptyTrashIndex()
  index.entries = [...index.entries.filter((e) => e.id !== entry.id), entry]
  const text = serializeTrashIndex(index)
  if (row) work.put({ ...row, text, deleted: false, dirty: text !== row.baseText, updatedAt: now })
  else work.put(newRow(TRASH_INDEX_PATH, 'meta', text, now))
}

export function removeTrashEntries(work: WorkingSet, ids: Set<string>, now: number): void {
  const row = work.get(TRASH_INDEX_PATH)
  if (!row?.text) return
  const parsed = parseTrashIndex(row.text)
  if (!parsed.ok) return
  const index = parsed.value
  const kept = index.entries.filter((e) => !ids.has(e.id))
  if (kept.length === index.entries.length) return
  const text = serializeTrashIndex({ ...index, entries: kept })
  work.put({ ...row, text, dirty: row.deleted || text !== row.baseText, updatedAt: now })
}

/** `HH:mm` in local time (SYNC-6 conflict copy title). */
export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}


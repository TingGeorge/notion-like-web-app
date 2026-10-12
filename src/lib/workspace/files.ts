/**
 * Low-level local changes to the `files` table, following the conventions in `../types.ts`.
 * Every function here must be called inside a Dexie transaction that includes `files`.
 */
import { db } from '../store/db'
import type { FileKind, FileRow } from '../types'

export function now(): number {
  return Date.now()
}

/** Is a text row different from GitHub (STORE-2)? */
function computeDirty(row: FileRow): boolean {
  if (row.kind === 'blob') return row.deleted || (row.blobSha ?? null) !== row.baseSha
  return row.deleted || row.text !== row.baseText
}

function newRow(path: string, kind: FileKind): FileRow {
  return {
    path,
    kind,
    baseSha: null,
    baseText: null,
    text: null,
    pushing: null,
    dirty: true,
    deleted: false,
    conflict: null,
    movedTo: null,
    movedFrom: null,
    updatedAt: now(),
  }
}

/** Live text of a file, or null if it does not exist locally (or is deleted). */
export async function readText(path: string): Promise<string | null> {
  const row = await db().files.get(path)
  if (!row || row.deleted || row.kind === 'blob') return null
  return row.text
}

/** Clear a stale move pointer on the other side of a move. */
async function unlinkMove(row: FileRow): Promise<void> {
  if (row.movedTo) {
    const target = await db().files.get(row.movedTo)
    if (target && target.movedFrom === row.path) await db().files.update(target.path, { movedFrom: null })
  }
  if (row.movedFrom) {
    const source = await db().files.get(row.movedFrom)
    if (source && source.movedTo === row.path) await db().files.update(source.path, { movedTo: null })
  }
}

/** Write local text to a path (creating the row if needed). Returns true if anything changed. */
export async function writeText(path: string, kind: FileKind, text: string): Promise<boolean> {
  const existing = await db().files.get(path)
  if (existing && !existing.deleted && existing.text === text && existing.kind === kind) return false
  const row: FileRow = existing ? { ...existing } : newRow(path, kind)
  if (existing?.deleted && existing.movedTo) {
    await unlinkMove(existing)
    row.movedTo = null
  }
  row.kind = kind
  row.text = text
  row.deleted = false
  row.dirty = computeDirty(row)
  row.updatedAt = now()
  await db().files.put(row)
  return true
}

/** Delete a file locally (a never-pushed file simply disappears). */
export async function deleteFile(path: string): Promise<void> {
  const row = await db().files.get(path)
  if (!row || row.deleted) return
  await unlinkMove(row)
  if (row.baseSha === null) {
    await db().files.delete(path)
    return
  }
  await db().files.put({ ...row, deleted: true, dirty: true, movedTo: null, movedFrom: null, updatedAt: now() })
}

/**
 * Move a file row from `from` to `to`, optionally with new text (link rewrites, frontmatter).
 * Keeps the `movedFrom` / `movedTo` pointers so the sync engine can merge remote edits (SYNC-5 rule 6).
 */
export async function moveFile(from: string, to: string, text?: string): Promise<void> {
  if (from === to) {
    if (text !== undefined) {
      const row = await db().files.get(from)
      if (row) await writeText(from, row.kind, text)
    }
    return
  }
  const row = await db().files.get(from)
  if (!row || row.deleted) return
  const target = (await db().files.get(to)) ?? null
  // The original location of the content: follow an earlier unpushed move.
  const origin = row.baseSha !== null ? row.path : (row.movedFrom ?? null)

  const moved: FileRow = target ? { ...target } : newRow(to, row.kind)
  moved.kind = row.kind
  moved.text = text ?? row.text
  moved.blobSha = row.blobSha ?? null
  moved.mode = row.mode
  moved.deleted = false
  moved.conflict = null
  // Moving back to where it came from is no move at all.
  moved.movedFrom = origin === to ? null : origin
  moved.movedTo = null
  moved.dirty = computeDirty(moved)
  moved.updatedAt = now()

  if (row.baseSha === null) {
    await db().files.delete(from)
    if (origin) await db().files.update(origin, { movedTo: to })
  } else {
    await db().files.put({ ...row, deleted: true, dirty: true, movedTo: to, movedFrom: null, updatedAt: now() })
  }
  await db().files.put(moved)
}

/** All live (not deleted) rows whose path is inside `dir/`. */
export async function rowsInside(dir: string): Promise<FileRow[]> {
  const prefix = `${dir}/`
  return db()
    .files.where('path')
    .between(prefix, `${prefix}￿`, true, true)
    .filter((r) => !r.deleted)
    .toArray()
}

/**
 * Non-text files under `dir/` known only from the last pulled tree (images inside a page folder).
 * They become `blob` rows when their folder moves, so the push can move them by SHA.
 */
export async function treeBlobsInside(dir: string): Promise<{ path: string; sha: string; mode: string }[]> {
  const state = await db().sync.get('state')
  const tree = state?.tree
  if (!tree) return []
  const prefix = `${dir}/`
  const out: { path: string; sha: string; mode: string }[] = []
  for (const [path, item] of Object.entries(tree)) {
    if (item.type === 'blob' && path.startsWith(prefix)) out.push({ path, sha: item.sha, mode: item.mode })
  }
  return out
}

/** Make sure a tree-only file has a `blob` row so it can be moved or deleted. */
export async function ensureBlobRow(path: string, sha: string, mode: string): Promise<void> {
  const existing = await db().files.get(path)
  if (existing) return
  await db().files.put({ ...newRow(path, 'blob'), baseSha: sha, blobSha: sha, mode, dirty: false })
}

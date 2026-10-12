/**
 * SYNC-5 step 4: apply a new remote head to the local `files` rows. Pure planning on a
 * `WorkingSet`; the engine downloads the texts before and writes the result after.
 *
 * Order (SYNC-5): moves, moves into the trash (= deletes), deletes, edits, adds; rule 6 (local move
 * or delete against a remote edit) is handled inside the move/delete/edit steps.
 */
import { childDirOf, classifyPath, dirname, isInside, pagePathFor, trashEntryIdOf } from '../data/names'
import { parseSettings, parseTrashIndex } from '../data/notesFiles'
import { readPageId } from '../markdown/frontmatter'
import { t } from '../../strings/zh-TW'
import { SETTINGS_PATH, TRASH_DIR, type ConflictInfo, type FileKind, type FileRow, type TreeItem } from '../types'
import { titleOfText } from './commitMessage'
import { mergePageText, mergeSettingsText, mergeTrashIndexText } from './merge'
import {
  WorkingSet,
  addTrashCopy,
  cleanRow,
  isLocalDelete,
  isLocalMove,
  namesInDir,
  removeTrashEntries,
  withFrontmatter,
} from './working'

export interface PullInput {
  /** Every `files` row. */
  rows: FileRow[]
  /** The new head tree: files only (path → item). */
  remote: Map<string, TreeItem>
  /** Downloaded texts by blob SHA. */
  texts: Map<string, string>
  now: number
  newId: () => string
}

export interface PullPlan {
  work: WorkingSet
  notices: string[]
  /** Rows that got a new or updated conflict; the engine fills in the remote device. */
  conflicts: Array<{ path: string; remotePath: string }>
}

/** The blob SHAs a pull must download: tracked files whose SHA differs from the local base. */
export function blobsToDownload(rows: FileRow[], remote: Map<string, TreeItem>): string[] {
  const byPath = new Map(rows.map((r) => [r.path, r]))
  const out = new Set<string>()
  for (const [path, item] of remote) {
    if (item.type !== 'blob' || !classifyPath(path)) continue
    const row = byPath.get(path)
    if (row && row.baseSha === item.sha && row.baseText !== null) continue
    if (row?.conflict?.remoteSha === item.sha) continue
    out.add(item.sha)
  }
  return [...out]
}

/** Text merge for a file kind: pages and trash by line (SYNC-5), meta files by JSON (SYNC-6a). */
function mergeFile(kind: FileKind, path: string, base: string | null, ours: string, theirs: string): { text: string | null; remoteInvalid: boolean } {
  if (kind === 'meta') {
    const merge = path === SETTINGS_PATH ? mergeSettingsText : mergeTrashIndexText
    return merge(base, ours, theirs)
  }
  return { text: mergePageText(base ?? '', ours, theirs), remoteInvalid: false }
}

export function planPull(input: PullInput): PullPlan {
  const { remote, texts, now, newId } = input
  const work = new WorkingSet(input.rows)
  const original = new Map(input.rows.map((r) => [r.path, r]))
  const notices: string[] = []
  const conflicts: PullPlan['conflicts'] = []
  const notice = (m: string) => {
    if (!notices.includes(m)) notices.push(m)
  }

  const remoteText = (path: string): string => {
    const item = remote.get(path)!
    const known = texts.get(item.sha)
    if (known !== undefined) return known
    const row = original.get(path)
    if (row && row.baseSha === item.sha && row.baseText !== null) return row.baseText
    if (row?.conflict?.remoteSha === item.sha) return row.conflict.remoteText
    throw new Error(`sync: missing text for ${path}`)
  }

  const conflictInfo = (row: FileRow, remoteText: string, remoteSha: string, mergeBase: string | null): ConflictInfo => ({
    remoteText,
    remoteSha,
    localText: row.text ?? '',
    remoteDevice: null,
    remoteAt: null,
    localAt: row.updatedAt,
    detectedAt: now,
    mergeBase,
  })

  // ---- 1. What changed remotely ---------------------------------------------------------------
  const removed: string[] = []
  const changed: string[] = []
  const added: string[] = []
  for (const row of input.rows) {
    if (row.kind === 'blob' || row.baseSha === null) continue
    const item = remote.get(row.path)
    if (!item) removed.push(row.path)
    else if (item.sha !== row.baseSha) changed.push(row.path)
  }
  for (const [path, item] of remote) {
    if (item.type !== 'blob' || !classifyPath(path)) continue
    const row = original.get(path)
    if (!row || row.baseSha === null) added.push(path)
  }
  const addedSet = new Set(added)

  // ---- 2. Move detection (DATA-9a: ids that appear more than once are ignored) ----------------
  const moveTarget = new Map<string, string>()
  const trashTarget = new Map<string, string>()
  const removedIds = new Map<string, string>()
  for (const p of removed) {
    const row = original.get(p)!
    if (row.kind !== 'page' || row.baseText === null) continue
    const id = readPageId(row.baseText)
    if (id) removedIds.set(p, id)
  }
  if (removedIds.size > 0) {
    const wanted = new Set(removedIds.values())
    const pages = new Map<string, string[]>()
    const trashed = new Map<string, string>()
    for (const [path, item] of remote) {
      if (item.type !== 'blob') continue
      const kind = classifyPath(path)
      if (kind !== 'page' && kind !== 'trash') continue
      const text = remoteText(path)
      if (![...wanted].some((id) => text.includes(id))) continue
      const id = readPageId(text)
      if (!id || !wanted.has(id)) continue
      if (kind === 'page') pages.set(id, [...(pages.get(id) ?? []), path])
      else if (addedSet.has(path)) trashed.set(id, path)
    }
    const consumed = new Set<string>()
    for (const [p, id] of removedIds) {
      const at = pages.get(id) ?? []
      if (at.length === 1 && addedSet.has(at[0]) && !consumed.has(at[0])) {
        moveTarget.set(p, at[0])
        consumed.add(at[0])
      } else if (at.length === 0 && trashed.has(id)) {
        trashTarget.set(p, trashed.get(id)!)
      }
    }
  }
  const moveTargets = new Set(moveTarget.values())

  // ---- helpers --------------------------------------------------------------------------------

  /** DATA-6: an unpushed local page that took a path the remote now uses gets a new name. */
  const evictLocal = (path: string) => {
    const local = work.get(path)
    if (!local || local.baseSha !== null || local.text === null) return
    const dir = dirname(path)
    const title = titleOfText(path, local.text)
    const taken = namesInDir(dir, remote, work)
    const { path: next, titleInFrontmatter } = pagePathFor(title, dir, taken)
    const text = titleInFrontmatter ? withFrontmatter(local.text, { title }) : local.text
    work.remove(path)
    work.put({ ...local, path: next, text, dirty: true, updatedAt: now })
    relink(local, path, next)
    // Unpushed children move along, unless the remote already has that folder.
    const oldDir = childDirOf(path)
    const newDir = childDirOf(next)
    if (![...remote.keys()].some((p) => isInside(p, oldDir))) {
      for (const row of work.values()) {
        if (row.baseSha !== null || !isInside(row.path, oldDir)) continue
        const moved = newDir + row.path.slice(oldDir.length)
        work.remove(row.path)
        work.put({ ...row, path: moved, updatedAt: now })
        relink(row, row.path, moved)
      }
    }
  }

  /** Keep `movedTo` / `movedFrom` pointing at a row that changed path. */
  const relink = (row: FileRow, from: string, to: string) => {
    if (row.movedFrom) {
      const src = work.get(row.movedFrom)
      if (src && src.movedTo === from) work.put({ ...src, movedTo: to })
    }
  }

  /** SYNC-5 rule 6 (local delete, remote edit): the remote text goes into the local trash entry. */
  const intoTrash = (trashPath: string | null | undefined, oldBase: string | null, rt: string, originalPath: string) => {
    notice(t.page.deletedRemoteEdited)
    const tr = trashPath ? work.get(trashPath) : undefined
    if (!tr || tr.text === null) {
      addTrashCopy({ work, entryId: newId(), text: rt, originalPath, reason: 'deleted', now })
      return
    }
    if (tr.text === rt) return
    if (oldBase !== null && tr.text === oldBase) {
      work.put({ ...tr, text: rt, dirty: true, updatedAt: now })
      return
    }
    const merged = oldBase !== null ? mergePageText(oldBase, tr.text, rt) : null
    if (merged !== null) work.put({ ...tr, text: merged, dirty: true, updatedAt: now })
    else addTrashCopy({ work, entryId: newId(), text: rt, originalPath, reason: 'deleted', now })
  }

  /** SYNC-5 rule 6 (local move, remote edit): merge the remote edit into the moved file, by id. */
  const intoMoved = (target: FileRow, oldBase: string | null, rt: string, sha: string, source: string) => {
    const base = target.conflict ? (target.conflict.mergeBase ?? oldBase) : oldBase
    if (rt === base || target.text === null) {
      work.put({ ...target, movedFrom: source })
      return
    }
    if (target.pushing === rt || target.text === rt) {
      work.put({ ...target, movedFrom: source, conflict: null })
      return
    }
    const merged = mergeFile(target.kind, target.path, base, target.text, rt).text
    if (merged !== null) {
      work.put({ ...target, text: merged, conflict: null, movedFrom: source, dirty: true, updatedAt: now })
    } else {
      work.put({ ...target, movedFrom: source, dirty: true, conflict: conflictInfo(target, rt, sha, base) })
      conflicts.push({ path: target.path, remotePath: source })
    }
  }

  /** Both devices deleted the same page into their trash: drop the local trash copy (no unpushed edits in it). */
  const dedupeLocalTrash = (row: FileRow) => {
    const entryId = row.movedTo ? trashEntryIdOf(row.movedTo) : null
    if (!entryId) return
    const dir = `${TRASH_DIR}${entryId}/`
    const inEntry = work.values().filter((r) => r.path.startsWith(dir))
    const safe = inEntry.every((r) => {
      if (r.baseSha !== null) return false
      if (r.kind === 'blob') return true
      const src = input.rows.find((s) => s.movedTo === r.path)
      return !!src && src.baseText === r.text
    })
    if (!safe || inEntry.length === 0) return
    for (const r of inEntry) work.remove(r.path)
    removeTrashEntries(work, new Set([entryId]), now)
  }

  // ---- 3. Remote moves, moves into the trash and deletes ---------------------------------------
  for (const p of removed) {
    const row = work.get(p)
    if (!row) continue
    const q = moveTarget.get(p)
    if (q) {
      const item = remote.get(q)!
      const rt = remoteText(q)
      const kind = classifyPath(q)!
      if (isLocalMove(row) && row.movedTo === q) {
        // Both sides made the same move.
        const target = work.get(q)
        work.remove(p)
        if (!target || target.text === null) {
          work.put(cleanRow(q, kind, item.sha, rt, now))
        } else if (target.text === rt || target.pushing === rt) {
          work.put({ ...target, baseSha: item.sha, baseText: rt, movedFrom: null, pushing: null, conflict: null, dirty: target.text !== rt })
        } else {
          const base = target.conflict?.mergeBase ?? row.baseText
          const merged = mergeFile(kind, q, base, target.text, rt).text
          if (merged !== null) {
            work.put({ ...target, baseSha: item.sha, baseText: rt, text: merged, movedFrom: null, conflict: null, dirty: merged !== rt, updatedAt: now })
          } else {
            work.put({ ...target, baseSha: item.sha, baseText: rt, movedFrom: null, dirty: true, conflict: conflictInfo(target, rt, item.sha, base) })
            conflicts.push({ path: q, remotePath: q })
          }
        }
        continue
      }
      // An unrelated unpushed local page at the target path is renamed first (DATA-6).
      if (work.get(q)?.baseSha === null) evictLocal(q)
      if (isLocalMove(row)) {
        // Both moved, to different places: the local move wins; the remote location is deleted.
        work.remove(p)
        work.put({ ...cleanRow(q, kind, item.sha, rt, now), deleted: true, dirty: true, movedTo: row.movedTo })
        const target = work.get(row.movedTo!)
        if (target) intoMoved(target, row.baseText, rt, item.sha, q)
        continue
      }
      if (isLocalDelete(row)) {
        // Deleted here, moved there: the delete applies to the moved page.
        work.remove(p)
        work.put({ ...cleanRow(q, kind, item.sha, rt, now), deleted: true, dirty: true, movedTo: row.movedTo ?? null })
        const tr = row.movedTo ? work.get(row.movedTo) : undefined
        if (tr) work.put({ ...tr, movedFrom: q })
        if (rt !== row.baseText) intoTrash(row.movedTo, row.baseText, rt, q)
        continue
      }
      work.remove(p)
      if (isClean(row)) {
        work.put(cleanRow(q, kind, item.sha, rt, now))
        continue
      }
      // Local edits follow the page to its new path (three-way merge).
      const base = row.conflict?.mergeBase ?? row.baseText
      const merged = row.text === null ? rt : mergeFile(kind, q, base, row.text, rt).text
      const moved: FileRow = { ...row, path: q, baseSha: item.sha, baseText: rt, movedTo: null, movedFrom: null, pushing: null }
      if (merged !== null) {
        work.put({ ...moved, text: merged, conflict: null, dirty: merged !== rt, updatedAt: now })
      } else {
        work.put({ ...moved, dirty: true, conflict: conflictInfo(row, rt, item.sha, base) })
        conflicts.push({ path: q, remotePath: q })
      }
      continue
    }

    // A delete (or a move into the trash).
    if (isLocalDelete(row)) {
      work.remove(p)
      if (trashTarget.has(p)) dedupeLocalTrash(row)
      continue
    }
    if (isLocalMove(row)) {
      work.remove(p)
      const target = work.get(row.movedTo!)
      if (target) work.put({ ...target, movedFrom: null })
      if (row.kind === 'page') notice(t.page.remoteDeletedKept)
      continue
    }
    if (isClean(row)) {
      work.remove(p)
      continue
    }
    // Dirty here: keep it; the next push creates it again.
    work.put({ ...row, baseSha: null, baseText: null, conflict: null, pushing: null, dirty: true, updatedAt: now })
    if (row.kind === 'page') notice(t.page.remoteDeletedKept)
  }

  // ---- 4. Edits --------------------------------------------------------------------------------
  for (const p of changed) {
    const row = work.get(p)
    if (!row) continue
    const item = remote.get(p)!
    const rt = remoteText(p)
    const sha = item.sha
    if (row.pushing !== null && row.pushing === rt) {
      // Our own earlier push landed (the tab closed before it could record that).
      work.put({ ...row, baseSha: sha, baseText: rt, pushing: null, dirty: row.deleted || row.text !== rt })
      continue
    }
    if (isLocalDelete(row)) {
      work.put({ ...row, baseSha: sha, baseText: rt })
      if (rt !== row.baseText) intoTrash(row.movedTo, row.baseText, rt, p)
      continue
    }
    if (isLocalMove(row)) {
      work.put({ ...row, baseSha: sha, baseText: rt })
      const target = work.get(row.movedTo!)
      if (target) intoMoved(target, row.baseText, rt, sha, p)
      continue
    }
    if (row.kind === 'meta') {
      const remoteBad = !(p === SETTINGS_PATH ? parseSettings(rt) : parseTrashIndex(rt)).ok
      if (isClean(row) && !remoteBad) {
        work.put(cleanRow(p, 'meta', sha, rt, now))
      } else {
        const { text, remoteInvalid } = mergeFile('meta', p, row.baseText, row.text ?? '', rt)
        const merged = text ?? row.text ?? ''
        work.put({ ...row, baseSha: sha, baseText: rt, text: merged, dirty: merged !== rt, updatedAt: now })
        if (remoteInvalid) notice(t.sync.invalidRemoteJson(p))
      }
      continue
    }
    if (isClean(row)) {
      work.put(cleanRow(p, row.kind, sha, rt, now))
      continue
    }
    const base = row.conflict?.mergeBase ?? row.baseText
    const merged = row.text === null ? rt : mergeFile(row.kind, p, base, row.text, rt).text
    if (merged !== null) {
      work.put({ ...row, baseSha: sha, baseText: rt, text: merged, conflict: null, dirty: merged !== rt, updatedAt: now })
    } else {
      work.put({ ...row, baseSha: sha, baseText: rt, dirty: true, conflict: conflictInfo(row, rt, sha, base) })
      conflicts.push({ path: p, remotePath: p })
    }
  }

  // ---- 5. Adds ---------------------------------------------------------------------------------
  for (const q of added) {
    if (moveTargets.has(q)) continue
    const item = remote.get(q)!
    const rt = remoteText(q)
    const kind = classifyPath(q)!
    const local = work.get(q)
    if (!local || local.text === null) {
      work.put(cleanRow(q, kind, item.sha, rt, now))
      continue
    }
    if (local.baseSha !== null) continue
    if (local.text === rt || local.pushing === rt) {
      work.put({ ...local, baseSha: item.sha, baseText: rt, pushing: null, deleted: false, dirty: local.text !== rt })
      continue
    }
    if (kind === 'meta') {
      const { text, remoteInvalid } = mergeFile('meta', q, null, local.text, rt)
      const merged = text ?? local.text
      work.put({ ...local, baseSha: item.sha, baseText: rt, text: merged, dirty: merged !== rt, updatedAt: now })
      if (remoteInvalid) notice(t.sync.invalidRemoteJson(q))
      continue
    }
    if (kind === 'page') {
      evictLocal(q)
      work.put(cleanRow(q, kind, item.sha, rt, now))
      continue
    }
    // A trash file on both sides: keep the local text; the remote one stays in git history.
    work.put({ ...local, baseSha: item.sha, baseText: rt, dirty: true })
  }

  // ---- 6. Blob rows (non-text files moved or deleted with a page) ------------------------------
  for (const row of work.values()) {
    if (row.kind !== 'blob') continue
    const item = remote.get(row.path)
    if (row.deleted) {
      if (!item || row.baseSha === null) {
        work.remove(row.path)
      } else if (item.sha !== row.baseSha) {
        work.put({ ...row, baseSha: item.sha, mode: item.mode })
        const target = row.movedTo ? work.get(row.movedTo) : undefined
        if (target?.kind === 'blob' && !target.deleted) work.put({ ...target, blobSha: item.sha, dirty: true })
      }
      continue
    }
    const want = row.blobSha ?? null
    if (item && item.sha === want) {
      if (row.baseSha !== want || row.dirty) work.put({ ...row, baseSha: want, dirty: false })
    } else if (item) {
      if (row.baseSha !== item.sha) work.put({ ...row, baseSha: item.sha, dirty: true })
    } else if (row.baseSha !== null) {
      work.put({ ...row, baseSha: null, dirty: true })
    }
  }

  // ---- 7. Left-over push snapshots are stale now -----------------------------------------------
  for (const row of work.values()) {
    if (row.pushing !== null) work.put({ ...row, pushing: null })
  }

  return { work, notices, conflicts }
}

/** Nothing to push for this row: not deleted, not in conflict, text equals the base. */
function isClean(row: FileRow): boolean {
  return !row.deleted && !row.conflict && row.text === row.baseText
}

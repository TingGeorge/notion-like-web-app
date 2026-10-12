/**
 * DATA-22: on sync, trash entries older than `trashRetentionDays` are removed permanently.
 * Their files become local deletes (pushed with the next commit) and the entry leaves
 * `.notes/trash/index.json`. They stay in git history.
 */
import { parseSettings, parseTrashIndex } from '../data/notesFiles'
import { SETTINGS_PATH, TRASH_DIR, TRASH_INDEX_PATH, type TreeItem } from '../types'
import { removeTrashEntries, type WorkingSet } from './working'

const DAY = 24 * 60 * 60 * 1000

/** Returns the ids of the purged entries (empty when nothing expired). */
export function planTrashPurge(work: WorkingSet, tree: Record<string, TreeItem> | null, now: number): string[] {
  const index = work.get(TRASH_INDEX_PATH)
  if (!index || index.text === null || index.deleted || index.conflict) return []
  const parsed = parseTrashIndex(index.text)
  if (!parsed.ok) return []
  const days = parseSettings(work.get(SETTINGS_PATH)?.text ?? null).value.trashRetentionDays
  // 0 means "keep forever": never purge on a value that could be a mistake.
  if (!(days > 0)) return []
  const cutoff = now - days * DAY
  const expired = parsed.value.entries.filter((e) => {
    const at = Date.parse(e.deletedAt)
    return Number.isFinite(at) && at < cutoff
  })
  if (expired.length === 0) return []
  const ids = new Set(expired.map((e) => e.id))
  for (const id of ids) {
    const dir = `${TRASH_DIR}${id}/`
    for (const row of work.values()) {
      if (!row.path.startsWith(dir) || row.deleted) continue
      if (row.baseSha === null) work.remove(row.path)
      else work.put({ ...row, deleted: true, dirty: true, movedTo: null, conflict: null, updatedAt: now })
    }
    // Files the app does not keep rows for (attachments inside a trashed folder) are deleted by SHA.
    for (const [path, item] of Object.entries(tree ?? {})) {
      if (!path.startsWith(dir) || work.has(path) || item.type !== 'blob') continue
      work.put({
        path,
        kind: 'blob',
        baseSha: item.sha,
        baseText: null,
        text: null,
        blobSha: item.sha,
        mode: item.mode,
        pushing: null,
        dirty: true,
        deleted: true,
        conflict: null,
        updatedAt: now,
      })
    }
  }
  removeTrashEntries(work, ids, now)
  return [...ids]
}

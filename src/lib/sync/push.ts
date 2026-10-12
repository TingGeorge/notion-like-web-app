/**
 * SYNC-8 steps 2 to 4: which rows go into the next commit, as `POST /git/trees` entries.
 * Pure planning; the engine does the requests and records the result (step 7).
 */
import { UNTITLED, ancestorDirs, pageNameOf } from '../data/names'
import { readPageMeta, splitPageFile } from '../markdown/frontmatter'
import type { FileRow, TreeItem, UploadRow } from '../types'
import type { NewTreeEntry } from '../github/client'
import type { PushChange } from './commitMessage'
import { isDirty } from './working'

const UNTITLED_NAME = new RegExp(`^${UNTITLED}( \\(\\d+\\))?$`)

/**
 * SYNC-7 / UI-10: a new page whose title and body are both empty (title 未命名) is never pushed.
 * Same rule as the app's `discardIfEmptyNew`: an icon, a cover or a child page counts as content
 * (pass `hasChildren` when known).
 */
export function isEmptyNewPage(row: FileRow, hasChildren = false): boolean {
  if (row.kind !== 'page' || row.baseSha !== null || row.deleted || hasChildren) return false
  const { frontmatter, body, hadFrontmatter } = splitPageFile(row.text ?? '')
  if (body.trim() !== '') return false
  const meta = hadFrontmatter ? readPageMeta(frontmatter) : null
  if (meta?.icon || meta?.cover) return false
  const title = meta?.title ?? null
  if (title !== null && title.trim() !== '' && title.trim() !== UNTITLED) return false
  return UNTITLED_NAME.test(pageNameOf(row.path))
}

/** A row that is part of the next push: what exactly is pushed. */
export interface PushedRow {
  path: string
  /** `content` for a text file, `sha` for a blob row, `delete` for a deletion. */
  action: 'content' | 'sha' | 'delete'
  /** The exact text pushed (SYNC-8 step 2), for `content`. */
  text: string | null
  /** The blob SHA pushed, for `sha`. */
  sha: string | null
  mode: string
}

export interface PushPlan {
  entries: NewTreeEntry[]
  pushed: PushedRow[]
  changes: PushChange[]
  /** Deleted rows whose path is not in the head tree: they just become clean (removed). */
  drop: string[]
  /** Rows marked dirty although they equal the head (clean them up). */
  settle: string[]
  uploads: UploadRow[]
  /** Paths held back: conflicts (SYNC-6), empty new pages (SYNC-7), and moves tied to them. */
  held: Set<string>
}

export function planPush(rows: FileRow[], uploads: UploadRow[], tree: Record<string, TreeItem>): PushPlan {
  const held = new Set<string>()
  // A page deleted here is not held by a pending conflict: the delete wins (the remote version is in history).
  const parents = new Set<string>()
  for (const r of rows) if (!r.deleted) for (const dir of ancestorDirs(r.path)) parents.add(`${dir}.md`)
  for (const r of rows) if ((r.conflict && !r.deleted) || isEmptyNewPage(r, parents.has(r.path))) held.add(r.path)
  // A move whose new half is held stays whole: hold the old half too.
  for (let changed = true; changed; ) {
    changed = false
    for (const r of rows) {
      if (!held.has(r.path) && r.movedTo && held.has(r.movedTo)) {
        held.add(r.path)
        changed = true
      }
    }
  }

  const plan: PushPlan = { entries: [], pushed: [], changes: [], drop: [], settle: [], uploads: [], held }
  for (const r of rows) {
    if (held.has(r.path)) continue
    if (!isDirty(r)) {
      if (r.dirty) plan.settle.push(r.path)
      continue
    }
    const inTree = tree[r.path]
    if (r.deleted) {
      if (r.baseSha !== null && inTree) {
        plan.entries.push({ path: r.path, mode: inTree.mode, type: 'blob', sha: null })
        plan.pushed.push({ path: r.path, action: 'delete', text: null, sha: null, mode: inTree.mode })
        plan.changes.push({ op: 'delete', path: r.path, kind: r.kind, baseText: r.baseText, movedTo: r.movedTo ?? null })
      } else {
        plan.drop.push(r.path)
      }
      continue
    }
    if (r.kind === 'blob') {
      const sha = r.blobSha ?? null
      if (!sha) continue
      if (inTree?.sha === sha) {
        plan.settle.push(r.path)
        continue
      }
      const mode = r.mode ?? inTree?.mode ?? '100644'
      plan.entries.push({ path: r.path, mode, type: 'blob', sha })
      plan.pushed.push({ path: r.path, action: 'sha', text: null, sha, mode })
      plan.changes.push({ op: 'write', path: r.path, kind: 'blob', text: '', baseText: null, movedFrom: r.movedFrom ?? null })
      continue
    }
    if (r.text === null) continue
    const mode = inTree?.mode === '100755' ? '100755' : '100644'
    plan.entries.push({ path: r.path, mode, type: 'blob', content: r.text })
    plan.pushed.push({ path: r.path, action: 'content', text: r.text, sha: null, mode })
    plan.changes.push({ op: 'write', path: r.path, kind: r.kind, text: r.text, baseText: r.baseSha === null ? null : r.baseText, movedFrom: r.movedFrom ?? null })
  }
  for (const u of uploads) {
    plan.uploads.push(u)
    plan.changes.push({ op: 'upload', path: u.path })
  }
  return plan
}

/** The head tree after a push: the old snapshot with the pushed entries applied (SYNC-8 step 7). */
export function applyToTree(tree: Record<string, TreeItem>, updates: Array<{ path: string; sha: string | null; mode: string; size?: number }>): Record<string, TreeItem> {
  const next = { ...tree }
  for (const u of updates) {
    if (u.sha === null) delete next[u.path]
    else next[u.path] = { sha: u.sha, mode: u.mode, type: 'blob', ...(u.size !== undefined ? { size: u.size } : {}) }
  }
  return next
}

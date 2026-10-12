/**
 * Three-way merges for SYNC-5 rule 4 (pages) and SYNC-6a (settings and trash JSON).
 * Pure functions, no I/O.
 */
import { diff3Merge } from 'node-diff3'
import { joinPageFile, splitPageFile } from '../markdown/frontmatter'
import type { Frontmatter } from '../markdown/index'
import { parseSettings, parseTrashIndex, serializeSettings, serializeTrashIndex } from '../data/notesFiles'
import type { NotesSettings, TrashEntry, TrashIndex } from '../types'

/** Line merge with node-diff3. Returns null when the two sides changed overlapping lines. */
export function mergeLines(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours
  if (ours === base) return theirs
  if (theirs === base) return ours
  const regions = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), { excludeFalseConflicts: true })
  const out: string[] = []
  for (const r of regions) {
    if (r.conflict) return null
    out.push(...(r.ok ?? []))
  }
  return out.join('\n')
}

/** Keys whose concurrent changes never conflict: the remote value is kept (it is already published). */
const REMOTE_WINS_KEYS = new Set(['id', 'created'])

/**
 * DATA-8 frontmatter merged key by key on each key's exact source (`rawEntry`).
 * Starts from the remote version and applies the local changes. null on a real conflict.
 */
export function mergeFrontmatter(base: Frontmatter, ours: Frontmatter, theirs: Frontmatter): Frontmatter | null {
  const result = theirs.clone()
  const keys = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])
  for (const key of keys) {
    const b = base.rawEntry(key)
    const o = ours.rawEntry(key)
    const r = theirs.rawEntry(key)
    if (o === b || o === r) continue
    if (r === b) {
      result.setRawEntry(key, o)
      continue
    }
    if (REMOTE_WINS_KEYS.has(key)) continue
    return null
  }
  return result
}

/**
 * SYNC-5 rule 4: three-way merge of a page file. Frontmatter key by key, the body by line.
 * Returns the merged text, or null for overlapping changes (SYNC-6).
 */
export function mergePageText(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours
  if (ours === base) return theirs
  if (theirs === base) return ours
  const b = splitPageFile(base)
  const o = splitPageFile(ours)
  const t = splitPageFile(theirs)
  if (!b.hadFrontmatter && !o.hadFrontmatter && !t.hadFrontmatter) return mergeLines(base, ours, theirs)
  const fm = mergeFrontmatter(b.frontmatter, o.frontmatter, t.frontmatter)
  if (!fm) return null
  const body = mergeLines(b.body, o.body, t.body)
  if (body === null) return null
  return joinPageFile(fm, body)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Three-way pick for one value: the local value wins unless only the remote side changed it. */
function pick<T>(base: T | undefined, ours: T | undefined, theirs: T | undefined): T | undefined {
  return same(ours, base) ? theirs : ours
}

/** Union of two lists minus entries removed on either side since base, local order first. */
function mergeSet(base: string[], ours: string[], theirs: string[]): string[] {
  const o = new Set(ours)
  const t = new Set(theirs)
  const removed = new Set(base.filter((x) => !o.has(x) || !t.has(x)))
  const out: string[] = []
  for (const x of [...ours, ...theirs]) if (!removed.has(x) && !out.includes(x)) out.push(x)
  return out
}

/** Unknown top-level keys: three-way per key, local wins. */
function mergeExtras(
  base: Record<string, unknown>,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
  known: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const keys = [...new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])].filter((k) => !known.includes(k))
  for (const k of keys) {
    const v = pick(base[k], ours[k], theirs[k])
    if (v !== undefined) out[k] = v
  }
  return out
}

export interface JsonMergeResult {
  text: string
  /** The remote file did not parse; the local file was kept (SYNC-6a notice). */
  remoteInvalid: boolean
}

/** SYNC-6a for `.notes/settings.json`. `base` is null when the file is new on both sides. */
export function mergeSettingsText(base: string | null, ours: string, theirs: string): JsonMergeResult {
  const t = parseSettings(theirs)
  if (!t.ok) return { text: ours, remoteInvalid: true }
  const o = parseSettings(ours)
  if (!o.ok) return { text: theirs, remoteInvalid: false }
  const b = parseSettings(base).value
  const order: Record<string, string[]> = {}
  for (const k of new Set([...Object.keys(o.value.order), ...Object.keys(t.value.order), ...Object.keys(b.order)])) {
    const v = pick(b.order[k], o.value.order[k], t.value.order[k])
    if (v !== undefined) order[k] = v
  }
  const known = ['version', 'favorites', 'order', 'trashRetentionDays']
  const merged: NotesSettings = {
    ...mergeExtras(b, o.value, t.value, known),
    version: 1,
    favorites: mergeSet(b.favorites, o.value.favorites, t.value.favorites),
    order,
    trashRetentionDays: pick(b.trashRetentionDays, o.value.trashRetentionDays, t.value.trashRetentionDays) ?? o.value.trashRetentionDays,
  }
  return { text: serializeSettings(merged), remoteInvalid: false }
}

/** SYNC-6a for `.notes/trash/index.json`: entries are a union by id minus removals since base. */
export function mergeTrashIndexText(base: string | null, ours: string, theirs: string): JsonMergeResult {
  const t = parseTrashIndex(theirs)
  if (!t.ok) return { text: ours, remoteInvalid: true }
  const o = parseTrashIndex(ours)
  if (!o.ok) return { text: theirs, remoteInvalid: false }
  const b = parseTrashIndex(base).value
  const byId = (list: TrashEntry[]) => new Map(list.map((e) => [e.id, e]))
  const bm = byId(b.entries)
  const om = byId(o.value.entries)
  const tm = byId(t.value.entries)
  const ids = mergeSet(
    b.entries.map((e) => e.id),
    o.value.entries.map((e) => e.id),
    t.value.entries.map((e) => e.id),
  )
  const entries = ids.map((id) => pick(bm.get(id), om.get(id), tm.get(id)) ?? om.get(id) ?? tm.get(id)!)
  const merged: TrashIndex = { ...mergeExtras(b, o.value, t.value, ['version', 'entries']), version: 1, entries }
  return { text: serializeTrashIndex(merged), remoteInvalid: false }
}

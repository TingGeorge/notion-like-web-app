/**
 * `.notes/settings.json` (DATA-21) and `.notes/trash/index.json` (DATA-22).
 * Parsing is tolerant (missing or wrong fields get defaults; unknown keys are kept).
 * Serialising is stable: known keys first in a fixed order, 2-space JSON, one trailing newline.
 */
import { DEFAULT_SETTINGS, type NotesSettings, type TrashEntry, type TrashIndex } from '../types'

export interface ParseResult<T> {
  value: T
  /** False when the text was not valid JSON (SYNC-6a: the caller keeps the local file). */
  ok: boolean
}

function parseObject(text: string | null | undefined): { obj: Record<string, unknown>; ok: boolean } {
  if (text == null || text.trim() === '') return { obj: {}, ok: true }
  try {
    const v = JSON.parse(text) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return { obj: v as Record<string, unknown>, ok: true }
    return { obj: {}, ok: false }
  } catch {
    return { obj: {}, ok: false }
  }
}

const stringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

export function parseSettings(text: string | null | undefined): ParseResult<NotesSettings> {
  const { obj, ok } = parseObject(text)
  const order: Record<string, string[]> = {}
  if (obj.order && typeof obj.order === 'object' && !Array.isArray(obj.order)) {
    for (const [k, v] of Object.entries(obj.order as Record<string, unknown>)) order[k] = stringArray(v)
  }
  const days = Number(obj.trashRetentionDays)
  const value: NotesSettings = {
    ...obj,
    version: 1,
    favorites: stringArray(obj.favorites),
    order,
    trashRetentionDays: Number.isFinite(days) && days >= 0 ? Math.floor(days) : DEFAULT_SETTINGS.trashRetentionDays,
  }
  return { value, ok }
}

export function serializeSettings(settings: NotesSettings): string {
  const { version, favorites, order, trashRetentionDays, ...extra } = settings
  return `${JSON.stringify({ version, favorites, order, trashRetentionDays, ...extra }, null, 2)}\n`
}

function parseEntry(v: unknown): TrashEntry | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  if (typeof e.id !== 'string' || typeof e.originalPath !== 'string') return null
  return {
    ...e,
    id: e.id,
    title: typeof e.title === 'string' ? e.title : '',
    originalPath: e.originalPath,
    deletedAt: typeof e.deletedAt === 'string' ? e.deletedAt : new Date(0).toISOString(),
    reason: e.reason === 'replaced' ? 'replaced' : 'deleted',
  }
}

export function parseTrashIndex(text: string | null | undefined): ParseResult<TrashIndex> {
  const { obj, ok } = parseObject(text)
  const entries = Array.isArray(obj.entries)
    ? obj.entries.map(parseEntry).filter((e): e is TrashEntry => e !== null)
    : []
  return { value: { ...obj, version: 1, entries }, ok }
}

export function serializeTrashIndex(index: TrashIndex): string {
  const { version, entries, ...extra } = index
  const ordered = entries.map(({ id, title, originalPath, deletedAt, reason, ...rest }) => ({
    id,
    title,
    originalPath,
    deletedAt,
    reason,
    ...rest,
  }))
  return `${JSON.stringify({ version, entries: ordered, ...extra }, null, 2)}\n`
}

export function emptyTrashIndex(): TrashIndex {
  return { version: 1, entries: [] }
}

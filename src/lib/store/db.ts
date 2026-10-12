import Dexie, { type EntityTable } from 'dexie'
import type { AssetRow, DeviceInfo, FileRow, PageRow, SyncState, UiPrefs, UploadRow, Workspace } from '../types'

/** STORE-1 `config` rows. */
export type ConfigRow =
  | { key: 'workspace'; value: Workspace }
  | { key: 'device'; value: DeviceInfo }
  | { key: 'ui'; value: UiPrefs }

export interface SearchRow {
  key: 'index'
  /** Serialised MiniSearch index (JSON string). */
  json: string
  updatedAt: number
}

/**
 * STORE-1: one IndexedDB database `github-notes`, shared by all tabs (STORE-6).
 * Add a new `this.version(n)` block for every schema change; never edit an old one.
 */
export class NotesDB extends Dexie {
  config!: EntityTable<ConfigRow, 'key'>
  files!: EntityTable<FileRow, 'path'>
  uploads!: EntityTable<UploadRow, 'path'>
  pages!: EntityTable<PageRow, 'key'>
  assets!: EntityTable<AssetRow, 'path'>
  sync!: EntityTable<SyncState, 'key'>
  search!: EntityTable<SearchRow, 'key'>

  constructor(name = 'github-notes') {
    super(name)
    this.version(1).stores({
      config: 'key',
      // `dirty` is stored as a boolean; Dexie cannot index booleans, so query with filter().
      files: 'path, kind, updatedAt',
      uploads: 'path',
      pages: 'key, path, parentKey, updatedAt',
      assets: 'path, lastUsed',
      sync: 'key',
      search: 'key',
    })
  }
}

let current: NotesDB | null = null

/** The app-wide database. Tests can swap it with `setDb`. */
export function db(): NotesDB {
  if (!current) current = new NotesDB()
  return current
}

export function setDb(next: NotesDB): void {
  current = next
}

export const EMPTY_SYNC_STATE: SyncState = {
  key: 'state',
  headSha: null,
  treeSha: null,
  etag: null,
  lastPullAt: null,
  lastPushAt: null,
  lastPushStartedAt: null,
  lastError: null,
  tree: null,
}

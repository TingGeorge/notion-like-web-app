import Dexie, { type EntityTable } from 'dexie'
import type { AssetRow, DeviceInfo, FileRow, PageRow, SyncState, UiPrefs, UploadRow, Workspace } from '../types'

/** STORE-1 `config` rows. */
export type ConfigRow =
  | { key: 'workspace'; value: Workspace }
  | { key: 'device'; value: DeviceInfo }
  | { key: 'ui'; value: UiPrefs }
  /** SETUP-12 更換 repo: the token kept while the user picks a new repo. */
  | { key: 'resume'; value: { token: string; tokenExpiresOn: string | null } }
  /** LINK-5: the gist holding a code that is being shown, deleted at the next start if left behind. */
  | { key: 'linkGist'; value: { id: string; createdAt: number } }

export interface SearchRow {
  key: 'index'
  /** Serialised MiniSearch index (JSON string). */
  json: string
  updatedAt: number
}

/** How an attachment row is kept on disk: the bytes and their MIME type instead of a Blob. */
type StoredBytes<T extends { blob: Blob }> = Omit<T, 'blob'> & { blob: ArrayBuffer; type: string }

/** The row with its Blob swapped for the bytes and MIME type, as kept on disk by `putAttachment`. */
export async function withBytes<T extends { blob: Blob }>(row: T): Promise<T> {
  const stored: StoredBytes<T> = { ...row, blob: await row.blob.arrayBuffer(), type: row.blob.type }
  return stored as unknown as T
}

/**
 * Write an `uploads` or `assets` row. WebKit cannot store a Blob in IndexedDB in a private window
 * ("Error preparing Blob/File data to be stored in object store"); there the bytes are stored
 * instead. Elsewhere the Blob is kept, so reading many rows does not load every attachment into
 * memory. Either way the row reads back with a Blob.
 */
export async function putAttachment<T extends { blob: Blob }>(table: { put(row: T): Promise<unknown> }, row: T): Promise<void> {
  try {
    await table.put(row)
  } catch {
    await table.put(await withBytes(row))
  }
}

function readBlob<T extends { blob: Blob }>(row: T | StoredBytes<T> | undefined): T | undefined {
  if (!row || !(row.blob instanceof ArrayBuffer)) return row as T | undefined
  const { type, ...rest } = row as StoredBytes<T>
  return { ...rest, blob: new Blob([rest.blob], { type }) } as unknown as T
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
    this.uploads.hook('reading', readBlob)
    this.assets.hook('reading', readBlob)
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

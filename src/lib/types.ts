/**
 * Shared types. These are the contracts between the store, the sync engine,
 * the workspace operations and the UI. See SPEC.md for the requirement IDs.
 */

/** DATA-1. A workspace is (owner, repo, branch) plus the credentials for it (STORE-1 `config.workspace`). */
export interface Workspace {
  owner: string
  repo: string
  branch: string
  /** Fine-grained or classic token. Never logged, never put in a URL (STORE-7, SEC-2). */
  token: string
  /** `YYYY-MM-DD`, entered by the user, or null when the token never expires (SETUP-5). */
  tokenExpiresOn: string | null
  login: string
  /** GitHub display name, if the account has one. Used for 「<name> 的筆記」. */
  name?: string | null
  /** ISO 8601. */
  linkedAt: string
  /** Whether the repo is private (shown in settings). */
  private?: boolean
}

export interface DeviceInfo {
  id: string
  /** e.g. `iPhone · Safari` (SYNC-9). */
  name: string
}

export type ThemePref = 'system' | 'light' | 'dark'

export interface UiPrefs {
  theme: ThemePref
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** Tree nodes the user expanded, by pageKey. */
  expanded: string[]
  /** Last 8 pages opened on this device, newest first (UI-11). */
  recent: string[]
  /** UI-8: last colour used, e.g. `color:red` or `bg:yellow`. */
  lastColor: string | null
  /** SYNC-7 「自動同步」. */
  autoSync: boolean
  /** SETUP-2 「仍要在 Safari 使用」 was chosen. */
  safariTabModeAccepted?: boolean
}

export const DEFAULT_UI: UiPrefs = {
  theme: 'system',
  sidebarWidth: 240,
  sidebarCollapsed: false,
  expanded: [],
  recent: [],
  lastColor: null,
  autoSync: true,
}

/**
 * STORE-1 `files` table. One row per repo path the app tracks.
 *
 * Kinds:
 * - `page`:  a `.md` file outside reserved folders (DATA-2).
 * - `meta`:  `.notes/settings.json` and `.notes/trash/index.json`.
 * - `trash`: any file under `.notes/trash/<id>/` (a trashed page and its child folder).
 * - `blob`:  a non-text file the app has to move or delete as part of a page move/delete
 *            (for example an image inside a moved page's child folder). It has no text; the
 *            content is referenced by `blobSha`, so it is never downloaded.
 *
 * Conventions (the sync engine and the workspace operations both rely on these):
 * - `baseSha` / `baseText` are the file as last seen on GitHub at this path. Both are null for
 *   a file that does not exist on GitHub yet.
 * - `text` is the local version. For `blob` rows it is null.
 * - A local edit sets `text`, `dirty = true`, `updatedAt = now`.
 * - A local delete of a file that exists on GitHub sets `deleted = true`, `dirty = true` and
 *   keeps `baseSha` / `baseText`. A local delete of a file that never reached GitHub
 *   (`baseSha === null`) removes the row.
 * - A local move/rename is a delete at the old path plus a new row at the new path:
 *   the old row gets `movedTo = <new path>`, the new row gets `movedFrom = <old path>`.
 *   (If the old row never reached GitHub it is simply removed and the new row has no `movedFrom`.)
 * - `dirty === (text !== baseText || deleted)` for text rows (STORE-2). For a `blob` row,
 *   dirty means "needs a tree entry in the next push" (`blobSha !== baseSha || deleted`).
 * - `pushing` holds the exact text being pushed while a push is in flight (SYNC-8 step 2).
 */
export type FileKind = 'page' | 'meta' | 'trash' | 'blob'

export interface FileRow {
  path: string
  kind: FileKind
  baseSha: string | null
  baseText: string | null
  text: string | null
  /** Only for `blob` rows: the git blob SHA of the content. */
  blobSha?: string | null
  /** Git file mode for `blob` rows (`100644`, `100755`). Text files are always `100644`. */
  mode?: string
  pushing: string | null
  dirty: boolean
  deleted: boolean
  /** SYNC-6: an overlapping edit is waiting for the user's choice. */
  conflict: ConflictInfo | null
  movedTo?: string | null
  movedFrom?: string | null
  /** ms since epoch of the last local change (or of the pull that wrote it). */
  updatedAt: number
}

/** SYNC-6. Stored on the file row while the conflict dialog is pending. */
export interface ConflictInfo {
  /** The remote text that could not be merged. */
  remoteText: string
  remoteSha: string
  /** The local text at the time the conflict was detected. */
  localText: string
  /** Name of the other side from the `Device:` trailer, or null for 「GitHub 上的版本」. */
  remoteDevice: string | null
  /** ms since epoch: when the remote commit was made (if known). */
  remoteAt: number | null
  /** ms since epoch: last local edit. */
  localAt: number
  detectedAt: number
  /**
   * The common ancestor the failed merge used (the old `baseText`). The row's `baseText` /
   * `baseSha` already describe the remote version, so a later remote change is merged again
   * against this (SYNC-6, last bullet).
   */
  mergeBase?: string | null
}

/** STORE-1 `uploads`: attachments not yet pushed. Never evicted. */
export interface UploadRow {
  path: string
  blob: Blob
  sha256: string
  createdAt: number
}

/** STORE-1 `assets`: downloaded attachments. LRU cache, at most 200 MB. */
export interface AssetRow {
  path: string
  blob: Blob
  size: number
  lastUsed: number
}

/**
 * STORE-1 `pages`: derived from `files`; can always be rebuilt.
 * Includes virtual pages (DATA-3): a folder with no matching `.md`.
 */
export interface PageRow {
  /** DATA-9: frontmatter `id`, or `path:<repo path>` while it has none. */
  key: string
  /** Repo path of the page's `.md` file (for a virtual page: the path it would get). */
  path: string
  title: string
  icon: string | null
  cover: string | null
  /** Key of the parent page, or null for a root page. */
  parentKey: string | null
  /** Root-relative paths of pages this page links to (DATA-17), decoded, without the leading `/`. */
  links: string[]
  /** Plain-text start of the body, for search results and cards. */
  excerpt: string
  /** ms since epoch. */
  updatedAt: number
  /** The frontmatter `created`, if any (ISO 8601). */
  created: string | null
  virtual: boolean
  /** Number of child pages (including virtual ones). */
  childCount: number
}

/** STORE-1 `sync` table, single row with key `state`. */
export interface SyncState {
  key: 'state'
  headSha: string | null
  treeSha: string | null
  etag: string | null
  lastPullAt: number | null
  lastPushAt: number | null
  lastPushStartedAt: number | null
  lastError: SyncError | null
  /**
   * Snapshot of the head tree after the last pull or push: path → { sha, mode, type }.
   * Only files (`blob`, and `commit` for submodules); folders are implied by the paths.
   */
  tree: Record<string, TreeItem> | null
  /** ms since epoch while a pull or push runs in some tab (SYNC-11 「同步中…」), else null. */
  syncingSince?: number | null
}

export interface TreeItem {
  sha: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  size?: number
}

/** SYNC-11 error reasons. Shown to the user via `t.sync.errors` (`src/strings`). */
export type SyncErrorKind =
  | 'unauthorized' // 401: token invalid or expired → read-only (SETUP-13)
  | 'forbidden' // 403 without rate limit: token has no write access
  | 'not-found' // 404: repo not found
  | 'rate-limited' // primary or secondary rate limit
  | 'server' // 5xx
  | 'network' // offline / fetch failed
  | 'too-large' // truncated tree (SYNC-5 step 2)
  | 'conflict-retry' // ref update failed 3 times (SYNC-8 step 6)
  | 'unknown'

export interface SyncError {
  kind: SyncErrorKind
  message: string
  at: number
  /** ms since epoch: do not retry before this time. */
  retryAt?: number | null
}

/** SYNC-11 status shown in the UI. */
export type SyncStatus =
  | { state: 'synced' }
  | { state: 'syncing' }
  | { state: 'offline'; pending: number }
  /** Online, no error, but N pages are waiting for the next push (or 「自動同步」 is off). */
  | { state: 'pending'; pending: number }
  | { state: 'error'; error: SyncError }

/** DATA-21 `.notes/settings.json`. */
export interface NotesSettings {
  version: 1
  favorites: string[]
  order: Record<string, string[]>
  trashRetentionDays: number
  /** Unknown keys are kept as they are. */
  [extra: string]: unknown
}

export const DEFAULT_SETTINGS: NotesSettings = {
  version: 1,
  favorites: [],
  order: {},
  trashRetentionDays: 30,
}

/** DATA-22 `.notes/trash/index.json` entries. */
export interface TrashEntry {
  id: string
  title: string
  originalPath: string
  /** ISO 8601. */
  deletedAt: string
  reason: 'deleted' | 'replaced'
  /** Optional, for display (「工作」). */
  parentTitle?: string | null
  icon?: string | null
}

export interface TrashIndex {
  version: 1
  entries: TrashEntry[]
  [extra: string]: unknown
}

/** DATA-8 frontmatter keys the app uses. */
export interface PageMeta {
  id: string | null
  title: string | null
  icon: string | null
  cover: string | null
  created: string | null
}

export const SETTINGS_PATH = '.notes/settings.json'
export const TRASH_INDEX_PATH = '.notes/trash/index.json'
export const TRASH_DIR = '.notes/trash/'
export const ASSETS_DIR = '_assets/'

/**
 * Sync engine (SPEC §5): pull, push, merge, conflicts, scheduling.
 *
 * CONTRACT — the UI creates one engine per tab. Only the tab holding the Web Lock `sync`
 * actually talks to GitHub (STORE-6); every tab reads status from the `sync` table.
 */
import type { GitHubClient } from '../github/client'
import type { NotesDB } from '../store/db'
import type { DeviceInfo, SyncStatus, Workspace } from '../types'

export type ConflictChoice = 'keep-both' | 'mine' | 'theirs'

export interface InitialSyncProgress {
  phase: 'list' | 'download' | 'index' | 'done'
  done: number
  total: number
}

export interface SyncEngineOptions {
  db: NotesDB
  workspace: Workspace
  device: DeviceInfo
  client: GitHubClient
  /** SYNC-3: write the open editors into `files.text` before a pull or push. */
  flushEditors: () => Promise<void>
  /** Called after a pull or push changed `files` rows (the app re-indexes these paths). */
  onFilesChanged: (paths: string[]) => Promise<void> | void
  /** Notices for the user (SYNC-5 rule 3 and 6, SYNC-6a). */
  onNotice?: (message: string) => void
  /** For tests. */
  now?: () => number
}

const notImplemented = (name: string): never => {
  throw new Error(`sync: ${name} is not implemented yet`)
}

export class SyncEngine {
  constructor(public readonly options: SyncEngineOptions) {}

  /** Start timers and listeners (SYNC-4, SYNC-7, SYNC-12): visibility, online, 60 s polling. */
  start(): void {
    notImplemented('start')
  }

  stop(): void {
    notImplemented('stop')
  }

  /** 「立即同步」: pull, then push, ignoring the 30 s spacing. */
  syncNow(): Promise<void> {
    return notImplemented('syncNow')
  }

  /** SYNC-5. */
  pull(): Promise<void> {
    return notImplemented('pull')
  }

  /** SYNC-8 (pulls first). */
  push(): Promise<void> {
    return notImplemented('push')
  }

  /** SYNC-7: call after every local edit. Pushes 5 s after the last edit, at most every 30 s. */
  notifyLocalChange(): void {
    notImplemented('notifyLocalChange')
  }

  /** SYNC-7: leaving a page or hiding the app pushes right away (best effort). */
  pushSoon(): void {
    notImplemented('pushSoon')
  }

  /** SETUP-10: the first full download, with progress. */
  initialSync(_onProgress: (p: InitialSyncProgress) => void): Promise<void> {
    return notImplemented('initialSync')
  }

  /** SYNC-6: apply the user's choice for a page in conflict. */
  resolveConflict(_path: string, _choice: ConflictChoice): Promise<void> {
    return notImplemented('resolveConflict')
  }

  /** Current status (SYNC-11), derived from the `sync` and `files` tables and `navigator.onLine`. */
  getStatus(): Promise<SyncStatus> {
    return notImplemented('getStatus')
  }
}

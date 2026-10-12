/**
 * Sync engine (SPEC §5): pull, push, merge, conflicts, scheduling.
 *
 * CONTRACT — the UI creates one engine per tab. Every pull, push and conflict choice runs under
 * the Web Lock `sync`, so only one tab talks to GitHub at a time (STORE-6); every tab reads status
 * from the `sync` table (`syncingSince` shows a sync running in another tab).
 *
 * Wiring (row conventions: `types.ts` FileRow; planning: `pull.ts`, `push.ts`):
 * - `start()` once the workspace is set up; `stop()` when it goes away (or the token changes).
 * - `notifyLocalChange()` after every local write to `files`/`uploads` (SYNC-7 timer).
 * - `pushSoon()` when leaving a page; the engine itself listens to `visibilitychange`,
 *   `pagehide` and `online` while started.
 * - `syncNow()` for 「立即同步」; it never throws, the result is in `getStatus()`.
 * - `flushEditors()` is called with the sync lock held before every pull and push (SYNC-3).
 * - `onFilesChanged(paths)` gets every path whose row a pull, push or conflict choice changed.
 */
import { GitHubError, type GitHubClient } from '../github/client'
import { gitBlobSha } from '../github/encoding'
import { classifyPath, dirname, pagePathFor } from '../data/names'
import { ulid } from '../data/ulid'
import { EMPTY_SYNC_STATE, type NotesDB } from '../store/db'
import { t } from '../../strings/zh-TW'
import { SETTINGS_PATH, TRASH_INDEX_PATH, type DeviceInfo, type FileRow, type SyncError, type SyncState, type SyncStatus, type TreeItem, type Workspace } from '../types'
import { commitMessage, commitSummary, titleOfText } from './commitMessage'
import { blobsToDownload, planPull, type PullPlan } from './pull'
import { applyToTree, isEmptyNewPage, planPush, type PushPlan } from './push'
import { expiredTrashEntries, planTrashPurge } from './trash'
import { WorkingSet, addTrashCopy, hhmm, isDirty, namesInDir, newRow, settleDeletedConflicts, withFrontmatter, withNewId } from './working'

export type ConflictChoice = 'keep-both' | 'mine' | 'theirs'

export interface InitialSyncProgress {
  phase: 'list' | 'download' | 'index' | 'done'
  done: number
  total: number
}

/** Timer functions, injectable for tests. */
export interface SyncTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** Scheduling constants (SYNC-4, SYNC-7, SYNC-12, SYNC-13), overridable for tests. */
export interface SyncIntervals {
  /** SYNC-4: pull every 60 s while visible. */
  pollMs: number
  /** SYNC-7: push 5 s after the last edit… */
  pushDelayMs: number
  /** …at most once every 30 s. */
  pushSpacingMs: number
  /** SYNC-12: network back-off from 5 s… */
  backoffMinMs: number
  /** …to 5 min. */
  backoffMaxMs: number
  /** SYNC-13: secondary rate limit without `retry-after`: 60 s, then exponential… */
  rateLimitMinMs: number
  /** …up to this. */
  rateLimitMaxMs: number
  /** SYNC-13: stop polling below this many remaining requests. */
  rateLimitFloor: number
}

export const DEFAULT_INTERVALS: SyncIntervals = {
  pollMs: 60_000,
  pushDelayMs: 5_000,
  pushSpacingMs: 30_000,
  backoffMinMs: 5_000,
  backoffMaxMs: 5 * 60_000,
  rateLimitMinMs: 60_000,
  rateLimitMaxMs: 30 * 60_000,
  rateLimitFloor: 200,
}

/** SYNC-14. */
export const MAX_PAGES = 5000
export const MAX_PAGE_BYTES = 1024 * 1024

/** A `syncingSince` older than this is a tab that died mid-sync. */
const STALE_SYNC_MS = 2 * 60_000

export interface SyncEngineOptions {
  db: NotesDB
  workspace: Workspace
  device: DeviceInfo
  client: GitHubClient
  /** SYNC-3: write the open editors into `files.text` before a pull or push. */
  flushEditors: () => Promise<void>
  /** Called after a pull or push changed `files` rows (the app re-indexes these paths). */
  onFilesChanged: (paths: string[]) => Promise<void> | void
  /** Notices for the user (SYNC-5 rule 3 and 6, SYNC-6a, SYNC-14). */
  onNotice?: (message: string) => void
  /** For tests. */
  now?: () => number
  /** For tests: timers (default: the global ones). */
  timers?: SyncTimers
  /** Web Locks (STORE-6). Default `navigator.locks` when available; null disables. */
  locks?: Pick<LockManager, 'request'> | null
  /** Default `navigator.onLine` (true when unknown). */
  isOnline?: () => boolean
  /** Default `document.visibilityState !== 'hidden'` (true without a document). */
  isVisible?: () => boolean
  /** SYNC-7 「自動同步」. Default: `config.ui.autoSync` (true when unset). */
  autoSync?: () => boolean | Promise<boolean>
  /** SETUP-13: in a Safari tab pushes ignore the 30 s spacing. */
  safariTabMode?: boolean | (() => boolean)
  intervals?: Partial<SyncIntervals>
}

type RunKind = 'pull' | 'push' | 'resolve'

function toSyncError(e: unknown, at: number): SyncError {
  const kind = e instanceof GitHubError ? e.kind : 'unknown'
  return { kind, message: t.sync.errors[kind] ?? t.sync.errors.unknown, at, retryAt: null }
}

export class SyncEngine {
  private readonly intervals: SyncIntervals
  private started = false
  private running: RunKind | null = null
  private mutex: Promise<unknown> = Promise.resolve()
  private pushTimer: unknown = null
  private pollTimer: unknown = null
  private retryTimer: unknown = null
  private retryWantsPush = false
  /** The failed cycle was 「立即同步」: its retry pushes even with 「自動同步」 off. */
  private retryManual = false
  private stopped = false
  private networkFailures = 0
  private rateFailures = 0
  private blocked = false
  private pollPausedUntil = 0
  private lastPushStartedAt = 0
  private changeSeq = 0
  private remoteEmpty = false
  private readonly warned = new Set<string>()
  private readonly deviceCache = new Map<string, { device: string | null; at: number | null }>()
  private readonly cleanups: Array<() => void> = []
  private readonly inflight = new Set<Promise<unknown>>()

  constructor(public readonly options: SyncEngineOptions) {
    this.intervals = { ...DEFAULT_INTERVALS, ...options.intervals }
  }

  // ---------------------------------------------------------------------------------------------
  // Public API

  /** Start timers and listeners (SYNC-4, SYNC-7, SYNC-12): visibility, online, 60 s polling. */
  start(): void {
    if (this.started) return
    this.started = true
    this.stopped = false
    const doc = (globalThis as { document?: Document }).document
    if (doc && typeof doc.addEventListener === 'function') {
      const onVisibility = () => this.handleVisibilityChange()
      doc.addEventListener('visibilitychange', onVisibility)
      this.cleanups.push(() => doc.removeEventListener('visibilitychange', onVisibility))
    }
    const win = globalThis as { addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener'] }
    if (typeof win.addEventListener === 'function' && typeof win.removeEventListener === 'function') {
      const onOnline = () => this.handleOnline()
      const onHide = () => this.pushSoon()
      win.addEventListener('online', onOnline)
      win.addEventListener('pagehide', onHide)
      this.cleanups.push(() => {
        win.removeEventListener?.('online', onOnline)
        win.removeEventListener?.('pagehide', onHide)
      })
    }
    this.schedulePoll()
    // SYNC-4: pull at start; push edits left from an earlier session.
    this.track(
      (async () => {
        const state = await this.state()
        this.lastPushStartedAt = state.lastPushStartedAt ?? 0
        const push = (await this.hasPending()) && (await this.autoSyncEnabled())
        if (push) this.retryWantsPush = true
        await this.runCycle(push)
      })(),
    )
  }

  stop(): void {
    this.started = false
    this.stopped = true
    for (const timer of [this.pushTimer, this.pollTimer, this.retryTimer]) if (timer !== null) this.timers.clearTimeout(timer)
    this.pushTimer = this.pollTimer = this.retryTimer = null
    for (const cleanup of this.cleanups.splice(0)) cleanup()
  }

  /** 「立即同步」: pull, then push, ignoring the 30 s spacing. Never throws; see `getStatus()`. */
  async syncNow(): Promise<void> {
    this.blocked = false
    this.networkFailures = 0
    this.rateFailures = 0
    this.clearTimer('retryTimer')
    this.clearTimer('pushTimer')
    await this.track(this.runCycle(true, true))
  }

  /** SYNC-5. Throws on failure (the error is also recorded for `getStatus()`). */
  async pull(): Promise<void> {
    await this.recording(() => this.exclusive('pull', () => this.pullLocked()))
  }

  /** SYNC-8 (pulls first). Throws on failure (the error is also recorded for `getStatus()`). */
  async push(): Promise<void> {
    const seq = this.changeSeq
    await this.recording(() => this.exclusive('push', () => this.pushLocked()))
    if (seq === this.changeSeq) this.retryWantsPush = false
  }

  /** SYNC-7: call after every local edit. Pushes 5 s after the last edit, at most every 30 s. */
  notifyLocalChange(): void {
    this.changeSeq++
    this.retryWantsPush = true
    this.clearTimer('pushTimer')
    if (this.stopped) return
    let delay = this.intervals.pushDelayMs
    if (!this.isSafariTabMode()) delay = Math.max(delay, this.lastPushStartedAt + this.intervals.pushSpacingMs - this.now())
    this.pushTimer = this.timers.setTimeout(() => {
      this.pushTimer = null
      this.track(this.autoPush())
    }, delay)
  }

  /** SYNC-7: leaving a page or hiding the app pushes right away (best effort). */
  pushSoon(): void {
    this.track(
      (async () => {
        if (!(await this.hasPending())) return
        this.clearTimer('pushTimer')
        await this.autoPush()
      })(),
    )
  }

  /**
   * SETUP-10: the first full download, with progress. Throws on failure.
   * With `notifyFilesChanged: false` the caller rebuilds the index itself (for example with
   * `reindexAll`), so `onFilesChanged` is not called with every path.
   */
  async initialSync(onProgress: (p: InitialSyncProgress) => void, options: { notifyFilesChanged?: boolean } = {}): Promise<void> {
    await this.recording(() =>
      this.exclusive('pull', async () => {
        onProgress({ phase: 'list', done: 0, total: 0 })
        await this.pullLocked({
          onDownload: (done, total) => onProgress({ phase: 'download', done, total }),
          onIndex: (total) => onProgress({ phase: 'index', done: 0, total }),
          notify: options.notifyFilesChanged !== false,
        })
        onProgress({ phase: 'done', done: 1, total: 1 })
      }),
    )
  }

  /** SYNC-6: apply the user's choice for a page in conflict. */
  async resolveConflict(path: string, choice: ConflictChoice): Promise<void> {
    const changed = await this.exclusive('resolve', () => this.resolveLocked(path, choice))
    if (changed.length > 0) {
      await this.options.onFilesChanged(changed)
      this.notifyLocalChange()
    }
  }

  /** Current status (SYNC-11), derived from the `sync` and `files` tables and `navigator.onLine`. */
  async getStatus(): Promise<SyncStatus> {
    const { db } = this.options
    const state = await this.state()
    if (this.running === 'pull' || this.running === 'push') return { state: 'syncing' }
    if (state.syncingSince && this.now() - state.syncingSince < STALE_SYNC_MS) return { state: 'syncing' }
    const dirty = await db.files.filter((r) => (r.dirty || r.deleted) && !isEmptyNewPage(r)).toArray()
    const uploads = await db.uploads.count()
    const pages = dirty.filter((r) => r.kind === 'page' && !(r.deleted && r.movedTo)).length
    // SYNC-11: 離線 is "no network", which `navigator.onLine` alone does not always know.
    if (!this.isOnline() || state.lastError?.kind === 'network') return { state: 'offline', pending: pages }
    if (state.lastError) return { state: 'error', error: state.lastError }
    if (dirty.length > 0 || uploads > 0) return { state: 'pending', pending: pages }
    return { state: 'synced' }
  }

  /** The window became visible or hidden (also wired to `visibilitychange` by `start()`). */
  handleVisibilityChange(visible = this.isVisible()): void {
    if (visible) {
      if (!this.blocked) this.track(this.runCycle(false))
      this.schedulePoll()
    } else {
      this.clearTimer('pollTimer')
      this.pushSoon()
    }
  }

  /** The browser came back online (SYNC-12): retry right away. */
  handleOnline(): void {
    if (this.blocked) return
    this.clearTimer('retryTimer')
    this.track(
      (async () => {
        const manual = this.retryManual
        const push = (this.retryWantsPush || (await this.hasPending())) && (manual || (await this.autoSyncEnabled()))
        await this.runCycle(push, manual)
      })(),
    )
  }

  /** Resolves once no sync started by the engine is running (for tests and shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight])
  }

  // ---------------------------------------------------------------------------------------------
  // Environment

  private get timers(): SyncTimers {
    return (
      this.options.timers ?? {
        setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
        clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
      }
    )
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private isOnline(): boolean {
    if (this.options.isOnline) return this.options.isOnline()
    const nav = (globalThis as { navigator?: Navigator }).navigator
    return nav?.onLine !== false
  }

  private isVisible(): boolean {
    if (this.options.isVisible) return this.options.isVisible()
    const doc = (globalThis as { document?: Document }).document
    return !doc || doc.visibilityState !== 'hidden'
  }

  private isSafariTabMode(): boolean {
    const v = this.options.safariTabMode
    return typeof v === 'function' ? v() : !!v
  }

  private async autoSyncEnabled(): Promise<boolean> {
    if (this.options.autoSync) return this.options.autoSync()
    const ui = await this.options.db.config.get('ui')
    return ui?.key === 'ui' ? ui.value.autoSync !== false : true
  }

  private locks(): Pick<LockManager, 'request'> | null {
    if (this.options.locks !== undefined) return this.options.locks
    const nav = (globalThis as { navigator?: Navigator }).navigator
    return nav?.locks ?? null
  }

  private clearTimer(name: 'pushTimer' | 'pollTimer' | 'retryTimer'): void {
    if (this[name] !== null) this.timers.clearTimeout(this[name])
    this[name] = null
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p)
    const done = () => this.inflight.delete(p)
    p.then(done, done)
    return p
  }

  // ---------------------------------------------------------------------------------------------
  // Scheduling

  private schedulePoll(): void {
    this.clearTimer('pollTimer')
    if (!this.started) return
    this.pollTimer = this.timers.setTimeout(() => {
      this.pollTimer = null
      this.track(
        (async () => {
          const paused = this.now() < this.pollPausedUntil
          if (this.isVisible() && this.isOnline() && !this.blocked && !paused && this.retryTimer === null) await this.runCycle(false)
          if (this.isVisible()) this.schedulePoll()
        })(),
      )
    }, this.intervals.pollMs)
  }

  private async autoPush(): Promise<void> {
    if (this.blocked || this.retryTimer !== null) return
    if (!(await this.autoSyncEnabled())) return
    await this.runCycle(true)
  }

  /** One scheduled pull or push. Failures are recorded and retried per SYNC-12 / SYNC-13. */
  private async runCycle(push: boolean, manual = false): Promise<void> {
    try {
      if (push) await this.push()
      else await this.pull()
      this.networkFailures = 0
      this.rateFailures = 0
      this.retryManual = false
    } catch (e) {
      this.onFailure(e, push, manual)
    } finally {
      const rl = this.options.client.rateLimit
      if (rl.remaining !== null && rl.remaining < this.intervals.rateLimitFloor && rl.resetAt !== null) {
        this.pollPausedUntil = rl.resetAt
      }
    }
  }

  private onFailure(e: unknown, push: boolean, manual: boolean): void {
    if (push) this.retryWantsPush = true
    if (manual) this.retryManual = true
    if (!(e instanceof GitHubError)) console.warn('sync: unexpected error', e)
    if (this.stopped) return
    const kind = e instanceof GitHubError ? e.kind : 'unknown'
    let delay: number
    if (kind === 'unauthorized') {
      // SETUP-13: read-only until the token is replaced; nothing retries by itself.
      this.blocked = true
      return
    }
    if (kind === 'network' || kind === 'server' || kind === 'conflict-retry') {
      delay = Math.min(this.intervals.backoffMinMs * 2 ** this.networkFailures, this.intervals.backoffMaxMs)
      this.networkFailures++
    } else if (kind === 'rate-limited') {
      const after = e instanceof GitHubError ? e.retryAfter : null
      delay = after !== null ? after * 1000 : Math.min(this.intervals.rateLimitMinMs * 2 ** this.rateFailures, this.intervals.rateLimitMaxMs)
      this.rateFailures++
    } else {
      return
    }
    const retryAt = this.now() + delay
    this.clearTimer('retryTimer')
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null
      this.track(
        (async () => {
          const manual = this.retryManual
          const push = this.retryWantsPush && (manual || (await this.autoSyncEnabled()))
          await this.runCycle(push, manual)
        })(),
      )
    }, delay)
    this.track(this.patchState((s) => (s.lastError ? { lastError: { ...s.lastError, retryAt } } : {})))
  }

  // ---------------------------------------------------------------------------------------------
  // Locking and state

  /** SYNC-3 / STORE-6: one pull or push at a time; editors are flushed while the lock is held. */
  private async exclusive<T>(kind: RunKind, fn: () => Promise<T>): Promise<T> {
    const task = async (): Promise<T> => {
      this.running = kind
      const syncing = kind !== 'resolve'
      if (syncing) await this.patchState(() => ({ syncingSince: this.now() }))
      try {
        await this.options.flushEditors()
        return await fn()
      } finally {
        this.running = null
        if (syncing) await this.patchState(() => ({ syncingSince: null }))
      }
    }
    const locks = this.locks()
    if (locks) return locks.request('sync', task) as Promise<T>
    const run = this.mutex.then(task, task)
    this.mutex = run.catch(() => undefined)
    return run
  }

  private async recording<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      const error = toSyncError(e, this.now())
      await this.patchState(() => ({ lastError: error })).catch(() => undefined)
      throw e
    }
  }

  private async state(): Promise<SyncState> {
    return (await this.options.db.sync.get('state')) ?? { ...EMPTY_SYNC_STATE }
  }

  private async patchState(patch: (s: SyncState) => Partial<SyncState>): Promise<void> {
    const { db } = this.options
    await db.transaction('rw', db.sync, async () => {
      const s = (await db.sync.get('state')) ?? { ...EMPTY_SYNC_STATE }
      await db.sync.put({ ...s, ...patch(s) })
    })
  }

  private async hasPending(): Promise<boolean> {
    const { db } = this.options
    if ((await db.uploads.count()) > 0) return true
    const dirty = await db.files.filter((r) => (r.dirty || r.deleted) && !(r.conflict && !r.deleted) && !isEmptyNewPage(r)).first()
    return !!dirty
  }

  /**
   * Writes the touched rows of a working set in one transaction, unless one of them changed in the
   * database since it was read (a local edit during the network part): then returns false and
   * the caller plans again.
   */
  private async commitWork(work: WorkingSet, statePatch?: Partial<SyncState>): Promise<boolean> {
    const { db } = this.options
    return db.transaction('rw', db.files, db.sync, async () => {
      const paths = [...work.touched]
      const current = await db.files.bulkGet(paths)
      for (let i = 0; i < paths.length; i++) {
        if (JSON.stringify(current[i] ?? null) !== work.signature(paths[i])) return false
      }
      const puts: FileRow[] = []
      const dels: string[] = []
      for (const p of paths) {
        const row = work.get(p)
        if (row) puts.push(row)
        else dels.push(p)
      }
      if (dels.length > 0) await db.files.bulkDelete(dels)
      if (puts.length > 0) await db.files.bulkPut(puts)
      if (statePatch) {
        const s = (await db.sync.get('state')) ?? { ...EMPTY_SYNC_STATE }
        await db.sync.put({ ...s, ...statePatch })
      }
      return true
    })
  }

  // ---------------------------------------------------------------------------------------------
  // Pull (SYNC-5)

  private async pullLocked(
    hooks: { onDownload?: (done: number, total: number) => void; onIndex?: (total: number) => void; notify?: boolean } = {},
  ): Promise<void> {
    const { client, workspace: ws, db } = this.options
    const state = await this.state()
    let ref
    try {
      ref = await client.getRef(ws.owner, ws.repo, ws.branch, state.tree ? state.etag : null)
    } catch (e) {
      if (e instanceof GitHubError && e.status === 409) {
        // An empty repo (SETUP-9 normally initialises it first).
        this.remoteEmpty = true
        await this.patchState(() => ({ lastPullAt: this.now(), lastError: null }))
        return
      }
      throw e
    }
    this.remoteEmpty = false
    if (ref.notModified || (ref.sha === state.headSha && state.tree)) {
      await this.patchState(() => ({ lastPullAt: this.now(), lastError: null, ...(ref.notModified ? {} : { etag: ref.etag }) }))
      await this.afterPull([], hooks)
      return
    }
    const commit = await client.getCommit(ws.owner, ws.repo, ref.sha)
    const tree = await client.getTree(ws.owner, ws.repo, commit.treeSha, true)
    if (tree.truncated) throw new GitHubError('too-large', 0, 'The repository tree is truncated')
    const remote = new Map<string, TreeItem>()
    for (const e of tree.entries) {
      if (e.type === 'tree') continue
      remote.set(e.path, { sha: e.sha, mode: e.mode, type: e.type, ...(e.size !== undefined ? { size: e.size } : {}) })
    }
    const snapshot = Object.fromEntries(remote)

    let rows = await db.files.toArray()
    const texts = await client.getBlobTexts(ws.owner, ws.repo, blobsToDownload(rows, remote), hooks.onDownload)
    for (let attempt = 0; ; attempt++) {
      const plan = planPull({ rows, remote, texts, now: this.now(), newId: () => ulid(this.now()) })
      await this.fillConflictDevices(plan)
      const ok = await this.commitWork(plan.work, {
        headSha: ref.sha,
        treeSha: tree.sha,
        etag: ref.etag,
        tree: snapshot,
        lastPullAt: this.now(),
        lastError: null,
      })
      if (ok) {
        for (const n of plan.notices) this.options.onNotice?.(n)
        await this.afterPull(plan.work.changedPaths(), hooks)
        return
      }
      if (attempt >= 5) throw new GitHubError('unknown', 0, 'Local changes kept arriving during the pull')
      rows = await db.files.toArray()
      const missing = blobsToDownload(rows, remote).filter((sha) => !texts.has(sha))
      if (missing.length > 0) for (const [k, v] of await client.getBlobTexts(ws.owner, ws.repo, missing)) texts.set(k, v)
    }
  }

  /** Trash retention, SYNC-14 warnings, then `onFilesChanged`. */
  private async afterPull(changed: string[], hooks: { onIndex?: (total: number) => void; notify?: boolean }): Promise<void> {
    const purged = await this.purgeExpiredTrash()
    const all = [...new Set([...changed, ...purged])]
    await this.checkLimits(all)
    hooks.onIndex?.(all.length)
    if (all.length > 0 && hooks.notify !== false) await this.options.onFilesChanged(all)
    if (purged.length > 0 && this.running !== 'push') this.notifyLocalChange()
  }

  /** SYNC-6: name the other side from the `Device:` trailer of the latest commit touching the file. */
  private async fillConflictDevices(plan: PullPlan): Promise<void> {
    const { client, workspace: ws } = this.options
    for (const { path, remotePath } of plan.conflicts) {
      const row = plan.work.get(path)
      if (!row?.conflict) continue
      const key = `${remotePath}@${row.conflict.remoteSha}`
      let info = this.deviceCache.get(key)
      if (!info) {
        try {
          const [latest] = await client.listCommits(ws.owner, ws.repo, remotePath, 1)
          info = { device: latest?.device ?? null, at: latest ? Date.parse(latest.date) || null : null }
        } catch (e) {
          if (e instanceof GitHubError && (e.kind === 'unauthorized' || e.kind === 'network')) throw e
          info = { device: null, at: null }
        }
        this.deviceCache.set(key, info)
      }
      plan.work.put({ ...row, conflict: { ...row.conflict, remoteDevice: info.device, remoteAt: info.at } })
    }
  }

  /** DATA-22 retention. Returns the changed paths. */
  private async purgeExpiredTrash(): Promise<string[]> {
    const { db } = this.options
    const [index, settings] = await db.files.bulkGet([TRASH_INDEX_PATH, SETTINGS_PATH])
    if (expiredTrashEntries(index, settings, this.now()).length === 0) return []
    for (let attempt = 0; attempt < 5; attempt++) {
      const state = await this.state()
      const work = new WorkingSet(await db.files.toArray())
      const purged = planTrashPurge(work, state.tree, this.now())
      if (purged.length === 0) return []
      if (await this.commitWork(work)) return work.changedPaths()
    }
    return []
  }

  /** SYNC-14: warn above 5,000 pages and for pages over 1 MB. */
  private async checkLimits(changed: string[]): Promise<void> {
    const { db, onNotice } = this.options
    if (!onNotice) return
    if (!this.warned.has('pages') && (await db.files.where('kind').equals('page').count()) > MAX_PAGES) {
      this.warned.add('pages')
      onNotice(t.sync.tooManyPages)
    }
    if (changed.length === 0) return
    for (const row of await db.files.bulkGet(changed)) {
      if (!row || row.kind !== 'page' || row.text === null || this.warned.has(row.path)) continue
      if (row.text.length * 3 > MAX_PAGE_BYTES && new TextEncoder().encode(row.text).length > MAX_PAGE_BYTES) {
        this.warned.add(row.path)
        onNotice(t.sync.pageTooLarge)
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Push (SYNC-8)

  private async pushLocked(): Promise<void> {
    const { client, workspace: ws, device, db } = this.options
    await this.pullLocked()
    if (this.remoteEmpty) {
      await this.createFirstCommit()
      await this.pullLocked()
    }
    const uploaded = new Map<string, string>()
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) await this.pullLocked()
      await this.settleConflicts()
      const state = await this.state()
      const rows = await db.files.toArray()
      const plan = planPush(rows, await db.uploads.toArray(), state.tree ?? {})
      if (plan.entries.length === 0 && plan.uploads.length === 0) {
        await this.settle(plan)
        return
      }
      // Step 2: remember exactly what is being pushed.
      const startedAt = this.now()
      this.lastPushStartedAt = startedAt
      await this.markPushing(plan, startedAt)
      // Step 3: attachments.
      const entries = [...plan.entries]
      const uploads: Array<{ path: string; sha: string; mode: string; size: number; sha256: string }> = []
      for (const u of plan.uploads) {
        let sha = uploaded.get(`${u.path}\n${u.sha256}`)
        if (!sha) {
          sha = await client.createBlob(ws.owner, ws.repo, u.blob)
          uploaded.set(`${u.path}\n${u.sha256}`, sha)
        }
        if (state.tree?.[u.path]?.sha !== sha) entries.push({ path: u.path, mode: '100644', type: 'blob', sha })
        uploads.push({ path: u.path, sha, mode: '100644', size: u.blob.size, sha256: u.sha256 })
      }
      if (entries.length === 0) {
        // Only attachments that are already on GitHub (an earlier push was cut off): no commit needed.
        await this.finishPush(plan, uploads, state.headSha!, state.treeSha!, state)
        return
      }
      // Steps 4 to 6.
      const byPath = new Map(rows.map((r) => [r.path, r]))
      const titleAt = (path: string) => {
        const r = byPath.get(path)
        return r && !r.deleted && r.text !== null && r.kind === 'page' ? titleOfText(path, r.text) : null
      }
      const message = commitMessage(commitSummary(plan.changes, titleAt), device.name)
      let commitSha: string
      let treeSha: string
      try {
        const tree = await client.createTree(ws.owner, ws.repo, state.treeSha, entries)
        const commit = await client.createCommit(ws.owner, ws.repo, { message, tree: tree.sha, parents: state.headSha ? [state.headSha] : [] })
        await client.updateRef(ws.owner, ws.repo, ws.branch, commit.sha, false)
        commitSha = commit.sha
        treeSha = tree.sha
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 422 || e.status === 409)) {
          if (attempt < 3) continue
          throw new GitHubError('conflict-retry', e.status, 'The branch moved during three pushes in a row')
        }
        throw e
      }
      // Step 7.
      await this.finishPush(plan, uploads, commitSha, treeSha, state)
      return
    }
  }

  /** See `settleDeletedConflicts`: runs before planning a push (the pull may have been a 304). */
  private async settleConflicts(): Promise<void> {
    const { db } = this.options
    for (let attempt = 0; attempt < 5; attempt++) {
      const work = new WorkingSet(await db.files.toArray())
      if (!settleDeletedConflicts(work)) return
      if (await this.commitWork(work)) {
        await this.options.onFilesChanged(work.changedPaths())
        return
      }
    }
  }

  /** An empty repo (409) cannot take Git Data API writes: create the first file with the Contents API. */
  private async createFirstCommit(): Promise<void> {
    const { client, workspace: ws, device, db } = this.options
    const plan = planPush(await db.files.toArray(), [], {})
    const first = plan.pushed.find((p) => p.action === 'content' && p.text !== null)
    const change = plan.changes.find((c) => c.path === first?.path)
    if (!first || !change) return
    await client.createFile(ws.owner, ws.repo, first.path, first.text!, commitMessage(commitSummary([change]), device.name), ws.branch)
  }

  private async markPushing(plan: PushPlan, startedAt: number): Promise<void> {
    const { db } = this.options
    await db.transaction('rw', db.files, db.sync, async () => {
      for (const p of plan.pushed) {
        if (p.action !== 'content') continue
        const cur = await db.files.get(p.path)
        if (cur) await db.files.put({ ...cur, pushing: p.text })
      }
      const s = (await db.sync.get('state')) ?? { ...EMPTY_SYNC_STATE }
      await db.sync.put({ ...s, lastPushStartedAt: startedAt })
    })
  }

  /** Nothing to push: deleted rows that never reached GitHub, and stale dirty flags, become clean. */
  private async settle(plan: PushPlan): Promise<void> {
    if (plan.drop.length === 0 && plan.settle.length === 0) return
    const { db } = this.options
    const changed: string[] = []
    await db.transaction('rw', db.files, async () => {
      changed.push(...(await this.settleRows(plan)))
    })
    if (changed.length > 0) await this.options.onFilesChanged(changed)
  }

  private async settleRows(plan: PushPlan): Promise<string[]> {
    const { db } = this.options
    const changed: string[] = []
    for (const path of plan.drop) {
      const cur = await db.files.get(path)
      if (cur?.deleted) {
        await db.files.delete(path)
        changed.push(path)
      }
    }
    for (const path of plan.settle) {
      const cur = await db.files.get(path)
      if (!cur || isDirty(cur)) continue
      if (cur.kind === 'blob' && !cur.movedFrom) await db.files.delete(path)
      else await db.files.put({ ...cur, dirty: false })
      changed.push(path)
    }
    return changed
  }

  /** SYNC-8 step 7. */
  private async finishPush(
    plan: PushPlan,
    uploads: Array<{ path: string; sha: string; mode: string; size: number; sha256: string }>,
    commitSha: string,
    treeSha: string,
    state: SyncState,
  ): Promise<void> {
    const { db } = this.options
    const shas = new Map<string, string>()
    for (const p of plan.pushed) if (p.action === 'content') shas.set(p.path, await gitBlobSha(p.text!))
    const tree = applyToTree(state.tree ?? {}, [
      ...plan.pushed.map((p) => ({ path: p.path, mode: p.mode, sha: p.action === 'delete' ? null : p.action === 'sha' ? p.sha : shas.get(p.path)! })),
      ...uploads.map((u) => ({ path: u.path, mode: u.mode, sha: u.sha, size: u.size })),
    ])
    const now = this.now()
    const changed = new Set<string>()
    await db.transaction('rw', db.files, db.uploads, db.sync, async () => {
      for (const p of plan.pushed) {
        const cur = await db.files.get(p.path)
        changed.add(p.path)
        if (p.action === 'delete') {
          if (!cur) continue
          if (cur.deleted) await db.files.delete(p.path)
          else await db.files.put({ ...cur, baseSha: null, baseText: null, pushing: null, dirty: true })
          continue
        }
        if (p.action === 'sha') {
          if (!cur) continue
          if (!cur.deleted && cur.blobSha === p.sha) await db.files.delete(p.path)
          else {
            const next = { ...cur, baseSha: p.sha }
            await db.files.put({ ...next, dirty: isDirty(next) })
          }
          continue
        }
        const sha = shas.get(p.path)!
        if (!cur) {
          // Removed here while the push ran: it is on GitHub now, so the next push deletes it.
          await db.files.put({
            path: p.path,
            kind: classifyPath(p.path) ?? 'page',
            baseSha: sha,
            baseText: p.text,
            text: p.text,
            pushing: null,
            dirty: true,
            deleted: true,
            conflict: null,
            updatedAt: now,
          })
          continue
        }
        const next: FileRow = { ...cur, baseSha: sha, baseText: p.text, pushing: null }
        await db.files.put({ ...next, dirty: isDirty(next) })
      }
      // A move is done once both halves are pushed: the old row is gone.
      for (const p of plan.pushed) {
        if (p.action === 'delete') continue
        const cur = await db.files.get(p.path)
        if (cur?.movedFrom && !(await db.files.get(cur.movedFrom))) await db.files.put({ ...cur, movedFrom: null })
      }
      for (const u of uploads) {
        const row = await db.uploads.get(u.path)
        if (row && row.sha256 === u.sha256) await db.uploads.delete(u.path)
      }
      for (const path of await this.settleRows(plan)) changed.add(path)
      const s = (await db.sync.get('state')) ?? { ...EMPTY_SYNC_STATE }
      await db.sync.put({ ...s, headSha: commitSha, treeSha, tree, lastPushAt: now, lastError: null })
    })
    await this.options.onFilesChanged([...changed])
  }

  // ---------------------------------------------------------------------------------------------
  // Conflicts (SYNC-6)

  private async resolveLocked(path: string, choice: ConflictChoice): Promise<string[]> {
    const { db, device } = this.options
    for (let attempt = 0; attempt < 5; attempt++) {
      const state = await this.state()
      const work = new WorkingSet(await db.files.toArray())
      const row = work.get(path)
      if (!row?.conflict) return []
      const c = row.conflict
      const now = this.now()
      if (row.deleted) {
        // Deleted here meanwhile: the delete stands.
        work.put({ ...row, conflict: null })
        if (await this.commitWork(work)) return work.changedPaths()
        continue
      }
      const local = row.text ?? ''
      const movedTarget = row.baseSha === null && !!row.movedFrom
      const resolved: FileRow = { ...row, conflict: null, updatedAt: now }
      if (choice === 'theirs') {
        work.put({ ...resolved, text: c.remoteText, dirty: isDirty({ ...resolved, text: c.remoteText }) })
        addTrashCopy({ work, entryId: ulid(now), text: local, originalPath: path, reason: 'replaced', now })
      } else if (choice === 'mine') {
        work.put({ ...resolved, dirty: true })
        addTrashCopy({ work, entryId: ulid(now), text: c.remoteText, originalPath: movedTarget ? row.movedFrom! : path, reason: 'replaced', now })
      } else if (movedTarget) {
        // The remote version stays at the old path; the local one stays here as a page of its own.
        const src = work.get(row.movedFrom!)
        if (src && src.deleted && src.baseText !== null) {
          work.put({ ...src, deleted: false, movedTo: null, text: src.baseText, dirty: false, updatedAt: now })
        }
        work.put({ ...resolved, movedFrom: null, text: withNewId(local, ulid(now)), dirty: true })
      } else {
        // 「兩個都保留」: the remote version stays in place, the local one becomes a sibling page.
        work.put({ ...resolved, text: c.remoteText, dirty: isDirty({ ...resolved, text: c.remoteText }) })
        const title = t.conflict.copyTitle(titleOfText(path, local), device.name, hhmm(c.localAt))
        const dir = dirname(path)
        const { path: copyPath, titleInFrontmatter } = pagePathFor(title, dir, namesInDir(dir, state.tree, work))
        const text = withFrontmatter(local, { id: ulid(now), title: titleInFrontmatter ? title : null })
        work.put(newRow(copyPath, 'page', text, now))
      }
      if (await this.commitWork(work)) return work.changedPaths()
    }
    throw new Error('sync: the page kept changing while resolving the conflict')
  }
}

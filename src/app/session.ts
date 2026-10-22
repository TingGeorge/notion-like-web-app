/**
 * The running app session: workspace config, GitHub client, sync engine, cross-tab messages,
 * and the registry of open editors that must be flushed before a sync (SYNC-3).
 */
import { GitHubClient } from '../lib/github/client'
import { deviceName, isSafariTab } from '../lib/data/device'
import { ulid } from '../lib/data/ulid'
import { db, type ConfigRow } from '../lib/store/db'
import { SyncEngine } from '../lib/sync/engine'
import { DEFAULT_UI, NEVER_EXPIRES, type DeviceInfo, type UiPrefs, type Workspace } from '../lib/types'
import { flushSearchIndex, getSearchIndex, refreshSearchFor, reindexPaths } from '../lib/workspace/indexer'

type Flusher = () => Promise<void>

const flushers = new Set<Flusher>()

/** Register an open editor's flush function (STORE-3, SYNC-3). Returns an unregister function. */
export function registerFlusher(fn: Flusher): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

export async function flushEditors(): Promise<void> {
  await Promise.all([...flushers].map((fn) => fn().catch((e) => console.error('flush failed', e))))
}

// --- Cross-tab messages (STORE-6) -------------------------------------------------------------

type Message = { type: 'reindexed'; paths: string[] } | { type: 'workspace-changed' } | { type: 'flush' }

const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('github-notes') : null

export function broadcast(message: Message): void {
  channel?.postMessage(message)
}

if (channel) {
  channel.onmessage = (event: MessageEvent<Message>) => {
    const msg = event.data
    if (msg.type === 'reindexed') void refreshSearchFor(msg.paths)
    else if (msg.type === 'flush') void flushEditors()
    else if (msg.type === 'workspace-changed') location.reload()
  }
}

/** Re-index after files changed locally or from a pull, and tell the other tabs. */
export async function filesChanged(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await reindexPaths(paths)
  broadcast({ type: 'reindexed', paths })
}

// --- Config ---------------------------------------------------------------------------------

export async function loadWorkspace(): Promise<Workspace | null> {
  const row = await db().config.get('workspace')
  if (!row || row.key !== 'workspace') return null
  // Older versions could store '' when the date was cleared, or the link's NEVER_EXPIRES: no expiry (SETUP-5).
  const expires = row.value.tokenExpiresOn
  return { ...row.value, tokenExpiresOn: expires && expires !== NEVER_EXPIRES ? expires : null }
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  await db().config.put({ key: 'workspace', value: workspace } as ConfigRow)
}

export async function loadDevice(): Promise<DeviceInfo> {
  const row = await db().config.get('device')
  if (row && row.key === 'device') return row.value
  const device: DeviceInfo = { id: ulid(), name: deviceName() }
  await db().config.put({ key: 'device', value: device })
  return device
}

export async function loadUi(): Promise<UiPrefs> {
  const row = await db().config.get('ui')
  return { ...DEFAULT_UI, ...(row && row.key === 'ui' ? row.value : {}) }
}

export async function updateUi(patch: Partial<UiPrefs>): Promise<UiPrefs> {
  const next = { ...(await loadUi()), ...patch }
  await db().config.put({ key: 'ui', value: next })
  return next
}

/** UI-11: remember the last 8 pages opened on this device. */
export async function rememberRecent(key: string): Promise<void> {
  const ui = await loadUi()
  const recent = [key, ...ui.recent.filter((k) => k !== key)].slice(0, 8)
  if (recent.join() !== ui.recent.join()) await updateUi({ recent })
}

// --- Session ---------------------------------------------------------------------------------

export interface Session {
  workspace: Workspace
  device: DeviceInfo
  client: GitHubClient
  engine: SyncEngine
}

let current: Session | null = null
const noticeListeners = new Set<(message: string) => void>()

export function onNotice(fn: (message: string) => void): () => void {
  noticeListeners.add(fn)
  return () => noticeListeners.delete(fn)
}

export function createClient(token: string): GitHubClient {
  return new GitHubClient({ token })
}

/** Start the session for a configured workspace (idempotent). */
export function startSession(workspace: Workspace, device: DeviceInfo): Session {
  if (current && current.workspace.token === workspace.token && current.workspace.repo === workspace.repo) return current
  current?.engine.stop()
  const client = createClient(workspace.token)
  const engine = new SyncEngine({
    db: db(),
    workspace,
    device,
    client,
    flushEditors,
    onFilesChanged: filesChanged,
    onNotice: (message) => noticeListeners.forEach((fn) => fn(message)),
    // SETUP-13: Safari may delete the data of a plain tab, so push without the 30 s spacing.
    safariTabMode: isSafariTab,
  })
  current = { workspace, device, client, engine }
  return current
}

/** Keep the search index ready: save it when the app is hidden, load it when the app is idle. */
if (typeof window !== 'undefined') {
  const save = () => void flushSearchIndex()
  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save())
}

export function preloadSearch(): void {
  const load = () => void getSearchIndex().catch(() => undefined)
  if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 5000 })
  else setTimeout(load, 2000)
}

export function session(): Session | null {
  return current
}

export function stopSession(): void {
  current?.engine.stop()
  current = null
}

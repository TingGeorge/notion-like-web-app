/** Changing the setup (SETUP-11, SETUP-12) and the first sync (SETUP-10). */
import { strToU8, zipSync } from 'fflate'
import { GitHubError } from '../lib/github/client'
import { classifyPath } from '../lib/data/names'
import { db } from '../lib/store/db'
import type { InitialSyncProgress } from '../lib/sync/engine'
import type { Workspace } from '../lib/types'
import { reindexAll, resetSearchIndex } from '../lib/workspace/indexer'
import { t } from '../strings/zh-TW'
import { notifyWorkspaceChanged } from './actions'
import { createClient, loadDevice, saveWorkspace, session, startSession, stopSession } from './session'

/** SETUP-4: accepted token formats. */
export type TokenCheck = { ok: true; classic: boolean; token: string } | { ok: false; message: string }

export function checkTokenFormat(input: string): TokenCheck {
  const token = input.trim()
  if (/^github_pat_[A-Za-z0-9_]{20,}$/.test(token)) return { ok: true, classic: false, token }
  if (/^ghp_[A-Za-z0-9]{20,}$/.test(token)) return { ok: true, classic: true, token }
  return { ok: false, message: t.setup.notAToken }
}

/** SETUP-11: replace the token (checked like SETUP-4/6, plus the write probe on the current repo). */
export async function replaceToken(input: string, expiresOn: string): Promise<void> {
  const s = session()
  if (!s) throw new Error('no session')
  const check = checkTokenFormat(input)
  if (!check.ok) throw new Error(check.message)
  const client = createClient(check.token)
  let user
  try {
    user = await client.getUser()
  } catch (error) {
    if (error instanceof GitHubError && error.kind === 'unauthorized') throw new Error(t.setup.tokenInvalid)
    throw error
  }
  const probe = await client.probeWrite(s.workspace.owner, s.workspace.repo)
  if (probe === 'no-access') throw new Error(t.setup.noWriteAccess)
  const workspace: Workspace = { ...s.workspace, token: check.token, tokenExpiresOn: expiresOn, login: user.login, name: user.name }
  await saveWorkspace(workspace)
  // SETUP-13: edits made while read-only are pushed with the new token.
  const state = await db().sync.get('state')
  if (state?.lastError?.kind === 'unauthorized') await db().sync.update('state', { lastError: null })
  stopSession()
  const next = startSession(workspace, await loadDevice())
  next.engine.start()
  void next.engine.syncNow()
  notifyWorkspaceChanged()
}

/** Pending local changes (SETUP-12 needs zero before changing repo or disconnecting). */
export async function pendingChanges(): Promise<number> {
  const files = await db()
    .files.filter((f) => f.dirty)
    .count()
  return files + (await db().uploads.count())
}

async function clearNotes(): Promise<void> {
  await db().transaction('rw', [db().files, db().pages, db().uploads, db().assets, db().sync, db().search], async () => {
    await Promise.all([db().files.clear(), db().pages.clear(), db().uploads.clear(), db().assets.clear(), db().sync.clear(), db().search.clear()])
  })
  resetSearchIndex()
}

/** 更換 repo: clear the notes and go back to choosing a repo (D13). The token stays. */
export async function changeRepo(): Promise<void> {
  const s = session()
  stopSession()
  await clearNotes()
  if (s) await db().config.put({ key: 'resume', value: { token: s.workspace.token, tokenExpiresOn: s.workspace.tokenExpiresOn } })
  await db().config.delete('workspace')
  notifyWorkspaceChanged()
}

/** 中斷連結: clear the whole database and return to D01/M01. */
export async function disconnect(): Promise<void> {
  stopSession()
  await clearNotes()
  await db().config.clear()
  notifyWorkspaceChanged()
}

/** 清除這台裝置的資料: clear the caches and download everything again. */
export async function clearDeviceData(onProgress?: (p: InitialSyncProgress) => void): Promise<void> {
  const s = session()
  if (!s) return
  s.engine.stop()
  await clearNotes()
  await runInitialSync(onProgress ?? (() => undefined))
  s.engine.start()
}

/** SETUP-10: download every page, then build the index. */
export async function runInitialSync(onProgress: (p: InitialSyncProgress) => void): Promise<void> {
  const s = session()
  if (!s) throw new Error('no session')
  await s.engine.initialSync(onProgress)
  onProgress({ phase: 'index', done: 0, total: 1 })
  await reindexAll()
  onProgress({ phase: 'done', done: 1, total: 1 })
  // STORE-5: ask the browser not to evict our data.
  void navigator.storage?.persist?.()
}

/** UI-15 匯出: the whole workspace as a .zip (pages, settings and the attachments available). */
export async function exportZip(): Promise<Blob> {
  const s = session()
  const entries: Record<string, Uint8Array> = {}
  const rows = await db().files.toArray()
  for (const row of rows) {
    if (row.deleted || row.text === null || row.kind === 'blob') continue
    if (!classifyPath(row.path)) continue
    entries[row.path] = strToU8(row.text)
  }
  const assetPaths = new Set<string>()
  const state = await db().sync.get('state')
  for (const [path, item] of Object.entries(state?.tree ?? {})) if (item.type === 'blob' && path.startsWith('_assets/')) assetPaths.add(path)
  for (const u of await db().uploads.toArray()) assetPaths.add(u.path)
  for (const path of assetPaths) {
    const local = (await db().uploads.get(path))?.blob ?? (await db().assets.get(path))?.blob
    let blob = local ?? null
    if (!blob && s && navigator.onLine) {
      try {
        blob = await s.client.getFileBlob(s.workspace.owner, s.workspace.repo, path, s.workspace.branch)
      } catch {
        blob = null
      }
    }
    if (blob) entries[path] = new Uint8Array(await blob.arrayBuffer())
  }
  const zipped = zipSync(entries, { level: 6 })
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

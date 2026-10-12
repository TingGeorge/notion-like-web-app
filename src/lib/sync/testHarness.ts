/**
 * Test harness for the sync engine: simulated devices (each with its own NotesDB) against the
 * fake GitHub, a manual clock, and minimal local page operations that follow the `FileRow`
 * conventions in `types.ts`. Used only by tests.
 */
import { FakeGitHub } from '../../../test/fake-github'
import { GitHubClient } from '../github/client'
import { basename, childDirOf, isInside, trashPathFor } from '../data/names'
import { emptyTrashIndex, parseTrashIndex, serializeTrashIndex } from '../data/notesFiles'
import { ulid } from '../data/ulid'
import { NotesDB } from '../store/db'
import { TRASH_DIR, TRASH_INDEX_PATH, type FileRow, type Workspace } from '../types'
import { titleOfText } from './commitMessage'
import { SyncEngine, type SyncEngineOptions, type SyncTimers } from './engine'

export const OWNER = 'me'
export const REPO = 'notes'
export const FULL = `${OWNER}/${REPO}`
export const TOKEN = 'github_pat_11AAAAAA0_test_token_value'

export async function makeGitHub(
  files: Record<string, string | Uint8Array> = { 'README.md': '# Notes\n' },
  opts: { now?: () => number } = {},
): Promise<FakeGitHub> {
  const gh = new FakeGitHub(opts)
  gh.addUser(OWNER, { name: '小明' })
  gh.addToken(TOKEN, { login: OWNER, repos: [FULL] })
  await gh.createRepo(FULL, { files })
  return gh
}

/** Timers driven by the test (`advance`), plus a matching `now`. */
export class ManualClock implements SyncTimers {
  time = Date.UTC(2026, 9, 12, 2, 0, 0)
  private nextId = 1
  private queue: Array<{ id: number; at: number; fn: () => void }> = []

  now = (): number => this.time

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++
    this.queue.push({ id, at: this.time + Math.max(0, ms), fn })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter((t) => t.id !== handle)
  }

  pending(): number[] {
    return this.queue.map((t) => t.at - this.time).sort((a, b) => a - b)
  }

  /** Moves time forward, running due timers in order and waiting for the engines after each. */
  async advance(ms: number, ...engines: SyncEngine[]): Promise<void> {
    const target = this.time + ms
    for (;;) {
      const due = this.queue.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.queue = this.queue.filter((t) => t !== due)
      this.time = due.at
      due.fn()
      for (const e of engines) await e.idle()
    }
    this.time = target
    for (const e of engines) await e.idle()
  }
}

let dbCounter = 0

export interface DeviceOptions extends Partial<SyncEngineOptions> {
  clock?: ManualClock
}

export class Device {
  readonly db: NotesDB
  readonly engine: SyncEngine
  readonly client: GitHubClient
  readonly notices: string[] = []
  readonly changed: string[][] = []
  flushes = 0

  constructor(
    readonly gh: FakeGitHub,
    readonly name: string,
    opts: DeviceOptions = {},
  ) {
    this.db = new NotesDB(`test-${name}-${++dbCounter}-${Math.random().toString(36).slice(2)}`)
    this.client = new GitHubClient({ token: TOKEN, fetch: gh.fetch, now: opts.clock?.now })
    const workspace: Workspace = {
      owner: OWNER,
      repo: REPO,
      branch: 'main',
      token: TOKEN,
      tokenExpiresOn: '2099-01-01',
      login: OWNER,
      linkedAt: '2026-10-01T00:00:00Z',
    }
    const { clock, ...rest } = opts
    this.engine = new SyncEngine({
      db: this.db,
      workspace,
      device: { id: name, name },
      client: this.client,
      flushEditors: async () => {
        this.flushes++
      },
      onFilesChanged: (paths) => {
        this.changed.push(paths)
      },
      onNotice: (m) => this.notices.push(m),
      locks: null,
      isOnline: () => true,
      isVisible: () => true,
      ...(clock ? { now: clock.now, timers: clock } : {}),
      ...rest,
    })
  }

  private now(): number {
    return this.engine.options.now?.() ?? Date.now()
  }

  async row(path: string): Promise<FileRow | undefined> {
    return this.db.files.get(path)
  }

  async text(path: string): Promise<string | null | undefined> {
    return (await this.db.files.get(path))?.text
  }

  async paths(): Promise<string[]> {
    return (await this.db.files.toArray()).filter((r) => !r.deleted).map((r) => r.path).sort()
  }

  async dirty(): Promise<string[]> {
    return (await this.db.files.toArray()).filter((r) => r.dirty).map((r) => r.path).sort()
  }

  /** A local edit (or a new page when the path has no row). */
  async edit(path: string, text: string): Promise<void> {
    const now = this.now()
    const cur = await this.db.files.get(path)
    if (cur) {
      await this.db.files.put({ ...cur, text, dirty: cur.deleted || text !== cur.baseText, updatedAt: now })
    } else {
      await this.db.files.put({
        path,
        kind: path === TRASH_INDEX_PATH || path === '.notes/settings.json' ? 'meta' : 'page',
        baseSha: null,
        baseText: null,
        text,
        pushing: null,
        dirty: true,
        deleted: false,
        conflict: null,
        updatedAt: now,
      })
    }
  }

  /** A local move of a page and its child folder (DATA-7). */
  async move(from: string, to: string): Promise<void> {
    await this.relocate(from, (p) => (p === from ? to : childDirOf(to) + p.slice(childDirOf(from).length)), 'page')
  }

  /** A local delete: the page and its child folder go to `.notes/trash/<id>/` plus an index entry. */
  async remove(path: string): Promise<string> {
    const entryId = ulid(this.now())
    const page = await this.db.files.get(path)
    const target = trashPathFor(entryId, path)
    await this.relocate(path, (p) => (p === path ? target : `${TRASH_DIR}${entryId}/${basename(childDirOf(path))}${p.slice(childDirOf(path).length)}`), 'trash')
    const idxRow = await this.db.files.get(TRASH_INDEX_PATH)
    const index = idxRow?.text ? parseTrashIndex(idxRow.text).value : emptyTrashIndex()
    index.entries.push({
      id: entryId,
      title: titleOfText(path, page?.text ?? null),
      originalPath: path,
      deletedAt: new Date(this.now()).toISOString(),
      reason: 'deleted',
    })
    await this.edit(TRASH_INDEX_PATH, serializeTrashIndex(index))
    return entryId
  }

  private async relocate(from: string, map: (p: string) => string, kind: 'page' | 'trash'): Promise<void> {
    const now = this.now()
    const rows = (await this.db.files.toArray()).filter((r) => !r.deleted && (r.path === from || isInside(r.path, childDirOf(from))))
    const state = await this.db.sync.get('state')
    const blobs = Object.entries(state?.tree ?? {}).filter(([p]) => isInside(p, childDirOf(from)) && !rows.some((r) => r.path === p) && !p.endsWith('.md'))
    await this.db.transaction('rw', this.db.files, async () => {
      for (const r of rows) {
        const dest = map(r.path)
        // The chain stays intact: an unpushed row that came from a move keeps pointing at the
        // original source, and the source points at the new place.
        const origin = r.baseSha !== null ? r.path : (r.movedFrom ?? null)
        if (r.baseSha !== null) await this.db.files.put({ ...r, deleted: true, dirty: true, movedTo: dest, updatedAt: now })
        else await this.db.files.delete(r.path)
        if (r.baseSha === null && r.movedFrom) {
          const src = await this.db.files.get(r.movedFrom)
          if (src) await this.db.files.put({ ...src, movedTo: dest })
        }
        await this.db.files.put({
          ...r,
          path: dest,
          kind: r.kind === 'blob' ? 'blob' : kind,
          baseSha: null,
          baseText: null,
          pushing: null,
          dirty: true,
          deleted: false,
          conflict: null,
          movedTo: null,
          movedFrom: origin,
          updatedAt: now,
        })
      }
      for (const [p, item] of blobs) {
        const dest = map(p)
        await this.db.files.put({ path: p, kind: 'blob', baseSha: item.sha, baseText: null, text: null, blobSha: item.sha, mode: item.mode, pushing: null, dirty: true, deleted: true, conflict: null, movedTo: dest, updatedAt: now })
        await this.db.files.put({ path: dest, kind: 'blob', baseSha: null, baseText: null, text: null, blobSha: item.sha, mode: item.mode, pushing: null, dirty: true, deleted: false, conflict: null, movedFrom: p, updatedAt: now })
      }
    })
  }

  async close(): Promise<void> {
    this.engine.stop()
    await this.engine.idle()
    this.db.close()
    await this.db.delete()
  }
}

/** A page file with an id (and optional body). */
export function page(id: string, body: string, extra = ''): string {
  return `---\nid: ${id}\n${extra}---\n${body}`
}

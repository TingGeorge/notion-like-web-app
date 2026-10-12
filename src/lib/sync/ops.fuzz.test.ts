/**
 * Randomised two-device runs with the app's own page operations (`../workspace/ops`) on top of the
 * sync engine. Checks: both devices converge to GitHub, page ids stay unique, no sync operation
 * loses a line (SYNC-2), the `pages` index kept up to date by `onFilesChanged` equals a full
 * rebuild, and duplicated ids (DATA-9a) disappear once the page without the id needs one.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { classifyPath } from '../data/names'
import { readPageId } from '../markdown'
import { NotesDB, setDb } from '../store/db'
import { reindexAll, reindexPaths } from '../workspace/indexer'
import {
  createPage,
  deletePage,
  ensureId,
  listTrash,
  movePage,
  purgeTrashEntry,
  renamePage,
  restorePage,
  savePageBody,
  setFavorite,
} from '../workspace/ops'
import type { FakeGitHub } from '../../../test/fake-github'
import { GitHubError } from '../github/client'
import type { ConflictChoice } from './engine'
import { Device, FULL, makeGitHub } from './testHarness'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const devices: Device[] = []
afterEach(async () => {
  setDb(new NotesDB(`ops-fuzz-idle-${Math.random()}`))
  for (const d of devices.splice(0)) await d.close()
})

const MARKER = /^M\d+$/

class History {
  readonly lines = new Set<string>()
  private seen = new Set<string>()
  constructor(private gh: FakeGitHub) {}
  async update(): Promise<Set<string>> {
    for (const c of this.gh.commits(FULL)) {
      if (this.seen.has(c.sha)) break
      this.seen.add(c.sha)
      for (const text of Object.values(await this.gh.files(FULL, c.sha))) for (const l of text.split('\n')) this.lines.add(l)
    }
    return this.lines
  }
}

async function run(seed: number, steps: number) {
  const random = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(random() * xs.length)]
  const gh = await makeGitHub({
    'a.md': '---\nid: 01FUZZ0000000000000000000A\n---\nM0\n',
    'b.md': '---\nid: 01FUZZ0000000000000000000B\n---\nM00\n',
    'b/c.md': '---\nid: 01FUZZ0000000000000000000C\n---\nM000\n',
  })
  const make = async (name: string) => {
    const d = new Device(gh, name, {
      onFilesChanged: async (paths) => {
        setDb(d.db)
        await reindexPaths(paths)
      },
    })
    devices.push(d)
    setDb(d.db)
    await d.engine.pull()
    await reindexAll()
    return d
  }
  const a = await make('A')
  const b = await make('B')
  const history = new History(gh)
  let marker = 0

  const held = async (d: Device) => {
    const out = new Set<string>()
    for (const r of await d.db.files.toArray()) {
      if (r.deleted) continue
      for (const text of [r.text, r.conflict?.remoteText]) for (const l of (text ?? '').split('\n')) if (MARKER.test(l)) out.add(l)
    }
    return out
  }
  const checked = async (d: Device, what: string, op: () => Promise<void>) => {
    setDb(d.db)
    const before = await held(d)
    try {
      await op()
    } catch (e) {
      if (!(e instanceof GitHubError)) throw e
    }
    const after = await held(d)
    const committed = await history.update()
    expect([...before].filter((l) => !after.has(l) && !committed.has(l)), `seed ${seed}: ${what} on ${d.name} lost lines`).toEqual([])
  }
  const resolveAll = async (d: Device) => {
    for (const r of await d.db.files.toArray()) {
      if (!r.conflict || r.deleted) continue
      const choice = pick<ConflictChoice>(['keep-both', 'mine', 'theirs'])
      await checked(d, `resolve ${choice}`, () => d.engine.resolveConflict(r.path, choice))
    }
  }

  for (let step = 0; step < steps; step++) {
    const d = pick([a, b])
    setDb(d.db)
    const pages = (await d.db.pages.toArray()).filter((p) => !p.virtual)
    const all = await d.db.pages.toArray()
    const op = random()
    if (op < 0.3 && pages.length > 0) {
      const p = pick(pages)
      const row = await d.db.files.get(p.path)
      if (row && !row.conflict && row.text !== null) {
        const body = row.text.replace(/^---\n[\s\S]*?\n---\n/, '')
        const lines = body.split('\n').filter((l) => l !== '')
        const m = `M${++marker}`
        if (random() < 0.5 && lines.length > 0) lines[Math.floor(random() * lines.length)] = m
        else lines.splice(Math.floor(random() * (lines.length + 1)), 0, m)
        await savePageBody(p.key, `${lines.join('\n\n')}\n`)
      }
    } else if (op < 0.4) {
      const parent = random() < 0.5 || all.length === 0 ? null : pick(all).key
      await createPage({ parentKey: parent, title: pick(['n', 'o', 'a']), body: `M${++marker}\n` })
    } else if (op < 0.47 && pages.length > 0) {
      await renamePage(pick(pages).key, pick(['a', 'b', 'x', 'y']))
    } else if (op < 0.54 && pages.length > 0) {
      const target = random() < 0.4 ? null : pick(all).key
      await movePage(pick(pages).key, target).catch((e: Error) => {
        if (!/into itself/.test(e.message)) throw e
      })
    } else if (op < 0.6 && pages.length > 1) {
      await deletePage(pick(pages).key)
    } else if (op < 0.64) {
      const trash = await listTrash()
      if (trash.length > 0) {
        if (random() < 0.7) await restorePage(pick(trash).id)
        else await purgeTrashEntry(pick(trash).id)
      }
    } else if (op < 0.67 && pages.length > 0) {
      await setFavorite(pick(pages).key, random() < 0.7)
    } else if (op < 0.71) {
      const remotePages = gh.listFiles(FULL).filter((p) => classifyPath(p) === 'page')
      if (remotePages.length > 0) {
        const path = pick(remotePages)
        const lines = (await gh.readFile(FULL, path))!.split('\n')
        lines[Math.max(0, lines.length - 2)] = `M${++marker}`
        await gh.commit(FULL, { files: { [path]: lines.join('\n') }, message: `Update ${path}` })
      }
    } else if (op < 0.76) {
      await resolveAll(d)
    } else if (random() < 0.7) {
      await checked(d, 'push', () => d.engine.push())
    } else {
      await checked(d, 'pull', () => d.engine.pull())
    }
  }

  for (let round = 0; round < 6; round++) {
    for (const d of [a, b]) {
      await resolveAll(d)
      await checked(d, 'push', () => d.engine.push())
    }
  }
  await checked(a, 'pull', () => a.engine.pull())
  await checked(b, 'pull', () => b.engine.pull())

  // DATA-9a: a duplicated id can reach GitHub (the same page restored on one device and kept on
  // the other). The page that lost the id gets a new one when it needs one; then ids are unique.
  for (const d of [a, b]) {
    setDb(d.db)
    for (const p of await d.db.pages.toArray()) {
      if (!p.key.startsWith('path:') || p.virtual) continue
      const file = await d.db.files.get(p.path)
      if (file?.text && readPageId(file.text)) await ensureId(p.key)
    }
    await checked(d, 'push', () => d.engine.push())
  }
  await checked(a, 'pull', () => a.engine.pull())
  await checked(b, 'pull', () => b.engine.pull())

  const remote = Object.fromEntries(Object.entries(await gh.files(FULL)).filter(([p]) => classifyPath(p) !== null))
  for (const d of [a, b]) {
    setDb(d.db)
    const rows = await d.db.files.toArray()
    const local = Object.fromEntries(rows.filter((r) => !r.deleted && r.text !== null).map((r) => [r.path, r.text]))
    expect(local, `seed ${seed}: ${d.name} matches GitHub`).toEqual(remote)
    expect(rows.filter((r) => r.dirty || r.conflict || r.pushing !== null || r.deleted || r.kind === 'blob').map((r) => r.path), `seed ${seed}: ${d.name} clean`).toEqual([])
    const incremental = (await d.db.pages.toArray()).map((p) => `${p.key} ${p.path} ${p.parentKey} ${p.virtual}`).sort()
    await reindexAll()
    const rebuilt = (await d.db.pages.toArray()).map((p) => `${p.key} ${p.path} ${p.parentKey} ${p.virtual}`).sort()
    expect(incremental, `seed ${seed}: ${d.name} pages index`).toEqual(rebuilt)
  }
  const ids = Object.entries(remote)
    .filter(([p]) => classifyPath(p) === 'page')
    .map(([, text]) => readPageId(text))
    .filter((x): x is string => !!x)
  expect(new Set(ids).size, `seed ${seed}: unique ids`).toBe(ids.length)
}

describe('randomised two-device sync with the app operations', () => {
  for (let seed = 1; seed <= 30; seed++) {
    it(`converges without losing text (seed ${seed})`, async () => {
      await run(seed, 40)
    })
  }
})

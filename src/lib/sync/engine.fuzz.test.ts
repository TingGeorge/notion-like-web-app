/**
 * Randomised two-device runs (seeded, reproducible). After every run both devices must converge to
 * the remote state. And no sync operation (pull, push, conflict choice) may lose text: every line a
 * device holds before it must afterwards be on the device or in the repo history (SYNC-2).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { childDirOf, classifyPath, dirname, isInside, pageNameOf } from '../data/names'
import { readPageId } from '../markdown/frontmatter'
import type { FakeFailure, FakeGitHub } from '../../../test/fake-github'
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
  for (const d of devices.splice(0)) await d.close()
})

let idCounter = 0
const newId = () => `01FUZZ${String(++idCounter).padStart(20, '0')}`
const MARKER = /^(?:[A-Z]\d+|M\d+)$/

/** Every line ever committed, read incrementally. */
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
    'a.md': `---\nid: ${newId()}\n---\nA1\n\nA2\n\nA3\n`,
    'b.md': `---\nid: ${newId()}\n---\nB1\n\nB2\n`,
    'b/c.md': `---\nid: ${newId()}\n---\nC1\n`,
  })
  const a = new Device(gh, 'A')
  const b = new Device(gh, 'B')
  devices.push(a, b)
  await a.engine.pull()
  await b.engine.pull()
  const history = new History(gh)
  let marker = 0

  const pages = async (d: Device) => (await d.db.files.toArray()).filter((r) => r.kind === 'page' && !r.deleted)
  /** The marker lines a device holds: page, trash and conflict texts. */
  const held = async (d: Device) => {
    const out = new Set<string>()
    for (const r of await d.db.files.toArray()) {
      if (r.deleted) continue
      for (const text of [r.text, r.conflict?.remoteText]) for (const l of (text ?? '').split('\n')) if (MARKER.test(l)) out.add(l)
    }
    return out
  }
  /** Runs a sync operation and checks it lost nothing. */
  const checked = async (d: Device, what: string, op: () => Promise<void>) => {
    const before = await held(d)
    try {
      await op()
    } catch (e) {
      // Injected failures (network, 5xx, 422) are allowed to fail an operation, never to lose text.
      if (!(e instanceof GitHubError)) throw e
    }
    const after = await held(d)
    const committed = await history.update()
    const lost = [...before].filter((l) => !after.has(l) && !committed.has(l))
    expect(lost, `seed ${seed}: ${what} on ${d.name} lost lines`).toEqual([])
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
    const op = random()
    const list = await pages(d)
    if (op < 0.35 && list.length > 0) {
      // Edit: replace a body line or insert a paragraph.
      const p = pick(list)
      const lines = p.text!.split('\n')
      const body = lines.findIndex((l, i) => i > 0 && l === '---') + 1
      const i = body + Math.floor(random() * Math.max(1, lines.length - body - 1))
      const m = `M${++marker}`
      if (random() < 0.5) lines[i] = m
      else lines.splice(i, 0, m, '')
      await d.edit(p.path, lines.join('\n'))
    } else if (op < 0.45) {
      // New page, at the root or under another page; names collide on purpose.
      const dir = random() < 0.5 || list.length === 0 ? '' : childDirOf(pick(list).path)
      const path = `${dir ? `${dir}/` : ''}${pick(['n', 'o', 'a'])}.md`
      if (!(await d.row(path))) await d.edit(path, `---\nid: ${newId()}\n---\nM${++marker}\n`)
    } else if (op < 0.52 && list.length > 0) {
      // Move a page (with its folder) to the root or under another page.
      const p = pick(list)
      const targets = ['', ...list.filter((x) => !isInside(x.path, childDirOf(p.path)) && x.path !== p.path).map((x) => childDirOf(x.path))]
      const dir = pick(targets)
      const to = `${dir ? `${dir}/` : ''}${pageNameOf(p.path)}.md`
      if (to !== p.path && dirname(to) !== dirname(p.path) && !(await d.row(to))) {
        const clash = (await d.db.files.toArray()).some((r) => isInside(r.path, childDirOf(to)))
        if (!clash) await d.move(p.path, to)
      }
    } else if (op < 0.58 && list.length > 1) {
      await d.remove(pick(list).path)
    } else if (op < 0.62) {
      await gh.commit(FULL, { files: { 'web.md': `M${++marker}\n` }, message: 'web edit' })
    } else if (op < 0.67) {
      // An edit on github.com of an existing page (no Device trailer).
      const remotePages = gh.listFiles(FULL).filter((p) => classifyPath(p) === 'page')
      if (remotePages.length > 0) {
        const path = pick(remotePages)
        const lines = (await gh.readFile(FULL, path))!.split('\n')
        lines[Math.floor(random() * lines.length)] = `M${++marker}`
        await gh.commit(FULL, { files: { [path]: lines.join('\n') }, message: `Update ${path}` })
      }
    } else if (op < 0.7) {
      // The next matching request fails.
      const failure = pick<FakeFailure>([{ kind: 'network' }, { kind: 'server' }, { kind: 'status', status: 422 }])
      const method = pick(['GET', 'POST', 'PATCH'])
      gh.failNext(failure, { match: (r) => r.method === method })
    } else if (op < 0.75) {
      await resolveAll(d)
    } else if (random() < 0.7) {
      await checked(d, 'push', () => d.engine.push())
    } else {
      await checked(d, 'pull', () => d.engine.pull())
    }
  }

  // Converge: resolve everything and sync until nothing is left.
  gh.clearFailures()
  for (let round = 0; round < 6; round++) {
    for (const d of [a, b]) {
      await resolveAll(d)
      await checked(d, 'push', () => d.engine.push())
    }
  }
  await checked(a, 'pull', () => a.engine.pull())
  await checked(b, 'pull', () => b.engine.pull())

  const remote = Object.fromEntries(Object.entries(await gh.files(FULL)).filter(([p]) => classifyPath(p) !== null))
  for (const d of [a, b]) {
    const rows = await d.db.files.toArray()
    const local = Object.fromEntries(rows.filter((r) => !r.deleted && r.text !== null).map((r) => [r.path, r.text]))
    expect(local, `seed ${seed}: ${d.name} matches GitHub`).toEqual(remote)
    expect(
      rows.filter((r) => r.dirty || r.conflict || r.pushing !== null || r.deleted).map((r) => r.path),
      `seed ${seed}: ${d.name} is clean`,
    ).toEqual([])
  }
  // DATA-9a: app-made copies get new ids, so no id is duplicated among pages.
  const ids = Object.entries(remote)
    .filter(([p]) => classifyPath(p) === 'page')
    .map(([, text]) => readPageId(text))
    .filter((x): x is string => !!x)
  expect(new Set(ids).size, `seed ${seed}: unique ids`).toBe(ids.length)
}

describe('randomised two-device sync', () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`converges without losing text (seed ${seed})`, async () => {
      await run(seed, 40)
    })
  }
})

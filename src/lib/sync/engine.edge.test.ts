/** Less common paths through SYNC-5 / SYNC-6 / SYNC-8. */
import { afterEach, describe, expect, it } from 'vitest'
import { FakeGitHub } from '../../../test/fake-github'
import { parseTrashIndex } from '../data/notesFiles'
import { readPageMeta, splitPageFile } from '../markdown/frontmatter'
import { TRASH_INDEX_PATH } from '../types'
import { Device, FULL, OWNER, TOKEN, makeGitHub, page } from './testHarness'

const ID_A = '01JA8Z3K5N6P7Q8R9S0T1V2W3A'
const ID_B = '01JA8Z3K5N6P7Q8R9S0T1V2W3B'

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.close()
})

function device(gh: FakeGitHub, name: string): Device {
  const d = new Device(gh, name)
  devices.push(d)
  return d
}

const BASE = page(ID_A, '一\n\n二\n\n三\n')
const subject = (gh: FakeGitHub) => gh.commits(FULL)[0].message.split('\n')[0]

describe('folder moves', () => {
  it('a page without an id follows its moved parent folder with local edits', async () => {
    const gh = await makeGitHub({ '專案.md': page(ID_A, '專案\n'), '專案/筆記.md': '一\n\n二\n', '工作.md': page(ID_B, '工作\n') })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('專案/筆記.md', '一（這台）\n\n二\n')
    await gh.commit(FULL, {
      files: { '專案.md': null, '專案/筆記.md': null, '工作/專案.md': page(ID_A, '專案\n'), '工作/專案/筆記.md': '一\n\n二（另一台）\n' },
      device: 'B',
    })
    await d.engine.pull()
    expect(d.notices).toEqual([])
    expect(await d.paths()).toEqual(['工作.md', '工作/專案.md', '工作/專案/筆記.md'])
    expect(await d.text('工作/專案/筆記.md')).toBe('一（這台）\n\n二（另一台）\n')
  })

  it('an unpushed local child page follows its parent moved on another device', async () => {
    const gh = await makeGitHub({ '專案.md': page(ID_A, '專案\n'), '工作.md': page(ID_B, '工作\n') })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('專案/新子頁.md', '新的\n')
    await gh.commit(FULL, { files: { '專案.md': null, '工作/專案.md': page(ID_A, '專案\n') } })
    await d.engine.pull()
    expect(await d.paths()).toEqual(['工作.md', '工作/專案.md', '工作/專案/新子頁.md'])
    await d.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['工作.md', '工作/專案.md', '工作/專案/新子頁.md'])
  })
})

describe('DATA-17: links follow pages the engine moves', () => {
  it('rule 5: a link to the local page that had to be renamed points at its new name', async () => {
    const gh = await makeGitHub({ '首頁.md': '首頁\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('會議.md', page(ID_A, '這台的會議\n'))
    await d.edit('首頁.md', '首頁\n\n[會議](/會議.md)\n')
    await gh.commit(FULL, { files: { '會議.md': page(ID_B, '另一台的會議\n') } })
    await d.engine.pull()
    expect(await d.paths()).toEqual(['會議 (2).md', '會議.md', '首頁.md'])
    expect(await d.text('首頁.md')).toBe('首頁\n\n[會議](/會議%20%282%29.md)\n')
    expect(d.changed.flat()).toContain('首頁.md')
  })

  it('an unpushed child that follows a folder moved elsewhere keeps its inbound links', async () => {
    const gh = await makeGitHub({ '專案.md': page(ID_A, '專案\n'), '首頁.md': '首頁\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('專案/新子頁.md', '新的\n')
    await d.edit('首頁.md', '首頁\n\n[新子頁](/專案/新子頁.md#標題)\n')
    await gh.commit(FULL, { files: { '專案.md': null, '計畫.md': page(ID_A, '專案\n') } })
    await d.engine.pull()
    expect(await d.paths()).toEqual(['計畫.md', '計畫/新子頁.md', '首頁.md'])
    expect(await d.text('首頁.md')).toBe(`首頁\n\n[新子頁](/計畫/新子頁.md#${encodeURIComponent('標題')})\n`)
  })

  it('links added here to a page moved on another device follow it; links GitHub has are left alone', async () => {
    const gh = await makeGitHub({ 'x.md': page(ID_A, 'x\n'), 'a.md': '[舊](/x.md)\n', 'b.md': 'b\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', '[舊](/x.md)\n\n[新](/x.md)\n')
    await d.edit('b.md', 'b\n\n[x](/x.md)\n')
    await gh.commit(FULL, { files: { 'x.md': null, 'y/x.md': page(ID_A, 'x\n') }, message: 'move on github.com' })
    await d.engine.pull()
    // a.md already linked to x.md on GitHub: that page's links are the other side's to rewrite.
    expect(await d.text('a.md')).toBe('[舊](/x.md)\n\n[新](/x.md)\n')
    expect(await d.text('b.md')).toBe('b\n\n[x](/y/x.md)\n')
  })
})

describe('conflicts on a page moved here', () => {
  async function movedConflict() {
    const gh = await makeGitHub({ 'x.md': BASE, '工作.md': page(ID_B, '工作\n') })
    const a = device(gh, 'iPhone')
    await a.engine.pull()
    await a.move('x.md', '工作/x.md')
    await a.edit('工作/x.md', page(ID_A, '一（iPhone）\n\n二\n\n三\n'))
    await gh.commit(FULL, { files: { 'x.md': page(ID_A, '一（Mac）\n\n二\n\n三\n') }, device: 'Mac' })
    await a.engine.pull()
    return { gh, a }
  }

  it('marks the moved page conflict and holds the whole move', async () => {
    const { gh, a } = await movedConflict()
    const row = (await a.row('工作/x.md'))!
    expect(row.conflict).toMatchObject({ remoteDevice: 'Mac', remoteText: page(ID_A, '一（Mac）\n\n二\n\n三\n'), mergeBase: BASE })
    const before = gh.commits(FULL).length
    await a.engine.push()
    expect(gh.commits(FULL)).toHaveLength(before)
    expect(gh.listFiles(FULL)).toEqual(['x.md', '工作.md'])
  })

  it('「使用 Mac 的版本」 keeps the move with the remote text', async () => {
    const { gh, a } = await movedConflict()
    await a.engine.resolveConflict('工作/x.md', 'theirs')
    await a.engine.push()
    expect(gh.listFiles(FULL).filter((p) => !p.startsWith('.notes/'))).toEqual(['工作.md', '工作/x.md'])
    expect(await gh.readFile(FULL, '工作/x.md')).toBe(page(ID_A, '一（Mac）\n\n二\n\n三\n'))
    const index = parseTrashIndex(await gh.readFile(FULL, TRASH_INDEX_PATH)).value
    expect(index.entries).toMatchObject([{ reason: 'replaced' }])
  })

  it('「兩個都保留」 leaves the remote version at the old path and the local one moved, with a new id', async () => {
    const { gh, a } = await movedConflict()
    await a.engine.resolveConflict('工作/x.md', 'keep-both')
    await a.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['x.md', '工作.md', '工作/x.md'])
    expect(await gh.readFile(FULL, 'x.md')).toBe(page(ID_A, '一（Mac）\n\n二\n\n三\n'))
    const moved = (await gh.readFile(FULL, '工作/x.md'))!
    expect(splitPageFile(moved).body).toBe('一（iPhone）\n\n二\n\n三\n')
    expect(readPageMeta(splitPageFile(moved).frontmatter).id).not.toBe(ID_A)
  })
})

describe('a page in conflict that is then deleted or moved here', () => {
  async function conflicted() {
    const gh = await makeGitHub({ 'x.md': BASE, '工作.md': page(ID_B, '工作\n') })
    const a = device(gh, 'iPhone')
    await a.engine.pull()
    await a.edit('x.md', page(ID_A, '一（iPhone）\n\n二\n\n三\n'))
    await gh.commit(FULL, { files: { 'x.md': page(ID_A, '一（Mac）\n\n二\n\n三\n') }, device: 'Mac' })
    await a.engine.pull()
    expect((await a.row('x.md'))!.conflict).not.toBeNull()
    return { gh, a }
  }

  it('a delete wins over the pending conflict', async () => {
    const { gh, a } = await conflicted()
    const entryId = await a.remove('x.md')
    await a.engine.push()
    expect(gh.listFiles(FULL)).toEqual([`.notes/trash/${entryId}/x.md`, TRASH_INDEX_PATH, '工作.md'])
    expect(await a.dirty()).toEqual([])
  })

  it('a move carries the conflict to the new path', async () => {
    const { gh, a } = await conflicted()
    await a.move('x.md', '工作/x.md')
    const before = gh.commits(FULL).length
    await a.engine.push()
    expect(gh.commits(FULL)).toHaveLength(before)
    expect((await a.row('工作/x.md'))!.conflict).toMatchObject({ remoteText: page(ID_A, '一（Mac）\n\n二\n\n三\n'), mergeBase: BASE })
    await a.engine.resolveConflict('工作/x.md', 'mine')
    await a.engine.push()
    expect(await gh.readFile(FULL, '工作/x.md')).toBe(page(ID_A, '一（iPhone）\n\n二\n\n三\n'))
    expect(await gh.readFile(FULL, 'x.md')).toBeNull()
  })
})

describe('trash restore', () => {
  it('pushes a restore from the trash as 還原', async () => {
    const gh = await makeGitHub({ '工作.md': page(ID_A, '工作\n') })
    const d = device(gh, 'A')
    await d.engine.pull()
    const entryId = await d.remove('工作.md')
    await d.engine.push()
    // Restore: the trash file moves back and the entry leaves the index.
    await d.move(`.notes/trash/${entryId}/工作.md`, '工作.md')
    await d.edit(TRASH_INDEX_PATH, `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`)
    await d.engine.push()
    expect(subject(gh)).toBe('還原「工作」')
    expect(gh.listFiles(FULL)).toEqual([TRASH_INDEX_PATH, '工作.md'])
  })
})

describe('files the app does not treat as pages', () => {
  it('ignores symlinks named .md and keeps them out of conflicts', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    // Replace a.md by a symlink with the raw API (the helper only writes regular files).
    const base = gh.commits(FULL)[0]
    const res = await gh.fetch(`https://api.github.com/repos/${FULL}/git/trees`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: base.tree, tree: [{ path: 'link.md', mode: '120000', type: 'blob', content: 'a.md' }] }),
    })
    const tree = (await res.json()) as { sha: string }
    const commit = (await (
      await gh.fetch(`https://api.github.com/repos/${FULL}/git/commits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'link', tree: tree.sha, parents: [base.sha] }),
      })
    ).json()) as { sha: string }
    await gh.fetch(`https://api.github.com/repos/${FULL}/git/refs/heads/main`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: commit.sha }),
    })
    await d.engine.pull()
    expect(await d.paths()).toEqual(['a.md'])
    expect((await d.db.sync.get('state'))!.tree!['link.md'].mode).toBe('120000')
  })

  it('never raises a conflict for a trash file: the local version wins', async () => {
    const gh = await makeGitHub({ '.notes/trash/01T/x.md': 'a\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('.notes/trash/01T/x.md', 'local\n')
    await gh.commit(FULL, { files: { '.notes/trash/01T/x.md': 'remote\n' } })
    await d.engine.push()
    expect((await d.row('.notes/trash/01T/x.md'))!.conflict).toBeNull()
    expect(await gh.readFile(FULL, '.notes/trash/01T/x.md')).toBe('local\n')
  })
})

describe('empty repo', () => {
  it('creates the first commit with the Contents API, then pushes the rest', async () => {
    const gh = new FakeGitHub()
    gh.addUser(OWNER)
    gh.addToken(TOKEN, { login: OWNER, repos: [FULL] })
    await gh.createRepo(FULL, { empty: true })
    const d = device(gh, 'A')
    await d.engine.initialSync(() => {})
    expect(await d.paths()).toEqual([])
    await d.edit('歡迎使用.md', page(ID_A, '歡迎\n'))
    await d.edit('第二頁.md', page(ID_B, '二\n'))
    await d.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['歡迎使用.md', '第二頁.md'].sort())
    expect(gh.commits(FULL)).toHaveLength(2)
    expect(await d.dirty()).toEqual([])
  })
})

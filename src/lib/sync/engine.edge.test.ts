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

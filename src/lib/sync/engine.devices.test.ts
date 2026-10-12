/**
 * Two devices against one fake GitHub (TEST-1, TEST-3 scenarios at the engine level):
 * clean merges, conflicts and their three resolutions, delete/move against edit, same new path,
 * settings and trash JSON merges, trash retention.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { parseSettings, parseTrashIndex } from '../data/notesFiles'
import { readPageMeta, splitPageFile } from '../markdown/frontmatter'
import { t } from '../../strings'
import type { FakeGitHub } from '../../../test/fake-github'
import { SETTINGS_PATH, TRASH_INDEX_PATH } from '../types'
import { Device, FULL, ManualClock, makeGitHub, page } from './testHarness'

const ID_A = '01JA8Z3K5N6P7Q8R9S0T1V2W3A'
const ID_B = '01JA8Z3K5N6P7Q8R9S0T1V2W3B'

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.close()
})

async function twoDevices(files: Record<string, string | Uint8Array>, clock?: ManualClock): Promise<{ gh: FakeGitHub; a: Device; b: Device }> {
  const gh = await makeGitHub(files)
  const a = new Device(gh, 'iPhone · Safari', { clock })
  const b = new Device(gh, 'Mac · Chrome', { clock })
  devices.push(a, b)
  await a.engine.pull()
  await b.engine.pull()
  return { gh, a, b }
}

const subject = (gh: FakeGitHub) => gh.commits(FULL)[0].message.split('\n')[0]
const BASE = page(ID_A, '第一段\n\n第二段\n\n第三段\n')

describe('two devices: merges', () => {
  it('merges edits to different paragraphs cleanly', async () => {
    const { gh, a, b } = await twoDevices({ '會議記錄.md': BASE })
    await a.edit('會議記錄.md', page(ID_A, '第一段（iPhone）\n\n第二段\n\n第三段\n'))
    await b.edit('會議記錄.md', page(ID_A, '第一段\n\n第二段\n\n第三段（Mac）\n'))
    await a.engine.push()
    await b.engine.push()
    await a.engine.pull()
    const merged = page(ID_A, '第一段（iPhone）\n\n第二段\n\n第三段（Mac）\n')
    expect(await gh.readFile(FULL, '會議記錄.md')).toBe(merged)
    expect(await a.text('會議記錄.md')).toBe(merged)
    expect(await b.text('會議記錄.md')).toBe(merged)
    expect(await a.dirty()).toEqual([])
    expect(await b.dirty()).toEqual([])
  })

  it('merges settings.json and the trash index key by key (SYNC-6a)', async () => {
    const settings = (o: object) => `${JSON.stringify({ version: 1, favorites: [ID_A], order: {}, trashRetentionDays: 30, ...o }, null, 2)}\n`
    const { gh, a, b } = await twoDevices({
      'a.md': page(ID_A, 'a\n'),
      'b.md': page(ID_B, 'b\n'),
      'c.md': 'c\n',
      [SETTINGS_PATH]: settings({}),
    })
    await a.edit(SETTINGS_PATH, settings({ favorites: [ID_A, 'k1'], order: { root: [ID_B, ID_A] } }))
    await b.edit(SETTINGS_PATH, settings({ favorites: ['k2'], order: { root: [ID_A, ID_B] }, trashRetentionDays: 7 }))
    const entryA = await a.remove('a.md')
    const entryB = await b.remove('c.md')
    await a.engine.push()
    await b.engine.push()
    const s = parseSettings(await gh.readFile(FULL, SETTINGS_PATH)).value
    // B removed ID_A from favorites; A added k1; B added k2. B's order wins (local for B), B changed the days.
    expect(s.favorites).toEqual(['k2', 'k1'])
    expect(s.order).toEqual({ root: [ID_A, ID_B] })
    expect(s.trashRetentionDays).toBe(7)
    const index = parseTrashIndex(await gh.readFile(FULL, TRASH_INDEX_PATH)).value
    expect(index.entries.map((e) => e.id).sort()).toEqual([entryA, entryB].sort())
    expect(b.notices).toEqual([])
  })

  it('keeps the local settings when the remote JSON does not parse, with a notice', async () => {
    const good = `${JSON.stringify({ version: 1, favorites: ['x'], order: {}, trashRetentionDays: 30 }, null, 2)}\n`
    const { gh, a } = await twoDevices({ [SETTINGS_PATH]: good })
    await gh.commit(FULL, { files: { [SETTINGS_PATH]: '{ "favorites": [' } })
    await a.engine.pull()
    expect(await a.text(SETTINGS_PATH)).toBe(good)
    expect(a.notices).toEqual([t.sync.invalidRemoteJson(SETTINGS_PATH)])
    await a.engine.push()
    expect(await gh.readFile(FULL, SETTINGS_PATH)).toBe(good)
  })
})

describe('two devices: conflicts (SYNC-6)', () => {
  async function conflicted() {
    const env = await twoDevices({ '會議記錄.md': BASE, 'other.md': 'o\n' })
    await env.a.edit('會議記錄.md', page(ID_A, '第一段 iPhone 版\n\n第二段\n\n第三段\n'))
    await env.b.edit('會議記錄.md', page(ID_A, '第一段 Mac 版\n\n第二段\n\n第三段\n'))
    await env.a.engine.push()
    await env.b.engine.push()
    return env
  }

  it('marks the page conflict, names the other device and keeps syncing the rest', async () => {
    const { gh, a, b } = await conflicted()
    const row = (await b.row('會議記錄.md'))!
    expect(row.conflict).toMatchObject({
      remoteText: page(ID_A, '第一段 iPhone 版\n\n第二段\n\n第三段\n'),
      localText: page(ID_A, '第一段 Mac 版\n\n第二段\n\n第三段\n'),
      remoteDevice: 'iPhone · Safari',
      mergeBase: BASE,
    })
    expect(row.conflict!.remoteSha).toBe(gh.blobSha(FULL, '會議記錄.md'))
    expect(row.conflict!.remoteAt).not.toBeNull()
    expect(row.text).toBe(page(ID_A, '第一段 Mac 版\n\n第二段\n\n第三段\n'))
    expect(row.baseText).toBe(row.conflict!.remoteText)
    // The remote version is untouched; other pages still sync.
    expect(await gh.readFile(FULL, '會議記錄.md')).toBe(await a.text('會議記錄.md'))
    await b.edit('other.md', 'o2\n')
    await b.engine.push()
    expect(await gh.readFile(FULL, 'other.md')).toBe('o2\n')
    expect(await b.engine.getStatus()).toEqual({ state: 'pending', pending: 1 })
  })

  it('says 「GitHub 上的版本」 (null device) for an edit made on github.com', async () => {
    const { gh, a } = await twoDevices({ 'x.md': BASE })
    await a.edit('x.md', page(ID_A, '第一段 A\n\n第二段\n\n第三段\n'))
    await gh.commit(FULL, { files: { 'x.md': page(ID_A, '第一段 web\n\n第二段\n\n第三段\n') }, message: 'Update x.md' })
    await a.engine.pull()
    expect((await a.row('x.md'))!.conflict!.remoteDevice).toBeNull()
  })

  it('「兩個都保留」: the remote stays in place, the local version becomes a sibling copy', async () => {
    const clock = new ManualClock()
    clock.time = new Date(2026, 9, 12, 9, 41).getTime()
    const gh = await makeGitHub({ '工作/會議記錄.md': BASE })
    const a = new Device(gh, 'iPhone · Safari', { clock })
    const b = new Device(gh, 'Mac · Chrome', { clock })
    devices.push(a, b)
    await a.engine.pull()
    await b.engine.pull()
    await a.edit('工作/會議記錄.md', page(ID_A, '第一段 iPhone 版\n\n第二段\n\n第三段\n'))
    await b.edit('工作/會議記錄.md', page(ID_A, '第一段 Mac 版\n\n第二段\n\n第三段\n'))
    await a.engine.push()
    await b.engine.push()
    await b.engine.resolveConflict('工作/會議記錄.md', 'keep-both')
    const copyTitle = t.conflict.copyTitle('會議記錄', 'Mac · Chrome', '09:41')
    const rows = await b.db.files.toArray()
    const copy = rows.find((r) => r.path !== '工作/會議記錄.md')!
    expect(copy.path).toBe('工作/會議記錄（衝突副本 Mac · Chrome 09：41）.md')
    const meta = readPageMeta(splitPageFile(copy.text!).frontmatter)
    expect(meta.title).toBe(copyTitle)
    expect(meta.id).not.toBe(ID_A)
    expect(splitPageFile(copy.text!).body).toBe('第一段 Mac 版\n\n第二段\n\n第三段\n')
    expect((await b.row('工作/會議記錄.md'))!).toMatchObject({ conflict: null, dirty: false, text: page(ID_A, '第一段 iPhone 版\n\n第二段\n\n第三段\n') })
    await b.engine.push()
    expect(subject(gh)).toBe(`新增「${copyTitle}」`)
    expect(gh.listFiles(FULL)).toEqual(['工作/會議記錄.md', copy.path])
    expect(b.changed.flat()).toContain(copy.path)
  })

  it('「使用這台裝置的版本」: local wins, the remote version goes to the trash as replaced', async () => {
    const { gh, b } = await conflicted()
    const remote = (await b.row('會議記錄.md'))!.conflict!.remoteText
    await b.engine.resolveConflict('會議記錄.md', 'mine')
    await b.engine.push()
    expect(subject(gh)).toBe('處理「會議記錄」的衝突')
    expect(await gh.readFile(FULL, '會議記錄.md')).toBe(page(ID_A, '第一段 Mac 版\n\n第二段\n\n第三段\n'))
    const index = parseTrashIndex(await gh.readFile(FULL, TRASH_INDEX_PATH)).value
    expect(index.entries).toMatchObject([{ title: '會議記錄', originalPath: '會議記錄.md', reason: 'replaced' }])
    const trashed = await gh.readFile(FULL, `.notes/trash/${index.entries[0].id}/會議記錄.md`)
    // The trashed copy gets a new id (DATA-9a) but keeps the text.
    expect(splitPageFile(trashed!).body).toBe(splitPageFile(remote).body)
    expect(readPageMeta(splitPageFile(trashed!).frontmatter).id).toBe(index.entries[0].id)
  })

  it('「使用 <other device> 的版本」: remote wins, the local version goes to the trash as replaced', async () => {
    const { gh, a, b } = await conflicted()
    await b.engine.resolveConflict('會議記錄.md', 'theirs')
    expect(await b.row('會議記錄.md')).toMatchObject({ conflict: null, dirty: false, text: await a.text('會議記錄.md') })
    await b.engine.push()
    expect(subject(gh)).toBe('處理「會議記錄」的衝突')
    expect(await gh.readFile(FULL, '會議記錄.md')).toBe(await a.text('會議記錄.md'))
    const index = parseTrashIndex(await gh.readFile(FULL, TRASH_INDEX_PATH)).value
    expect(index.entries).toMatchObject([{ reason: 'replaced', originalPath: '會議記錄.md' }])
    const trashed = await gh.readFile(FULL, `.notes/trash/${index.entries[0].id}/會議記錄.md`)
    expect(splitPageFile(trashed!).body).toBe('第一段 Mac 版\n\n第二段\n\n第三段\n')
  })

  it('merges again when another remote change arrives while the conflict is pending', async () => {
    const { gh, a, b } = await conflicted()
    // iPhone changes the conflicting paragraph back and edits another one: the conflict is gone.
    await a.edit('會議記錄.md', page(ID_A, '第一段\n\n第二段\n\n第三段（iPhone）\n'))
    await a.engine.push()
    await b.engine.pull()
    const row = (await b.row('會議記錄.md'))!
    expect(row.conflict).toBeNull()
    expect(row.text).toBe(page(ID_A, '第一段 Mac 版\n\n第二段\n\n第三段（iPhone）\n'))
    await b.engine.push()
    expect(await gh.readFile(FULL, '會議記錄.md')).toBe(row.text)
  })

  it('updates the pending conflict when the new remote change still overlaps', async () => {
    const { gh, a, b } = await conflicted()
    await a.edit('會議記錄.md', page(ID_A, '第一段 iPhone 第二版\n\n第二段\n\n第三段\n'))
    await a.engine.push()
    await b.engine.pull()
    const row = (await b.row('會議記錄.md'))!
    expect(row.conflict!.remoteText).toBe(page(ID_A, '第一段 iPhone 第二版\n\n第二段\n\n第三段\n'))
    expect(row.conflict!.remoteSha).toBe(gh.blobSha(FULL, '會議記錄.md'))
    expect(row.conflict!.mergeBase).toBe(BASE)
  })
})

describe('two devices: delete, move and add against edits', () => {
  it('local delete vs remote edit: the remote text goes into the trash entry (rule 6)', async () => {
    const { gh, a, b } = await twoDevices({ 'x.md': BASE })
    const entryId = await a.remove('x.md')
    await b.edit('x.md', page(ID_A, '第一段\n\n第二段（Mac 改的）\n\n第三段\n'))
    await b.engine.push()
    await a.engine.pull()
    expect(a.notices).toEqual([t.page.deletedRemoteEdited])
    expect(await a.text(`.notes/trash/${entryId}/x.md`)).toBe(page(ID_A, '第一段\n\n第二段（Mac 改的）\n\n第三段\n'))
    await a.engine.push()
    expect(subject(gh)).toBe('刪除「x」')
    expect(gh.listFiles(FULL)).toEqual([`.notes/trash/${entryId}/x.md`, TRASH_INDEX_PATH])
    expect(await gh.readFile(FULL, `.notes/trash/${entryId}/x.md`)).toBe(page(ID_A, '第一段\n\n第二段（Mac 改的）\n\n第三段\n'))
  })

  it('local edit vs remote delete: the page is kept and created again (rule 3)', async () => {
    const { gh, a, b } = await twoDevices({ 'x.md': BASE })
    await a.edit('x.md', page(ID_A, '第一段（iPhone）\n\n第二段\n\n第三段\n'))
    const entryId = await b.remove('x.md')
    await b.engine.push()
    await a.engine.pull()
    expect(a.notices).toEqual([t.page.remoteDeletedKept])
    expect(await a.row('x.md')).toMatchObject({ baseSha: null, dirty: true, deleted: false })
    await a.engine.push()
    expect(await gh.readFile(FULL, 'x.md')).toBe(page(ID_A, '第一段（iPhone）\n\n第二段\n\n第三段\n'))
    // The other device's trash copy is still there (SYNC-2).
    expect(await gh.readFile(FULL, `.notes/trash/${entryId}/x.md`)).toBe(BASE)
  })

  it('both delete the same page: one trash entry survives', async () => {
    const { gh, a, b } = await twoDevices({ 'x.md': BASE })
    await a.remove('x.md')
    const entryB = await b.remove('x.md')
    await b.engine.push()
    await a.engine.push()
    const index = parseTrashIndex(await gh.readFile(FULL, TRASH_INDEX_PATH)).value
    expect(index.entries.map((e) => e.id)).toEqual([entryB])
    expect(gh.listFiles(FULL)).toEqual([`.notes/trash/${entryB}/x.md`, TRASH_INDEX_PATH])
    expect(await a.dirty()).toEqual([])
  })

  it('local move vs remote edit: the edit is merged into the moved page (rule 6)', async () => {
    const { gh, a, b } = await twoDevices({ 'x.md': BASE, '工作.md': page(ID_B, '工作\n') })
    await a.move('x.md', '工作/x.md')
    await b.edit('x.md', page(ID_A, '第一段\n\n第二段（Mac）\n\n第三段\n'))
    await b.engine.push()
    await a.engine.push()
    expect(subject(gh)).toBe('移動「x」到「工作」')
    expect(gh.listFiles(FULL)).toEqual(['工作.md', '工作/x.md'])
    expect(await gh.readFile(FULL, '工作/x.md')).toBe(page(ID_A, '第一段\n\n第二段（Mac）\n\n第三段\n'))
    await b.engine.pull()
    expect(await b.paths()).toEqual(['工作.md', '工作/x.md'])
  })

  it('local edit vs remote move: the local edit follows the page (rule 1)', async () => {
    const { gh, a, b } = await twoDevices({ 'x.md': BASE, '工作.md': page(ID_B, '工作\n') })
    await a.edit('x.md', page(ID_A, '第一段（iPhone）\n\n第二段\n\n第三段\n'))
    await b.move('x.md', '工作/x.md')
    await b.edit('工作/x.md', page(ID_A, '第一段\n\n第二段\n\n第三段（Mac）\n'))
    await b.engine.push()
    await a.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['工作.md', '工作/x.md'])
    expect(await gh.readFile(FULL, '工作/x.md')).toBe(page(ID_A, '第一段（iPhone）\n\n第二段\n\n第三段（Mac）\n'))
    expect(await a.paths()).toEqual(['工作.md', '工作/x.md'])
  })

  it('local delete vs remote move: the delete applies to the moved page', async () => {
    const { gh, a, b } = await twoDevices({ 'x.md': BASE, '工作.md': page(ID_B, '工作\n') })
    const entryId = await a.remove('x.md')
    await b.move('x.md', '工作/x.md')
    await b.engine.push()
    await a.engine.push()
    expect(gh.listFiles(FULL)).toEqual([`.notes/trash/${entryId}/x.md`, TRASH_INDEX_PATH, '工作.md'])
    expect(await a.dirty()).toEqual([])
  })

  it('both move the page to different places: the later push wins, nothing is duplicated', async () => {
    const { gh, a, b } = await twoDevices({ 'x.md': BASE, 'p.md': 'p\n', 'q.md': 'q\n' })
    await a.move('x.md', 'p/x.md')
    await b.move('x.md', 'q/x.md')
    await b.engine.push()
    await a.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['p.md', 'p/x.md', 'q.md'])
    await b.engine.pull()
    expect(await b.paths()).toEqual(['p.md', 'p/x.md', 'q.md'])
  })

  it('the same new path on both devices: the later one is renamed per DATA-6 (rule 5)', async () => {
    const { gh, a, b } = await twoDevices({})
    await a.edit('新頁面.md', page(ID_A, 'iPhone 寫的\n'))
    await b.edit('新頁面.md', page(ID_B, 'Mac 寫的\n'))
    await a.engine.push()
    await b.engine.push()
    expect(gh.listFiles(FULL).filter((p) => p !== 'README.md')).toEqual(['新頁面 (2).md', '新頁面.md'])
    expect(await gh.readFile(FULL, '新頁面.md')).toBe(page(ID_A, 'iPhone 寫的\n'))
    expect(await gh.readFile(FULL, '新頁面 (2).md')).toBe(`---\nid: ${ID_B}\ntitle: "新頁面"\n---\nMac 寫的\n`)
    await a.engine.pull()
    expect(await a.text('新頁面 (2).md')).toBe(await gh.readFile(FULL, '新頁面 (2).md'))
  })
})

describe('DATA-22 trash retention', () => {
  it('purges entries older than trashRetentionDays on sync', async () => {
    const clock = new ManualClock()
    const old = new Date(clock.time - 31 * 24 * 3600 * 1000).toISOString()
    const recent = new Date(clock.time - 2 * 24 * 3600 * 1000).toISOString()
    const index = {
      version: 1,
      entries: [
        { id: '01OLD', title: '舊頁', originalPath: '舊頁.md', deletedAt: old, reason: 'deleted' },
        { id: '01NEW', title: '新頁', originalPath: '新頁.md', deletedAt: recent, reason: 'deleted' },
      ],
    }
    const gh = await makeGitHub({
      '.notes/trash/01OLD/舊頁.md': '舊\n',
      '.notes/trash/01OLD/舊頁/子.md': '子\n',
      '.notes/trash/01OLD/舊頁/圖.png': new Uint8Array([1, 2]),
      '.notes/trash/01NEW/新頁.md': '新\n',
      [TRASH_INDEX_PATH]: `${JSON.stringify(index, null, 2)}\n`,
      [SETTINGS_PATH]: `${JSON.stringify({ version: 1, favorites: [], order: {}, trashRetentionDays: 30 })}\n`,
    })
    const d = new Device(gh, 'A', { clock })
    devices.push(d)
    await d.engine.pull()
    expect((await d.row('.notes/trash/01OLD/舊頁.md'))!.deleted).toBe(true)
    await d.engine.push()
    expect(subject(gh)).toBe('永久刪除「舊頁」')
    expect(gh.listFiles(FULL)).toEqual(['.notes/settings.json', '.notes/trash/01NEW/新頁.md', TRASH_INDEX_PATH])
    expect(parseTrashIndex(await gh.readFile(FULL, TRASH_INDEX_PATH)).value.entries.map((e) => e.id)).toEqual(['01NEW'])
    expect(await d.dirty()).toEqual([])
  })
})

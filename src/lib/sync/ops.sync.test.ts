/**
 * The app's local page operations (`../workspace/ops`) against the sync engine and the fake
 * GitHub: the cases where the two meet (trash with tree-only files, restoring a replaced version,
 * conflicts and pushes in flight, remote moves followed by the page index).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { parseTrashIndex } from '../data/notesFiles'
import { readPageId, readPageMeta, splitPageFile } from '../markdown'
import { NotesDB, setDb } from '../store/db'
import { TRASH_INDEX_PATH } from '../types'
import { reindexAll, reindexPaths } from '../workspace/indexer'
import { createPage, deletePage, getPage, listTrash, movePage, purgeTrashEntry, renamePage, restorePage, savePageBody } from '../workspace/ops'
import type { FakeGitHub } from '../../../test/fake-github'
import { Device, FULL, makeGitHub, page } from './testHarness'

const W = '01J0000000000000000000WORK'
const S = '01J00000000000000000000SUB'
const X = '01J000000000000000000000XX'
const P = '01J000000000000000000000PP'

const devices: Device[] = []
afterEach(async () => {
  // The indexer saves the search index on a timer through the global db(): leave an open one.
  setDb(new NotesDB(`ops-sync-idle-${Math.random()}`))
  for (const d of devices.splice(0)) await d.close()
})

/** A device whose engine re-indexes like the app does; `use()` points the global db() at it. */
async function appDevice(gh: FakeGitHub, name: string): Promise<Device & { use: () => void }> {
  const d = new Device(gh, name, {
    onFilesChanged: async (paths) => {
      setDb(d.db)
      await reindexPaths(paths)
    },
  }) as Device & { use: () => void }
  d.use = () => setDb(d.db)
  devices.push(d)
  d.use()
  await d.engine.pull()
  await reindexAll()
  return d
}

const subject = (gh: FakeGitHub) => gh.commits(FULL)[0].message.split('\n')[0]

describe('trash with files the app keeps no rows for (DATA-22)', () => {
  it('deletes, restores and purges a page whose folder holds an image', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const gh = await makeGitHub({ '工作.md': page(W, '工作\n'), '工作/子.md': page(S, '子\n'), '工作/圖.png': png })
    const a = await appDevice(gh, 'A')

    const entry = await deletePage(W)
    await a.engine.push()
    expect(subject(gh)).toBe('刪除「工作」')
    expect(gh.listFiles(FULL)).toEqual([`.notes/trash/${entry}/工作.md`, `.notes/trash/${entry}/工作/圖.png`, `.notes/trash/${entry}/工作/子.md`, TRASH_INDEX_PATH])
    expect(await a.dirty()).toEqual([])
    expect(await a.db.files.where('kind').equals('blob').count()).toBe(0)

    expect(await restorePage(entry)).toBe(W)
    await a.engine.push()
    expect(subject(gh)).toBe('還原「工作」')
    expect(gh.listFiles(FULL)).toEqual([TRASH_INDEX_PATH, '工作.md', '工作/圖.png', '工作/子.md'])
    expect(gh.readBytes(FULL, '工作/圖.png')).toEqual(png)
    expect(await a.dirty()).toEqual([])

    const again = await deletePage(W)
    await a.engine.push()
    await purgeTrashEntry(again)
    await a.engine.push()
    expect(subject(gh)).toBe('永久刪除「工作」')
    expect(gh.listFiles(FULL)).toEqual([TRASH_INDEX_PATH])
    expect(parseTrashIndex(await gh.readFile(FULL, TRASH_INDEX_PATH)).value.entries).toEqual([])
    expect(await a.db.files.toArray().then((rows) => rows.filter((r) => r.dirty || r.kind === 'blob'))).toEqual([])
  })

  it('undoes a delete before it was pushed: nothing reaches GitHub', async () => {
    const gh = await makeGitHub({ '工作.md': page(W, '工作\n'), '工作/圖.png': new Uint8Array([1]) })
    const a = await appDevice(gh, 'A')
    const commits = gh.commits(FULL).length
    const entry = await deletePage(W)
    await restorePage(entry)
    await a.engine.push()
    // Only the (now empty) trash index is new.
    expect(gh.commits(FULL).length).toBeLessThanOrEqual(commits + 1)
    expect(gh.listFiles(FULL).filter((p) => p !== TRASH_INDEX_PATH)).toEqual(['工作.md', '工作/圖.png'])
    expect(await a.dirty()).toEqual([])
  })
})

describe('conflicts and the trash', () => {
  async function conflicted() {
    const gh = await makeGitHub({ 'x.md': page(X, '一\n\n二\n') })
    const a = await appDevice(gh, 'iPhone')
    await a.edit('x.md', page(X, '一（iPhone）\n\n二\n'))
    await gh.commit(FULL, { files: { 'x.md': page(X, '一（Mac）\n\n二\n') }, device: 'Mac' })
    await a.engine.pull()
    expect((await a.row('x.md'))!.conflict).not.toBeNull()
    return { gh, a }
  }

  it('restores a version replaced in a conflict as its own page', async () => {
    const { gh, a } = await conflicted()
    await a.engine.resolveConflict('x.md', 'theirs')
    await a.engine.push()
    const [entry] = await listTrash()
    expect(entry.reason).toBe('replaced')
    const key = await restorePage(entry.id)
    await a.engine.push()
    const restored = (await getPage(key!))!
    expect(restored.path).toBe('x (2).md')
    expect(restored.title).toBe('x')
    const text = (await gh.readFile(FULL, 'x (2).md'))!
    expect(splitPageFile(text).body).toBe('一（iPhone）\n\n二\n')
    expect(readPageId(text)).not.toBe(X)
    expect(readPageId((await gh.readFile(FULL, 'x.md'))!)).toBe(X)
  })

  it('renaming a page in conflict keeps the conflict on the new path', async () => {
    const { gh, a } = await conflicted()
    await renamePage(X, '新名字')
    const moved = (await a.row('新名字.md'))!
    expect(moved.conflict).not.toBeNull()
    expect((await a.row('x.md'))!.conflict).toBeNull()
    const commits = gh.commits(FULL).length
    await a.engine.push()
    expect(gh.commits(FULL)).toHaveLength(commits)
    await a.engine.resolveConflict('新名字.md', 'mine')
    await a.engine.push()
    expect(gh.listFiles(FULL).filter((p) => !p.startsWith('.notes/'))).toEqual(['新名字.md'])
    expect(splitPageFile((await gh.readFile(FULL, '新名字.md'))!).body).toBe('一（iPhone）\n\n二\n')
  })

  it('deleting a page in conflict deletes it', async () => {
    const { gh } = await conflicted()
    const a = devices[0]
    const entry = await deletePage(X)
    await a.engine.push()
    expect(gh.listFiles(FULL)).toEqual([`.notes/trash/${entry}/x.md`, TRASH_INDEX_PATH])
    expect(await a.dirty()).toEqual([])
  })
})

describe('local operations while a push is in flight', () => {
  it('a new page renamed during its first push ends up only under the new name', async () => {
    const gh = await makeGitHub()
    const a = await appDevice(gh, 'A')
    const key = await createPage({ title: '舊名', body: '內容\n' })
    let renamed = false
    const off = gh.onRequest(async (r) => {
      if (!renamed && r.method === 'PATCH') {
        renamed = true
        await renamePage(key, '新名')
      }
    })
    await a.engine.push()
    off()
    expect(gh.listFiles(FULL)).toContain('舊名.md')
    await a.engine.push()
    expect(subject(gh)).toBe('重新命名「舊名」為「新名」')
    expect(gh.listFiles(FULL)).toEqual(['README.md', '新名.md'])
    expect(await a.dirty()).toEqual([])
  })

  it('a page edited during the push keeps the edit', async () => {
    const gh = await makeGitHub({ 'x.md': page(X, '一\n') })
    const a = await appDevice(gh, 'A')
    await savePageBody(X, '二\n')
    let typed = false
    const off = gh.onRequest(async (r) => {
      if (!typed && r.method === 'PATCH') {
        typed = true
        await savePageBody(X, '三\n')
      }
    })
    await a.engine.push()
    off()
    await a.engine.push()
    expect(splitPageFile((await gh.readFile(FULL, 'x.md'))!).body).toBe('三\n')
  })
})

describe('remote moves and the page index', () => {
  it('the page keeps its key after a move on another device (the open page follows)', async () => {
    const gh = await makeGitHub({ 'x.md': page(X, 'x\n'), 'p.md': page(P, 'p\n'), '首頁.md': '[x](/x.md)\n' })
    const a = await appDevice(gh, 'A')
    const b = await appDevice(gh, 'B')
    await movePage(X, P)
    await b.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['p.md', 'p/x.md', '首頁.md'])
    expect(await gh.readFile(FULL, '首頁.md')).toBe('[x](/p/x.md)\n')
    a.use()
    expect((await getPage(X))!.path).toBe('x.md')
    await a.engine.pull()
    a.use()
    expect((await getPage(X))!.path).toBe('p/x.md')
    expect((await getPage(X))!.parentKey).toBe(P)
    expect(await a.db.pages.where('path').equals('x.md').count()).toBe(0)
  })

  it('renaming a page without an id gives it one and pushes one consistent result', async () => {
    const gh = await makeGitHub({ 'README.md': '# Hi\n' })
    const a = await appDevice(gh, 'A')
    const id = await renamePage('path:README.md', '介紹')
    await a.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['介紹.md'])
    expect(readPageMeta(splitPageFile((await gh.readFile(FULL, '介紹.md'))!).frontmatter).id).toBe(id)
    expect(subject(gh)).toBe('重新命名「README」為「介紹」')
  })
})

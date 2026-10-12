import { afterEach, describe, expect, it } from 'vitest'
import { GitHubClient, GitHubError } from '../github/client'
import { gitBlobSha } from '../github/encoding'
import { parseTrashIndex } from '../data/notesFiles'
import type { FakeGitHub } from '../../../test/fake-github'
import { TRASH_INDEX_PATH } from '../types'
import { SyncEngine } from './engine'
import { planPush } from './push'
import { Device, FULL, TOKEN, makeGitHub, page } from './testHarness'

const ID_A = '01JA8Z3K5N6P7Q8R9S0T1V2W3A'
const ID_B = '01JA8Z3K5N6P7Q8R9S0T1V2W3B'
const ID_C = '01JA8Z3K5N6P7Q8R9S0T1V2W3C'

const devices: Device[] = []
function device(gh: FakeGitHub, name: string, opts: ConstructorParameters<typeof Device>[2] = {}): Device {
  const d = new Device(gh, name, opts)
  devices.push(d)
  return d
}

afterEach(async () => {
  for (const d of devices.splice(0)) await d.close()
})

const head = (gh: FakeGitHub) => gh.commits(FULL)[0]

describe('SYNC-8 push', () => {
  it('pushes a new page in one commit with the SYNC-9 message and Device trailer', async () => {
    const gh = await makeGitHub()
    const d = device(gh, 'iPhone · Safari')
    await d.engine.pull()
    await d.edit('會議記錄.md', page(ID_A, '今天的會議\n'))
    await d.engine.push()
    expect(head(gh).message).toBe(`新增「會議記錄」\n\nDevice: iPhone · Safari\nApp: GitHub Notes ${__APP_VERSION__}`)
    expect(await gh.readFile(FULL, '會議記錄.md')).toBe(page(ID_A, '今天的會議\n'))
    const row = (await d.row('會議記錄.md'))!
    expect(row).toMatchObject({ dirty: false, pushing: null, baseText: page(ID_A, '今天的會議\n') })
    expect(row.baseSha).toBe(gh.blobSha(FULL, '會議記錄.md'))
    const state = (await d.db.sync.get('state'))!
    expect(state.headSha).toBe(gh.headSha(FULL))
    expect(state.treeSha).toBe(head(gh).tree)
    expect(state.tree!['會議記錄.md'].sha).toBe(row.baseSha)
    expect(state.lastPushAt).not.toBeNull()
    // The next pull is a 304 / same head: nothing to download.
    const before = gh.requests.length
    await d.engine.pull()
    expect(gh.requests.slice(before).every((r) => r.path.includes('/git/ref/'))).toBe(true)
  })

  it('updates several pages in one commit', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n', 'b.md': 'b\n', 'c.md': 'c\n' })
    const d = device(gh, 'Mac · Safari')
    await d.engine.pull()
    await d.edit('a.md', 'a2\n')
    await d.engine.push()
    expect(head(gh).message.split('\n')[0]).toBe('更新「a」')
    await d.edit('b.md', 'b2\n')
    await d.edit('c.md', 'c2\n')
    await d.engine.push()
    expect(head(gh).message.split('\n')[0]).toBe('更新 2 頁')
    expect(gh.commits(FULL)).toHaveLength(3)
  })

  it('keeps typing that happens during a push (step 7)', async () => {
    const gh = await makeGitHub({ 'a.md': 'v1\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', 'v2\n')
    let typed = false
    const off = gh.onRequest(async (r) => {
      if (!typed && r.method === 'PATCH') {
        typed = true
        expect((await d.row('a.md'))!.pushing).toBe('v2\n')
        await d.edit('a.md', 'v3 typed during the push\n')
      }
    })
    await d.engine.push()
    off()
    expect(await gh.readFile(FULL, 'a.md')).toBe('v2\n')
    const row = (await d.row('a.md'))!
    expect(row).toMatchObject({ baseText: 'v2\n', text: 'v3 typed during the push\n', pushing: null, dirty: true })
    expect(row.baseSha).toBe(await gitBlobSha('v2\n'))
    await d.engine.push()
    expect(await gh.readFile(FULL, 'a.md')).toBe('v3 typed during the push\n')
    expect(await d.dirty()).toEqual([])
  })

  it('pushes offline edits as one commit once back online', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n', 'b.md': 'b\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    gh.offline = true
    await d.edit('a.md', 'a offline\n')
    await expect(d.engine.push()).rejects.toMatchObject({ kind: 'network' })
    await d.edit('b.md', 'b offline\n')
    await d.edit('新.md', page(ID_A, '離線新增\n'))
    await expect(d.engine.push()).rejects.toMatchObject({ kind: 'network' })
    gh.offline = false
    const commits = gh.commits(FULL).length
    await d.engine.push()
    expect(gh.commits(FULL)).toHaveLength(commits + 1)
    expect(head(gh).message.split('\n')[0]).toBe('新增「新」')
    expect(await gh.files(FULL)).toMatchObject({ 'a.md': 'a offline\n', 'b.md': 'b offline\n', '新.md': page(ID_A, '離線新增\n') })
    expect(await d.dirty()).toEqual([])
  })

  it('retries from the pull after a non-fast-forward ref update (422)', async () => {
    const gh = await makeGitHub({ 'a.md': '一\n\n二\n', 'b.md': 'b\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', '一（這台）\n\n二\n')
    let raced = false
    const off = gh.onRequest(async (r) => {
      if (!raced && r.method === 'POST' && r.path.endsWith('/git/commits')) {
        raced = true
        await gh.commit(FULL, { files: { 'a.md': '一\n\n二（另一台）\n', 'b.md': 'b2\n' }, device: 'B' })
      }
    })
    await d.engine.push()
    off()
    expect(gh.count('PATCH', /\/git\/refs\//)).toBe(2)
    const [ours, theirs] = gh.commits(FULL)
    expect(ours.parents).toEqual([theirs.sha])
    expect(await gh.files(FULL)).toMatchObject({ 'a.md': '一（這台）\n\n二（另一台）\n', 'b.md': 'b2\n' })
    expect(await d.text('b.md')).toBe('b2\n')
  })

  it('gives up after 3 failed ref updates with conflict-retry', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', 'a2\n')
    gh.failNext({ kind: 'status', status: 422, message: 'Update is not a fast forward' }, { times: 3, match: (r) => r.method === 'PATCH' })
    const err = await d.engine.push().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitHubError)
    expect((err as GitHubError).kind).toBe('conflict-retry')
    expect(await d.engine.getStatus()).toMatchObject({ state: 'error', error: { kind: 'conflict-retry' } })
    expect(await d.dirty()).toEqual(['a.md'])
    await d.engine.push()
    expect(await d.engine.getStatus()).toEqual({ state: 'synced' })
  })

  it('deletes only paths that exist in the head tree (step 4)', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n', 'b.md': 'b\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    // Deleted here and on GitHub: no tree entry, no error, the row just goes away.
    await d.db.files.update('a.md', { deleted: true, dirty: true })
    await gh.commit(FULL, { files: { 'a.md': null } })
    await d.edit('b.md', 'b2\n')
    await d.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['b.md'])
    expect(await d.row('a.md')).toBeUndefined()
    expect(await gh.readFile(FULL, 'b.md')).toBe('b2\n')

    // The planner on its own: a deletion whose path is not in the tree becomes a drop.
    const plan = planPush(
      [{ path: 'gone.md', kind: 'page', baseSha: 'f'.repeat(40), baseText: 'x', text: 'x', pushing: null, dirty: true, deleted: true, conflict: null, updatedAt: 0 }],
      [],
      {},
    )
    expect(plan.entries).toEqual([])
    expect(plan.drop).toEqual(['gone.md'])
  })

  it('never pushes a new page whose title and body are empty (SYNC-7)', async () => {
    const gh = await makeGitHub()
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('未命名.md', page(ID_A, ''))
    await d.edit('未命名 (2).md', '')
    await d.engine.push()
    expect(gh.commits(FULL)).toHaveLength(1)
    expect(await d.engine.getStatus()).toEqual({ state: 'synced' })
    await d.edit('未命名.md', page(ID_A, '有內容了\n'))
    await d.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['README.md', '未命名.md'])
  })

  it('uploads attachments as blobs and removes the uploads rows', async () => {
    const gh = await makeGitHub({ '筆記.md': 'x\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])
    await d.db.uploads.put({ path: '_assets/2026/10/3f9a2c1b.png', blob: new Blob([bytes]), sha256: '3f9a2c1b', createdAt: 0 })
    await d.engine.push()
    expect(head(gh).message.split('\n')[0]).toBe('上傳圖片')
    expect(gh.readBytes(FULL, '_assets/2026/10/3f9a2c1b.png')).toEqual(bytes)
    expect(await d.db.uploads.count()).toBe(0)
    const state = (await d.db.sync.get('state'))!
    expect(state.tree!['_assets/2026/10/3f9a2c1b.png'].sha).toBe(await gitBlobSha(bytes))
    expect(gh.count('POST', /\/git\/blobs$/)).toBe(1)
  })

  it('moves a page with its children and attachments in one commit (SYNC-10)', async () => {
    const gh = await makeGitHub({
      '工作.md': page(ID_A, '工作\n'),
      '專案 A.md': page(ID_B, '專案\n'),
      '專案 A/子頁.md': page(ID_C, '子頁\n'),
      '專案 A/圖.png': new Uint8Array([1, 2, 3, 4]),
    })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.move('專案 A.md', '工作/專案 A.md')
    await d.engine.push()
    expect(head(gh).message.split('\n')[0]).toBe('移動「專案 A」到「工作」')
    expect(gh.listFiles(FULL)).toEqual(['工作.md', '工作/專案 A.md', '工作/專案 A/圖.png', '工作/專案 A/子頁.md'])
    expect(gh.readBytes(FULL, '工作/專案 A/圖.png')).toEqual(new Uint8Array([1, 2, 3, 4]))
    const rows = await d.db.files.toArray()
    expect(rows.map((r) => r.path).sort()).toEqual(['工作.md', '工作/專案 A.md', '工作/專案 A/子頁.md'])
    expect(rows.every((r) => !r.dirty && !r.movedFrom && !r.movedTo)).toBe(true)
  })

  it('deletes a page into the trash (DATA-22)', async () => {
    const gh = await makeGitHub({ '工作.md': page(ID_A, '工作\n'), '工作/會議.md': page(ID_B, '會議\n') })
    const d = device(gh, 'A')
    await d.engine.pull()
    const entryId = await d.remove('工作.md')
    await d.engine.push()
    expect(head(gh).message.split('\n')[0]).toBe('刪除「工作」')
    expect(gh.listFiles(FULL)).toEqual([`.notes/trash/${entryId}/工作.md`, `.notes/trash/${entryId}/工作/會議.md`, TRASH_INDEX_PATH])
    const index = parseTrashIndex(await gh.readFile(FULL, TRASH_INDEX_PATH)).value
    expect(index.entries).toMatchObject([{ id: entryId, title: '工作', originalPath: '工作.md', reason: 'deleted' }])
  })

  it('pushes nothing for pages in conflict but keeps syncing the rest', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n', 'b.md': 'b\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', 'a local\n')
    await gh.commit(FULL, { files: { 'a.md': 'a remote\n' }, device: 'B' })
    await d.engine.pull()
    expect((await d.row('a.md'))!.conflict).not.toBeNull()
    await d.edit('b.md', 'b2\n')
    await d.engine.push()
    expect(await gh.readFile(FULL, 'a.md')).toBe('a remote\n')
    expect(await gh.readFile(FULL, 'b.md')).toBe('b2\n')
    expect(head(gh).message.split('\n')[0]).toBe('更新「b」')
  })

  it('401 keeps local edits; they are pushed once the token is replaced', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', 'a edited\n')
    gh.revokeToken(TOKEN)
    await expect(d.engine.push()).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(await d.engine.getStatus()).toMatchObject({ state: 'error', error: { kind: 'unauthorized' } })
    expect(await d.text('a.md')).toBe('a edited\n')
    gh.addToken('github_pat_new', { login: 'me', repos: [FULL] })
    const engine = new SyncEngine({
      ...d.engine.options,
      client: new GitHubClient({ token: 'github_pat_new', fetch: gh.fetch }),
    })
    await engine.push()
    expect(await gh.readFile(FULL, 'a.md')).toBe('a edited\n')
    expect(await engine.getStatus()).toEqual({ state: 'synced' })
  })

  it('recovers when a push landed but the tab closed before recording it', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', 'a2\n')
    await d.edit('new.md', 'new\n')
    // The PATCH reaches GitHub and the ref moves, but the response is lost (network error).
    let landed = false
    const off = gh.onRequest(async (r) => {
      if (!landed && r.method === 'PATCH') {
        landed = true
        const body = r.body as { sha: string }
        await gh.handle(
          new Request(r.url, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: body.sha, force: false }),
          }),
        )
        gh.failNext({ kind: 'network' })
      }
    })
    await expect(d.engine.push()).rejects.toMatchObject({ kind: 'network' })
    off()
    expect((await d.row('a.md'))!.pushing).toBe('a2\n')
    const commits = gh.commits(FULL).length
    await d.engine.push()
    expect(gh.commits(FULL)).toHaveLength(commits)
    expect(await d.dirty()).toEqual([])
    expect((await d.row('new.md'))!.baseSha).toBe(gh.blobSha(FULL, 'new.md'))
  })
})

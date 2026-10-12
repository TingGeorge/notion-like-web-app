import { afterEach, describe, expect, it } from 'vitest'
import { gitBlobSha } from '../github/encoding'
import { GitHubError } from '../github/client'
import { t } from '../../strings/zh-TW'
import type { FakeGitHub } from '../../../test/fake-github'
import { Device, FULL, makeGitHub, page } from './testHarness'
import type { InitialSyncProgress } from './engine'

const ID_A = '01JA8Z3K5N6P7Q8R9S0T1V2W3A'
const ID_B = '01JA8Z3K5N6P7Q8R9S0T1V2W3B'

const devices: Device[] = []
function device(gh: FakeGitHub, name: string): Device {
  const d = new Device(gh, name)
  devices.push(d)
  return d
}

afterEach(async () => {
  for (const d of devices.splice(0)) await d.close()
})

describe('SETUP-10 / SYNC-5: initial sync', () => {
  it('downloads every page, meta and trash file, and records head, tree and etag', async () => {
    const gh = await makeGitHub({
      'README.md': '# Notes\n',
      '工作.md': page(ID_A, '工作\n'),
      '工作/會議記錄.md': '會議\n',
      '.notes/settings.json': '{"version":1,"favorites":[],"order":{},"trashRetentionDays":30}\n',
      '.notes/trash/01T/舊.md': '舊\n',
      '.github/workflows/ci.yml': 'x: 1\n',
      '_assets/2026/10/a.png': new Uint8Array([1, 2, 3]),
      'docs/notes.txt': 'not a page\n',
    })
    const d = device(gh, 'Mac · Safari')
    const progress: InitialSyncProgress[] = []
    await d.engine.initialSync((p) => progress.push(p))
    expect(await d.paths()).toEqual(['.notes/settings.json', '.notes/trash/01T/舊.md', 'README.md', '工作.md', '工作/會議記錄.md'])
    const row = (await d.row('工作/會議記錄.md'))!
    expect(row).toMatchObject({ kind: 'page', text: '會議\n', baseText: '會議\n', dirty: false, deleted: false, conflict: null })
    expect(row.baseSha).toBe(gh.blobSha(FULL, '工作/會議記錄.md'))
    expect((await d.row('.notes/trash/01T/舊.md'))!.kind).toBe('trash')
    expect((await d.row('.notes/settings.json'))!.kind).toBe('meta')
    const state = (await d.db.sync.get('state'))!
    expect(state.headSha).toBe(gh.headSha(FULL))
    expect(state.etag).toBeTruthy()
    // The tree snapshot covers every file (attachments included), no folders.
    expect(Object.keys(state.tree!).sort()).toEqual([
      '.github/workflows/ci.yml',
      '.notes/settings.json',
      '.notes/trash/01T/舊.md',
      'README.md',
      '_assets/2026/10/a.png',
      'docs/notes.txt',
      '工作.md',
      '工作/會議記錄.md',
    ])
    expect(progress[0].phase).toBe('list')
    expect(progress.filter((p) => p.phase === 'download').at(-1)).toEqual({ phase: 'download', done: 5, total: 5 })
    expect(progress.map((p) => p.phase)).toContain('index')
    expect(progress.at(-1)!.phase).toBe('done')
    expect(d.changed.flat().sort()).toEqual((await d.paths()).sort())
    expect(d.flushes).toBe(1)
  })

  it('uses GraphQL batches for more than 20 files', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 150; i++) files[`頁面 ${i}.md`] = `第 ${i} 頁\n`
    const gh = await makeGitHub(files)
    const d = device(gh, 'A')
    await d.engine.initialSync(() => {})
    expect((await d.paths()).length).toBe(150)
    expect(gh.count('POST', '/graphql')).toBe(2)
    expect(gh.count('GET', /\/git\/blobs\//)).toBe(0)
    expect(await d.text('頁面 149.md')).toBe('第 149 頁\n')
  })

  it('stops at 304 and when the ref equals headSha', async () => {
    const gh = await makeGitHub()
    const d = device(gh, 'A')
    await d.engine.pull()
    const before = gh.requests.length
    await d.engine.pull()
    expect(gh.requests.slice(before).map((r) => `${r.method} ${r.status}`)).toEqual(['GET 304'])
    expect(gh.count('GET', /\/git\/trees\//)).toBe(1)
  })

  it('reports a truncated tree as too large', async () => {
    const gh = await makeGitHub()
    gh.truncateTrees = true
    const d = device(gh, 'A')
    const err = await d.engine.pull().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitHubError)
    expect((err as GitHubError).kind).toBe('too-large')
    expect(await d.engine.getStatus()).toMatchObject({ state: 'error', error: { kind: 'too-large', message: t.sync.errors['too-large'] } })
  })

  it('takes remote edits, adds and deletes for clean files', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n', 'b.md': 'b\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await gh.commit(FULL, { files: { 'a.md': 'a2\n', 'b.md': null, 'c.md': 'c\n' }, device: 'iPhone · Safari' })
    d.changed.length = 0
    await d.engine.pull()
    expect(await d.paths()).toEqual(['a.md', 'c.md'])
    expect(await d.text('a.md')).toBe('a2\n')
    expect((await d.row('a.md'))!.baseSha).toBe(gh.blobSha(FULL, 'a.md'))
    expect(d.changed.flat().sort()).toEqual(['a.md', 'b.md', 'c.md'])
    expect(await d.dirty()).toEqual([])
  })

  it('detects a remote move by id and carries local edits to the new path', async () => {
    const base = page(ID_A, '第一段\n\n第二段\n')
    const gh = await makeGitHub({ '專案 A.md': base, '工作.md': '工作\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('專案 A.md', page(ID_A, '第一段（這台）\n\n第二段\n'))
    await gh.commit(FULL, { files: { '專案 A.md': null, '工作/專案 A.md': page(ID_A, '第一段\n\n第二段（另一台）\n') }, device: 'iPhone · Safari' })
    await d.engine.pull()
    expect(await d.row('專案 A.md')).toBeUndefined()
    const moved = (await d.row('工作/專案 A.md'))!
    expect(moved.text).toBe(page(ID_A, '第一段（這台）\n\n第二段（另一台）\n'))
    expect(moved.baseText).toBe(page(ID_A, '第一段\n\n第二段（另一台）\n'))
    expect(moved.dirty).toBe(true)
  })

  it('ignores duplicated ids for move detection (DATA-9a)', async () => {
    const gh = await makeGitHub({ 'a.md': page(ID_A, 'a\n') })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', page(ID_A, 'a local\n'))
    // a.md disappears, and two files now carry its id: no move, so the dirty page is kept.
    await gh.commit(FULL, { files: { 'a.md': null, 'x.md': page(ID_A, 'x\n'), 'y.md': page(ID_A, 'y\n') } })
    await d.engine.pull()
    expect(await d.text('a.md')).toBe(page(ID_A, 'a local\n'))
    expect((await d.row('a.md'))!.baseSha).toBeNull()
    expect(await d.text('x.md')).toBe(page(ID_A, 'x\n'))
    expect(d.notices).toContain(t.page.remoteDeletedKept)
  })

  it('keeps a dirty page deleted on another device, with a notice (rule 3)', async () => {
    const gh = await makeGitHub({ 'a.md': 'a\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', 'a edited\n')
    await gh.commit(FULL, { files: { 'a.md': null } })
    await d.engine.pull()
    expect(await d.row('a.md')).toMatchObject({ text: 'a edited\n', baseSha: null, baseText: null, dirty: true })
    expect(d.notices).toEqual([t.page.remoteDeletedKept])
    await d.engine.push()
    expect(await gh.readFile(FULL, 'a.md')).toBe('a edited\n')
  })

  it('renames an unpushed local page that took the same path (rule 5, DATA-6)', async () => {
    const gh = await makeGitHub()
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('會議.md', page(ID_A, '這台的會議\n'))
    await gh.commit(FULL, { files: { '會議.md': page(ID_B, '另一台的會議\n') } })
    await d.engine.pull()
    expect(await d.text('會議.md')).toBe(page(ID_B, '另一台的會議\n'))
    expect(await d.text('會議 (2).md')).toBe(`---\nid: ${ID_A}\ntitle: "會議"\n---\n這台的會議\n`)
    await d.engine.push()
    expect(gh.listFiles(FULL)).toEqual(['README.md', '會議 (2).md', '會議.md'])
  })

  it('adopts a remote file equal to the local unpushed one', async () => {
    const gh = await makeGitHub()
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('同.md', '一樣\n')
    await gh.commit(FULL, { files: { '同.md': '一樣\n' } })
    await d.engine.pull()
    expect(await d.row('同.md')).toMatchObject({ dirty: false, baseSha: gh.blobSha(FULL, '同.md') })
    expect(await d.paths()).toEqual(['README.md', '同.md'])
  })

  it('merges a remote edit while the local file is dirty (rule 4)', async () => {
    const gh = await makeGitHub({ 'a.md': '一\n\n二\n\n三\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('a.md', '一（這台）\n\n二\n\n三\n')
    await gh.commit(FULL, { files: { 'a.md': '一\n\n二\n\n三（另一台）\n' } })
    await d.engine.pull()
    expect(await d.row('a.md')).toMatchObject({ text: '一（這台）\n\n二\n\n三（另一台）\n', baseText: '一\n\n二\n\n三（另一台）\n', dirty: true, conflict: null })
  })

  it('replans when the local text changes during the pull', async () => {
    const gh = await makeGitHub({ 'a.md': '一\n\n二\n\n三\n' })
    const d = device(gh, 'A')
    await d.engine.pull()
    await gh.commit(FULL, { files: { 'a.md': '一\n\n二\n\n三（另一台）\n' } })
    let typed = false
    const off = gh.onRequest(async (r) => {
      if (!typed && r.method === 'GET' && r.path.includes('/git/blobs/')) {
        typed = true
        await d.edit('a.md', '一（打字中）\n\n二\n\n三\n')
      }
    })
    await d.engine.pull()
    off()
    expect(typed).toBe(true)
    expect(await d.text('a.md')).toBe('一（打字中）\n\n二\n\n三（另一台）\n')
  })

  it('computes the same blob SHA as GitHub', async () => {
    const text = '---\nid: 01JA\n---\n中文、emoji 🎉 與 CRLF\r\n\n'
    const gh = await makeGitHub({ 'x.md': text })
    expect(await gitBlobSha(text)).toBe(gh.blobSha(FULL, 'x.md'))
    const d = device(gh, 'A')
    await d.engine.pull()
    await d.edit('x.md', `${text}more\n`)
    await d.engine.push()
    expect((await d.row('x.md'))!.baseSha).toBe(gh.blobSha(FULL, 'x.md'))
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { parseSettings, parseTrashIndex } from '../data/notesFiles'
import { isUlid } from '../data/ulid'
import { readPageMeta, splitPageFile } from '../markdown'
import { NotesDB, setDb, db } from '../store/db'
import { SETTINGS_PATH, TRASH_INDEX_PATH, type FileRow } from '../types'
import { moveFile } from './files'
import { reindexAll } from './indexer'
import {
  createPage,
  deletePage,
  discardIfEmptyNew,
  duplicatePage,
  ensureId,
  getPage,
  movePage,
  purgeTrashEntry,
  renamePage,
  restorePage,
  savePageBody,
  setFavorite,
} from './ops'

let n = 0
beforeEach(() => {
  setDb(new NotesDB(`ops-test-${n++}`))
})

/** A file as it would be after a pull: clean, same as GitHub. */
async function remoteFile(path: string, text: string, kind: FileRow['kind'] = 'page') {
  await db().files.put({
    path,
    kind,
    baseSha: `sha-${path}`,
    baseText: text,
    text,
    pushing: null,
    dirty: false,
    deleted: false,
    conflict: null,
    updatedAt: 1,
  })
}

const text = async (path: string) => (await db().files.get(path))?.text ?? null
const row = (path: string) => db().files.get(path)

describe('createPage (UI-10, DATA-4..6, DATA-8)', () => {
  it('creates 未命名 with an id and created date, and (2) on a clash', async () => {
    const a = await createPage()
    const b = await createPage()
    expect(isUlid(a)).toBe(true)
    const pa = await getPage(a)
    const pb = await getPage(b)
    expect(pa?.path).toBe('未命名.md')
    expect(pb?.path).toBe('未命名 (2).md')
    expect(pb?.title).toBe('未命名')
    const meta = readPageMeta(splitPageFile((await text('未命名 (2).md'))!).frontmatter)
    expect(meta.title).toBe('未命名')
    expect(meta.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/)
    expect((await row('未命名.md'))?.dirty).toBe(true)
  })

  it('creates children in the parent folder, also under a virtual page', async () => {
    await remoteFile('docs/guide.md', '# Guide\n')
    await reindexAll()
    const docs = (await db().pages.where('path').equals('docs.md').first())!
    expect(docs.virtual).toBe(true)
    const child = await createPage({ parentKey: docs.key, title: '新頁' })
    expect((await getPage(child))?.path).toBe('docs/新頁.md')
    expect((await getPage(child))?.parentKey).toBe(docs.key)
  })

  it('discards an empty new page when left', async () => {
    const key = await createPage()
    expect(await discardIfEmptyNew(key)).toBe(true)
    expect(await row('未命名.md')).toBeUndefined()
    const kept = await createPage({ body: 'hello\n' })
    expect(await discardIfEmptyNew(kept)).toBe(false)
  })
})

describe('DATA-9 ids', () => {
  it('does not rewrite a file without frontmatter until it is saved', async () => {
    await remoteFile('README.md', '# Hi\n')
    await reindexAll()
    const page = (await db().pages.where('path').equals('README.md').first())!
    expect(page.key).toBe('path:README.md')
    expect(await text('README.md')).toBe('# Hi\n')
    const id = await savePageBody(page.key, '# Hi\n\nmore\n')
    expect(isUlid(id)).toBe(true)
    const saved = (await text('README.md'))!
    expect(saved.startsWith(`---\nid: ${id}\ncreated: `)).toBe(true)
    expect(saved.endsWith('---\n# Hi\n\nmore\n')).toBe(true)
    expect((await getPage(id))?.path).toBe('README.md')
  })

  it('ensureId adds only id and created, keeping unknown keys', async () => {
    await remoteFile('a.md', '---\ntags: [x]\n---\nbody\n')
    await reindexAll()
    const id = await ensureId('path:a.md')
    const t = (await text('a.md'))!
    expect(t).toMatch(new RegExp(`^---\\nid: ${id}\\ntags: \\[x\\]\\ncreated: .+\\n---\\nbody\\n$`))
  })
})

describe('rename and move (DATA-7, DATA-17, SYNC-10)', () => {
  beforeEach(async () => {
    await remoteFile('工作.md', '---\nid: 01J0000000000000000000WORK\n---\n工作頁\n')
    await remoteFile('工作/會議記錄.md', '---\nid: 01J00000000000000000000MTG\n---\n內容\n')
    await remoteFile('工作/會議記錄/附件.md', '---\nid: 01J0000000000000000000ATCH\n---\n附件\n')
    await remoteFile('首頁.md', '---\nid: 01J0000000000000000000HOME\n---\n[會議記錄](/工作/會議記錄.md)\n\n看 [附件](/工作/會議記錄/附件.md#a) 和 [外部](https://example.com)\n')
    await db().sync.put({
      key: 'state',
      headSha: 'h',
      treeSha: 't',
      etag: null,
      lastPullAt: null,
      lastPushAt: null,
      lastPushStartedAt: null,
      lastError: null,
      tree: { '工作/會議記錄/圖.png': { sha: 'pngsha', mode: '100644', type: 'blob' } },
    })
    await reindexAll()
  })

  it('renames a page with its child folder and rewrites inbound links', async () => {
    await renamePage('01J00000000000000000000MTG', '週會')
    expect((await row('工作/會議記錄.md'))?.deleted).toBe(true)
    expect((await row('工作/會議記錄.md'))?.movedTo).toBe('工作/週會.md')
    expect((await row('工作/週會.md'))?.movedFrom).toBe('工作/會議記錄.md')
    expect(await text('工作/週會/附件.md')).toContain('附件')
    // A non-text file inside the folder moves by SHA.
    expect((await row('工作/週會/圖.png'))?.blobSha).toBe('pngsha')
    expect((await row('工作/會議記錄/圖.png'))?.deleted).toBe(true)
    // The page link block's text follows the new title; other links keep their text.
    expect(await text('首頁.md')).toBe('---\nid: 01J0000000000000000000HOME\n---\n[週會](/工作/週會.md)\n\n看 [附件](/工作/週會/附件.md#a) 和 [外部](https://example.com)\n')
    expect((await getPage('01J00000000000000000000MTG'))?.title).toBe('週會')
  })

  it('stores the exact title in frontmatter when the name cannot hold it (DATA-5)', async () => {
    await renamePage('01J00000000000000000000MTG', 'a/b')
    const t = (await text('工作/a／b.md'))!
    expect(readPageMeta(splitPageFile(t).frontmatter).title).toBe('a/b')
    expect((await getPage('01J00000000000000000000MTG'))?.title).toBe('a/b')
  })

  it('moves a page to the top level and back without stale pointers', async () => {
    await movePage('01J00000000000000000000MTG', null)
    expect((await getPage('01J00000000000000000000MTG'))?.path).toBe('會議記錄.md')
    expect(await text('首頁.md')).toContain('[會議記錄](/會議記錄.md)')
    await movePage('01J00000000000000000000MTG', '01J0000000000000000000WORK')
    const back = await row('工作/會議記錄.md')
    expect(back?.deleted).toBe(false)
    expect(back?.movedFrom ?? null).toBe(null)
    expect(back?.dirty).toBe(false)
    expect(await row('會議記錄.md')).toBeUndefined()
    expect(await text('首頁.md')).toContain('[會議記錄](/工作/會議記錄.md)')
  })

  it('refuses to move a page into its own child', async () => {
    await expect(movePage('01J0000000000000000000WORK', '01J00000000000000000000MTG')).rejects.toThrow()
  })

  it('records the order among new siblings (DATA-21)', async () => {
    await movePage('01J0000000000000000000ATCH', null, 0)
    const settings = parseSettings(await text(SETTINGS_PATH)).value
    expect(settings.order.root[0]).toBe('01J0000000000000000000ATCH')
  })
})

describe('trash (DATA-22)', () => {
  it('deletes to .notes/trash/<id>/ and restores', async () => {
    await remoteFile('工作.md', '---\nid: 01J0000000000000000000WORK\n---\nx\n')
    await remoteFile('工作/子.md', '---\nid: 01J00000000000000000000SUB\n---\ny\n')
    await reindexAll()
    await setFavorite('01J0000000000000000000WORK', true)
    const entryId = await deletePage('01J0000000000000000000WORK')
    expect(entryId).toBe('01J0000000000000000000WORK')
    expect((await row('工作.md'))?.deleted).toBe(true)
    expect((await row(`.notes/trash/${entryId}/工作.md`))?.kind).toBe('trash')
    expect(await text(`.notes/trash/${entryId}/工作/子.md`)).toContain('y')
    const trash = parseTrashIndex(await text(TRASH_INDEX_PATH)).value
    expect(trash.entries[0]).toMatchObject({ id: entryId, title: '工作', originalPath: '工作.md', reason: 'deleted' })
    expect(parseSettings(await text(SETTINGS_PATH)).value.favorites).toEqual([])
    expect(await getPage('01J0000000000000000000WORK')).toBeUndefined()

    const key = await restorePage(entryId)
    expect(key).toBe('01J0000000000000000000WORK')
    expect((await row('工作.md'))?.deleted).toBe(false)
    expect((await row('工作.md'))?.dirty).toBe(false)
    expect(await text('工作/子.md')).toContain('y')
    expect(parseTrashIndex(await text(TRASH_INDEX_PATH)).value.entries).toEqual([])
  })

  it('purges a trash entry', async () => {
    const key = await createPage({ title: 'x', body: 'y\n' })
    const entryId = await deletePage(key)
    await purgeTrashEntry(entryId)
    expect(await db().files.where('path').startsWith(`.notes/trash/${entryId}/`).count()).toBe(0)
  })
})

describe('duplicate', () => {
  it('copies a page and its children with new ids', async () => {
    await remoteFile('A.md', '---\nid: 01J00000000000000000000AAA\nicon: "🚀"\n---\nbody\n')
    await remoteFile('A/B.md', '---\nid: 01J00000000000000000000BBB\n---\nchild\n')
    await reindexAll()
    const id = await duplicatePage('01J00000000000000000000AAA')
    const copy = (await getPage(id))!
    expect(copy.path).toBe('A (2).md')
    expect(copy.title).toBe('A')
    expect(copy.icon).toBe('🚀')
    const child = readPageMeta(splitPageFile((await text('A (2)/B.md'))!).frontmatter)
    expect(child.id).not.toBe('01J00000000000000000000BBB')
  })
})

describe('moveFile pointers (types.ts conventions)', () => {
  it('follows unpushed moves back to the original path', async () => {
    await remoteFile('a.md', 'x\n')
    await db().transaction('rw', db().files, async () => {
      await moveFile('a.md', 'b.md')
      await moveFile('b.md', 'c.md')
    })
    expect((await row('a.md'))?.movedTo).toBe('c.md')
    expect(await row('b.md')).toBeUndefined()
    expect((await row('c.md'))?.movedFrom).toBe('a.md')
  })
})

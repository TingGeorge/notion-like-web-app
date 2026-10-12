import { describe, expect, it } from 'vitest'
import { commitMessage, commitSummary, type PushChange } from './commitMessage'

const page = (id: string, body = 'x\n', title?: string) => `---\nid: ${id}\n${title ? `title: "${title}"\n` : ''}---\n${body}`
const ID = '01JA8Z3K5N6P7Q8R9S0T1V2W3X'
const ID2 = '01JA8Z3K5N6P7Q8R9S0T1V2W3Y'

describe('SYNC-9 commit messages', () => {
  it('update one page / several pages', () => {
    const one: PushChange[] = [{ op: 'write', path: '工作/會議記錄.md', kind: 'page', text: 'b\n', baseText: 'a\n' }]
    expect(commitSummary(one)).toBe('更新「會議記錄」')
    const many: PushChange[] = [
      ...one,
      { op: 'write', path: 'a.md', kind: 'page', text: 'b\n', baseText: 'a\n' },
      { op: 'write', path: 'b.md', kind: 'page', text: 'b\n', baseText: 'a\n' },
    ]
    expect(commitSummary(many)).toBe('更新 3 頁')
  })

  it('uses the frontmatter title (DATA-5)', () => {
    expect(commitSummary([{ op: 'write', path: 'a／b.md', kind: 'page', text: page(ID, 'x\n', 'a/b'), baseText: null }])).toBe('新增「a/b」')
  })

  it('add a page (with its parent updated for the link)', () => {
    const changes: PushChange[] = [
      { op: 'write', path: '工作/新頁面.md', kind: 'page', text: page(ID), baseText: null },
      { op: 'write', path: '工作.md', kind: 'page', text: '[新頁面](/工作/新頁面.md)\n', baseText: '' },
    ]
    expect(commitSummary(changes)).toBe('新增「新頁面」')
  })

  it('move a page and its children, with inbound links rewritten (SYNC-10)', () => {
    const changes: PushChange[] = [
      { op: 'delete', path: '專案 A.md', kind: 'page', baseText: page(ID), movedTo: '工作/專案 A.md' },
      { op: 'write', path: '工作/專案 A.md', kind: 'page', text: page(ID), baseText: null, movedFrom: '專案 A.md' },
      { op: 'delete', path: '專案 A/子頁.md', kind: 'page', baseText: page(ID2), movedTo: '工作/專案 A/子頁.md' },
      { op: 'write', path: '工作/專案 A/子頁.md', kind: 'page', text: page(ID2), baseText: null, movedFrom: '專案 A/子頁.md' },
      { op: 'delete', path: '專案 A/圖.png', kind: 'blob', baseText: null, movedTo: '工作/專案 A/圖.png' },
      { op: 'write', path: '首頁.md', kind: 'page', text: '[A](/工作/專案%20A.md)\n', baseText: '[A](/專案%20A.md)\n' },
      { op: 'write', path: '.notes/settings.json', kind: 'meta', text: '{}', baseText: '{ }' },
    ]
    expect(commitSummary(changes, (p) => (p === '工作.md' ? '工作' : null))).toBe('移動「專案 A」到「工作」')
  })

  it('a delete + add with the same id is a move; same folder is a rename', () => {
    const moved: PushChange[] = [
      { op: 'delete', path: 'a/x.md', kind: 'page', baseText: page(ID) },
      { op: 'write', path: 'x.md', kind: 'page', text: page(ID), baseText: null },
    ]
    expect(commitSummary(moved)).toBe('移動「x」到最上層')
    const renamed: PushChange[] = [
      { op: 'delete', path: 'a/x.md', kind: 'page', baseText: page(ID) },
      { op: 'write', path: 'a/y.md', kind: 'page', text: page(ID), baseText: null },
    ]
    expect(commitSummary(renamed)).toBe('重新命名「x」為「y」')
  })

  it('delete (into the trash), restore and purge', () => {
    const del: PushChange[] = [
      { op: 'delete', path: '工作.md', kind: 'page', baseText: 'x\n', movedTo: '.notes/trash/01T/工作.md' },
      { op: 'write', path: '.notes/trash/01T/工作.md', kind: 'trash', text: 'x\n', baseText: null, movedFrom: '工作.md' },
      { op: 'delete', path: '工作/會議.md', kind: 'page', baseText: 'y\n', movedTo: '.notes/trash/01T/工作/會議.md' },
      { op: 'write', path: '.notes/trash/01T/工作/會議.md', kind: 'trash', text: 'y\n', baseText: null, movedFrom: '工作/會議.md' },
      { op: 'write', path: '.notes/trash/index.json', kind: 'meta', text: '{}', baseText: null },
    ]
    expect(commitSummary(del)).toBe('刪除「工作」')
    const restore: PushChange[] = [
      { op: 'delete', path: '.notes/trash/01T/工作.md', kind: 'trash', baseText: 'x\n', movedTo: '工作.md' },
      { op: 'write', path: '工作.md', kind: 'page', text: 'x\n', baseText: null, movedFrom: '.notes/trash/01T/工作.md' },
    ]
    expect(commitSummary(restore)).toBe('還原「工作」')
    const purge: PushChange[] = [
      { op: 'delete', path: '.notes/trash/01T/工作.md', kind: 'trash', baseText: 'x\n' },
      { op: 'delete', path: '.notes/trash/01T/工作/會議.md', kind: 'trash', baseText: 'y\n' },
    ]
    expect(commitSummary(purge)).toBe('永久刪除「工作」')
  })

  it('uploads and settings', () => {
    expect(commitSummary([{ op: 'upload', path: '_assets/2026/10/ab12cd34.jpg' }])).toBe('上傳圖片')
    expect(commitSummary([{ op: 'upload', path: '_assets/2026/10/ab12cd34.pdf' }])).toBe('上傳檔案')
    expect(
      commitSummary([
        { op: 'upload', path: '_assets/2026/10/ab12cd34.jpg' },
        { op: 'write', path: '筆記.md', kind: 'page', text: '![](/_assets/2026/10/ab12cd34.jpg)\n', baseText: '' },
      ]),
    ).toBe('更新「筆記」')
    expect(commitSummary([{ op: 'write', path: '.notes/settings.json', kind: 'meta', text: '{}', baseText: null }])).toBe('更新設定')
  })

  it('a replaced version saved to the trash is a conflict resolution', () => {
    const changes: PushChange[] = [
      { op: 'write', path: '.notes/trash/01R/會議記錄.md', kind: 'trash', text: 'old\n', baseText: null },
      { op: 'write', path: '會議記錄.md', kind: 'page', text: 'mine\n', baseText: 'theirs\n' },
      { op: 'write', path: '.notes/trash/index.json', kind: 'meta', text: '{}', baseText: '{ }' },
    ]
    expect(commitSummary(changes)).toBe('處理「會議記錄」的衝突')
  })

  it('adds the Device and App trailers after a blank line', () => {
    expect(commitMessage('更新「x」', 'iPhone · Safari', '0.1.0')).toBe('更新「x」\n\nDevice: iPhone · Safari\nApp: GitHub Notes 0.1.0')
    expect(commitMessage('x', 'Mac · Safari')).toMatch(/\nApp: GitHub Notes \S+$/)
  })
})

/**
 * Two devices on one repo (SYNC-5, SYNC-6, SYNC-6a): clean merges, conflicts resolved each of the three ways,
 * delete against edit, move against edit and the same new title on both. Two browser contexts share one fake GitHub.
 */
import type { Page } from '@playwright/test'
import type { FakeGitHub } from '../test/fake-github'
import { expect, test } from './fixtures'
import {
  bodyOf,
  commitCount,
  createPage,
  deviceKindOf,
  editor,
  forceSync,
  frontmatterOf,
  offlineSwitch,
  openFromSidebar,
  pageMenu,
  pagePaths,
  readRepoFile,
  REPO,
  secondDevice,
  setupDevice,
  syncAndWaitForCommit,
  titleInput,
  trashIndex,
  treeRow,
  type Device,
  waitSynced,
} from './helpers'

/** Click into the paragraph containing `needle` and type at its end. */
async function appendToParagraph(page: Page, needle: string, text: string) {
  await editor(page).locator('p', { hasText: needle }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
  await page.waitForTimeout(400)
}

/** Both devices have page `title` with the body `lines` (one paragraph each), and are in sync. */
async function sharedPage(a: Page, b: Page, fake: FakeGitHub, title: string, lines: string): Promise<void> {
  await createPage(a, title, lines)
  await syncAndWaitForCommit(a, fake)
  await forceSync(b)
  await openFromSidebar(b, title)
  await expect(editor(b)).toContainText(lines.split('\n')[0])
}

async function goOffline(d: Pick<Device, 'setOffline'>) {
  await d.setOffline(true)
}

async function goOnline(d: Pick<Device, 'setOffline'>) {
  await d.setOffline(false)
}

test.describe('clean merge', () => {
  test('edits to different lines on two devices merge without a conflict', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const d = await secondDevice(browser, fake)
    const { page: b, context } = d
    await sharedPage(a, b, fake, '合併', '第一行\n第二行\n第三行')

    // Both edit while the other has not synced: A edits line 1, B (offline) line 3.
    await goOffline(d)
    await appendToParagraph(b, '第三行', '（B 改的）')
    await appendToParagraph(a, '第一行', '（A 改的）')
    await syncAndWaitForCommit(a, fake)
    expect(bodyOf(await readRepoFile(fake, '合併.md'))).toBe('第一行（A 改的）\n\n第二行\n\n第三行\n')

    const before = commitCount(fake)
    await goOnline(d)
    await expect.poll(() => commitCount(fake), { timeout: 20_000 }).toBe(before + 1)
    await waitSynced(b)
    // The merge keeps both edits, there is no conflict banner anywhere, and B shows the merged page.
    expect(bodyOf(await readRepoFile(fake, '合併.md'))).toBe('第一行（A 改的）\n\n第二行\n\n第三行（B 改的）\n')
    await expect(b.locator('.page-banner')).toHaveCount(0)
    await expect(editor(b)).toContainText('第一行（A 改的）')
    await expect(editor(b)).toContainText('第三行（B 改的）')
    // A pulls the merge result.
    await forceSync(a)
    await expect(editor(a)).toContainText('第三行（B 改的）')
    await expect(a.locator('.page-banner')).toHaveCount(0)
    await context.close()
  })

  test('a remote edit reaches the open, clean page without reloading', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const { page: b, context } = await secondDevice(browser, fake)
    await sharedPage(a, b, fake, '即時', '原來的字')
    await appendToParagraph(a, '原來的字', '加上去')
    await syncAndWaitForCommit(a, fake)
    await forceSync(b)
    await expect(editor(b)).toContainText('原來的字加上去')
    await context.close()
  })
})

test.describe('conflict', () => {
  /** B (offline) and A both change the second line; A pushes first; B comes online and meets the conflict. */
  async function makeConflict(a: Page, fake: FakeGitHub, d: Device) {
    const b = d.page
    await sharedPage(a, b, fake, '衝突', '開頭\n共同的一行\n結尾')
    await goOffline(d)
    await appendToParagraph(b, '共同的一行', '，B 的版本')
    await appendToParagraph(a, '共同的一行', '，A 的版本')
    await syncAndWaitForCommit(a, fake)
    await goOnline(d)
    await expect(b.locator('.page-banner')).toContainText('這一頁在兩台裝置上都被修改了。')
    // Pushes for the page are held; the rest keeps syncing.
    expect(bodyOf(await readRepoFile(fake, '衝突.md'))).toBe('開頭\n\n共同的一行，A 的版本\n\n結尾\n')
    await b.getByRole('button', { name: '處理衝突' }).click()
    const dialog = b.getByRole('dialog')
    await expect(dialog).toContainText('「衝突」在兩台裝置上都被修改了')
    // Both versions are shown, the other side is named from the Device trailer (SYNC-9).
    await expect(dialog).toContainText('B 的版本')
    await expect(dialog).toContainText('A 的版本')
    await expect(dialog).toContainText(await deviceKindOf(a))
    return dialog
  }

  test('兩個都保留: the remote stays, the local version becomes a 「（衝突副本 …）」 sibling', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const d = await secondDevice(browser, fake)
    const dialog = await makeConflict(a, fake, d)
    const before = commitCount(fake)
    await dialog.getByRole('button', { name: '兩個都保留' }).click()
    await expect(d.page.getByRole('dialog')).toHaveCount(0)
    await expect(d.page.locator('.page-banner')).toHaveCount(0)
    await expect.poll(() => commitCount(fake), { timeout: 20_000 }).toBeGreaterThan(before)
    await waitSynced(d.page)

    const copy = pagePaths(fake).find((p) => p.startsWith('衝突（衝突副本 '))
    expect(copy, pagePaths(fake).join()).toMatch(/^衝突（衝突副本 Windows 電腦 · Edge \d\d[:：]\d\d）\.md$/)
    expect(bodyOf(await readRepoFile(fake, '衝突.md'))).toBe('開頭\n\n共同的一行，A 的版本\n\n結尾\n')
    const copyText = (await readRepoFile(fake, copy!))!
    expect(bodyOf(copyText)).toBe('開頭\n\n共同的一行，B 的版本\n\n結尾\n')
    // The copy is a page of its own: new id, same title shown in the tree.
    expect(frontmatterOf(copyText).id).not.toBe(frontmatterOf((await readRepoFile(fake, '衝突.md'))!).id)
    await expect(d.page.locator('.sidebar .tree-title', { hasText: '（衝突副本' })).toBeVisible()
    // Nothing went to the trash, and A sees both pages.
    expect((await trashIndex(fake)).entries).toEqual([])
    await forceSync(a)
    await expect(a.locator('.sidebar .tree-title', { hasText: '（衝突副本' })).toBeVisible()
    await d.context.close()
  })

  test('使用這台裝置的版本: the remote version goes to the trash with reason `replaced`', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const d = await secondDevice(browser, fake)
    const dialog = await makeConflict(a, fake, d)
    await dialog.getByRole('button', { name: '使用這台電腦的版本' }).click()
    await expect(d.page.locator('.page-banner')).toHaveCount(0)
    await expect.poll(async () => bodyOf(await readRepoFile(fake, '衝突.md')), { timeout: 20_000 }).toBe('開頭\n\n共同的一行，B 的版本\n\n結尾\n')
    await waitSynced(d.page)
    const index = await trashIndex(fake)
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]).toMatchObject({ title: '衝突', reason: 'replaced' })
    const trashed = fake.listFiles(REPO).filter((p) => p.startsWith('.notes/trash/') && p.endsWith('.md'))
    expect(trashed).toHaveLength(1)
    expect(await readRepoFile(fake, trashed[0])).toContain('共同的一行，A 的版本')
    expect(pagePaths(fake).filter((p) => p.includes('衝突副本'))).toEqual([])
    // The trash panel shows it as a replaced version.
    await d.page.locator('.sidebar .sb-footer').getByRole('button', { name: '垃圾桶' }).click()
    await expect(d.page.locator('.trash-row', { hasText: '衝突時被取代的版本' })).toBeVisible()
    await d.context.close()
  })

  test('使用 … 的版本: the local version goes to the trash with reason `replaced`', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const d = await secondDevice(browser, fake)
    const dialog = await makeConflict(a, fake, d)
    await dialog.getByRole('button', { name: `使用 ${await deviceKindOf(a)} 的版本`, exact: true }).click()
    await expect(d.page.locator('.page-banner')).toHaveCount(0)
    await expect(editor(d.page)).toContainText('共同的一行，A 的版本')
    await expect.poll(async () => (await trashIndex(fake)).entries.length, { timeout: 20_000 }).toBe(1)
    await waitSynced(d.page)
    expect((await trashIndex(fake)).entries[0]).toMatchObject({ title: '衝突', reason: 'replaced' })
    const trashed = fake.listFiles(REPO).filter((p) => p.startsWith('.notes/trash/') && p.endsWith('.md'))
    expect(await readRepoFile(fake, trashed[0])).toContain('共同的一行，B 的版本')
    expect(bodyOf(await readRepoFile(fake, '衝突.md'))).toBe('開頭\n\n共同的一行，A 的版本\n\n結尾\n')
    await d.context.close()
  })

  test('an edit made on github.com is named 「GitHub 上的版本」', async ({ page: a, fake }) => {
    const setOffline = await offlineSwitch(a.context())
    await setupDevice(a)
    await createPage(a, '網站', '甲\n乙')
    await syncAndWaitForCommit(a, fake)
    await goOffline({ setOffline })
    await appendToParagraph(a, '乙', '（本機）')
    const text = (await readRepoFile(fake, '網站.md'))!
    await fake.commit(REPO, { files: { '網站.md': text.replace('乙', '乙（網站）') } })
    await goOnline({ setOffline })
    await expect(a.locator('.page-banner')).toContainText('這一頁在兩台裝置上都被修改了。')
    await a.getByRole('button', { name: '處理衝突' }).click()
    await expect(a.getByRole('dialog')).toContainText('GitHub 上的版本')
  })

  test('the dialog is the default on Enter, and the page stays read-only until resolved', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const d = await secondDevice(browser, fake)
    const dialog = await makeConflict(a, fake, d)
    await expect(dialog.getByRole('button', { name: '兩個都保留' })).toBeFocused()
    await d.page.keyboard.press('Escape')
    await expect(editor(d.page)).toHaveAttribute('contenteditable', 'false')
    await d.context.close()
  })
})

test.describe('delete against edit', () => {
  test('A deletes, B has unsynced edits: B keeps the page and says so', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const d = await secondDevice(browser, fake)
    const b = d.page
    await sharedPage(a, b, fake, '被刪', '原文')
    await goOffline(d)
    await appendToParagraph(b, '原文', '，B 繼續寫')
    await pageMenu(a, '刪除頁面')
    await forceSync(a)
    expect(pagePaths(fake)).not.toContain('被刪.md')
    await goOnline(d)
    await expect(b.getByText('這一頁在另一台裝置被刪除，但這台裝置有修改，所以保留了。')).toBeVisible()
    await expect.poll(() => readRepoFile(fake, '被刪.md'), { timeout: 20_000 }).toContain('原文，B 繼續寫')
    await waitSynced(b)
    await expect(editor(b)).toContainText('原文，B 繼續寫')
    await d.context.close()
  })

  test('B deletes, A has newer edits: the edited text is put into the trash with the page', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const d = await secondDevice(browser, fake)
    const b = d.page
    await sharedPage(a, b, fake, '先刪', '原文')
    await goOffline(d)
    await openFromSidebar(b, '先刪')
    await pageMenu(b, '刪除頁面')
    await appendToParagraph(a, '原文', '，A 後來寫的')
    await syncAndWaitForCommit(a, fake)
    await goOnline(d)
    await expect(b.getByText('你刪除的頁面在另一台裝置有新的修改，已一起放進垃圾桶。')).toBeVisible()
    await expect.poll(async () => (await trashIndex(fake)).entries.length, { timeout: 20_000 }).toBe(1)
    await waitSynced(b)
    const trashed = fake.listFiles(REPO).filter((p) => p.startsWith('.notes/trash/') && p.endsWith('.md'))
    expect(trashed).toHaveLength(1)
    expect(await readRepoFile(fake, trashed[0])).toContain('原文，A 後來寫的')
    expect(pagePaths(fake)).not.toContain('先刪.md')
    await d.context.close()
  })
})

test.describe('move against edit', () => {
  async function moveInto(page: Page, title: string, parent: string) {
    await openFromSidebar(page, title)
    await pageMenu(page, '移動到…')
    await page.getByRole('dialog').locator('.move-row', { hasText: parent }).click()
    await expect(page.locator('.breadcrumb')).toContainText(parent)
  }

  test('A moves the page, B edits it at the old path: the edit lands in the moved file', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const d = await secondDevice(browser, fake)
    const b = d.page
    await createPage(a, '目的地', '資料夾')
    await sharedPage(a, b, fake, '搬家', '原文')
    await forceSync(b)
    await goOffline(d)
    await appendToParagraph(b, '原文', '，B 在舊位置改的')
    await moveInto(a, '搬家', '目的地')
    await forceSync(a)
    expect(pagePaths(fake)).toContain('目的地/搬家.md')
    await goOnline(d)
    await expect.poll(async () => await readRepoFile(fake, '目的地/搬家.md'), { timeout: 20_000 }).toContain('原文，B 在舊位置改的')
    await waitSynced(b)
    expect(pagePaths(fake)).not.toContain('搬家.md')
    expect(pagePaths(fake).filter((p) => p.includes('搬家'))).toEqual(['目的地/搬家.md'])
    await d.context.close()
  })

  test('B moves the page, A edits it at the old path: the edit is merged into the moved file', async ({ page: a, fake, browser }) => {
    await setupDevice(a)
    const d = await secondDevice(browser, fake)
    const b = d.page
    await createPage(a, '收納', '資料夾')
    await sharedPage(a, b, fake, '被搬', '原文')
    await forceSync(b)
    await goOffline(d)
    await moveInto(b, '被搬', '收納')
    await appendToParagraph(a, '原文', '，A 在舊位置改的')
    await syncAndWaitForCommit(a, fake)
    await goOnline(d)
    await expect.poll(async () => await readRepoFile(fake, '收納/被搬.md'), { timeout: 20_000 }).toContain('原文，A 在舊位置改的')
    await waitSynced(b)
    expect(pagePaths(fake).filter((p) => p.includes('被搬'))).toEqual(['收納/被搬.md'])
    await d.context.close()
  })
})

test('both devices create a page with the same title: the second one is numbered, neither is lost', async ({ page: a, fake, browser }) => {
  await setupDevice(a)
  const d = await secondDevice(browser, fake)
  const b = d.page
  await goOffline(d)
  await createPage(b, '同名', '來自 B')
  await createPage(a, '同名', '來自 A')
  await syncAndWaitForCommit(a, fake)
  expect(await readRepoFile(fake, '同名.md')).toContain('來自 A')
  const before = commitCount(fake)
  await goOnline(d)
  await expect.poll(() => commitCount(fake), { timeout: 20_000 }).toBeGreaterThan(before)
  await waitSynced(b)
  expect(await readRepoFile(fake, '同名.md')).toContain('來自 A')
  expect(await readRepoFile(fake, '同名 (2).md')).toContain('來自 B')
  // Both show the title 同名 in the tree on both devices (DATA-6: the title is unchanged).
  await forceSync(a)
  for (const p of [a, b]) {
    await expect(p.locator('.sidebar .tree-title', { hasText: /^同名$/ })).toHaveCount(2)
  }
  await d.context.close()
  void treeRow
  void titleInput
})

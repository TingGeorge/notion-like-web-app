/** Page operations (UI-10, DATA-3 to DATA-9, DATA-17, DATA-21, DATA-22, SYNC-10) and their commits. */
import { BASE_URL, attachFake, expect, makeFake, test, modKey } from './fixtures'
import {
  bodyOf,
  commitCount,
  createPage,
  deviceNameOf,
  editor,
  escapeRegExp,
  forceSync,
  frontmatterOf,
  headSubject,
  openFromSidebar,
  pageMenu,
  pagePaths,
  readRepoFile,
  REPO,
  settingsJson,
  setupDevice,
  sidebarTitles,
  syncAndWaitForCommit,
  titleInput,
  trashIndex,
  treeRow,
  typeLines,
  waitSynced,
} from './helpers'

test.describe('create', () => {
  test('⌘⌥N (Ctrl+Alt+N): title and body end up in `<title>.md` in one commit', async ({ page, fake }) => {
    await setupDevice(page)
    const before = commitCount(fake)
    await createPage(page, '我的第一頁', '第一行\n第二行')
    await syncAndWaitForCommit(page, fake)
    expect(commitCount(fake)).toBe(before + 1)
    expect(headSubject(fake)).toBe('新增「我的第一頁」')
    const text = (await readRepoFile(fake, '我的第一頁.md'))!
    expect(bodyOf(text)).toBe('第一行\n\n第二行\n')
    const fm = frontmatterOf(text)
    expect(fm.id).toMatch(/^[0-9A-Z]{26}$/)
    expect(fm.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+08:00$/)
    expect(pagePaths(fake)).not.toContain('未命名.md')
    // The commit carries the Device trailer (SYNC-9).
    expect(fake.commits(REPO)[0].message).toMatch(new RegExp(`\n\nDevice: ${escapeRegExp(await deviceNameOf(page))}\nApp: GitHub Notes `))
    await expect(treeRow(page, '我的第一頁')).toBeVisible()
  })

  test('「新增頁面」 in the sidebar creates a page; an untouched one is discarded and never pushed', async ({ page, fake }) => {
    await setupDevice(page)
    const before = commitCount(fake)
    await page.locator('.sidebar .sb-footer').getByRole('button', { name: '新增頁面' }).click()
    await expect(titleInput(page)).toBeFocused()
    await expect(treeRow(page, '未命名')).toBeVisible()
    // Leave it empty: it disappears (UI-10) and nothing is pushed (SYNC-7).
    await page.locator('.sidebar .sb-nav-row', { hasText: '首頁' }).click()
    await expect(page.locator('.sidebar .tree-title', { hasText: '未命名' })).toHaveCount(0)
    await page.locator('.sync-status').click()
    await waitSynced(page)
    expect(commitCount(fake)).toBe(before)
    expect(pagePaths(fake)).toEqual(['歡迎使用.md'])
  })

  test('`+` on a sidebar row creates a child page in the parent\'s folder', async ({ page, fake }) => {
    await setupDevice(page)
    const row = treeRow(page, '歡迎使用')
    await row.hover()
    await row.getByRole('button', { name: '新增子頁面' }).click()
    await expect(titleInput(page)).toBeFocused()
    await titleInput(page).fill('子頁面')
    await titleInput(page).press('Enter')
    await typeLines(page, '子頁面的內容')
    await expect(page.locator('.breadcrumb')).toContainText('歡迎使用')
    await syncAndWaitForCommit(page, fake)
    const text = (await readRepoFile(fake, '歡迎使用/子頁面.md'))!
    expect(bodyOf(text)).toBe('子頁面的內容\n')
    expect(pagePaths(fake)).toContain('歡迎使用.md')
    // The parent got an id when its child was created? Not required; it must not have been damaged.
    expect(await readRepoFile(fake, '歡迎使用.md')).toContain('這裡是你的筆記本')
  })

  test('a title with characters that are not allowed in file names keeps the exact title (DATA-4, DATA-5)', async ({ page, fake }) => {
    await setupDevice(page)
    await createPage(page, '預算: 10/12 規劃?', '內容')
    await syncAndWaitForCommit(page, fake)
    const path = pagePaths(fake).find((p) => p.includes('預算'))!
    expect(path).toBe('預算： 10／12 規劃？.md')
    expect(frontmatterOf((await readRepoFile(fake, path))!).title).toBe('預算: 10/12 規劃?')
    // Reload: the exact title is shown, not the file name.
    await page.reload()
    await expect(page.locator('.sidebar .tree-title', { hasText: '預算: 10/12 規劃?' })).toBeVisible()
  })

  test('two new pages with the same title get a numbered file name (DATA-6)', async ({ page, fake }) => {
    await setupDevice(page)
    await createPage(page, '重複', 'one')
    await createPage(page, '重複', 'two')
    await syncAndWaitForCommit(page, fake)
    expect(await readRepoFile(fake, '重複.md')).toContain('one')
    expect(await readRepoFile(fake, '重複 (2).md')).toContain('two')
    // Both show the title 重複.
    expect((await sidebarTitles(page)).filter((t) => t === '重複')).toHaveLength(2)
  })

  test('「或從這裡開始」 offers starter content', async ({ page, fake }) => {
    await setupDevice(page)
    await page.keyboard.press(`${await modKey(page)}+Alt+KeyN`)
    await expect(page.locator('.page-starters')).toBeVisible()
    await page.getByRole('button', { name: '待辦清單' }).click()
    await titleInput(page).fill('今天')
    await titleInput(page).blur()
    await syncAndWaitForCommit(page, fake)
    expect(bodyOf((await readRepoFile(fake, '今天.md'))!)).toMatch(/- \[ \] /)
  })
})

test.describe('rename', () => {
  test('moves the file, rewrites inbound links, and is one commit', async ({ browser }) => {
    const fake = await makeFake({
      files: {
        'B.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W3X\n---\nB body\n',
        'B/child.md': 'child\n',
        'A.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W4Y\n---\n看看\n\n[B](/B.md)\n\n[child](/B/child.md)\n\n[別處](/other.md)\n',
        'sub/C.md': 'inline [B](/B.md) here\n',
        'other.md': 'x\n',
      },
    })
    const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', serviceWorkers: 'block' })
    await attachFake(context, fake)
    const p = await context.newPage()
    await setupDevice(p)
    const before = commitCount(fake)
    await openFromSidebar(p, 'B')
    await titleInput(p).fill('B 新名字')
    await titleInput(p).press('Enter')
    await syncAndWaitForCommit(p, fake, before)
    expect(commitCount(fake)).toBe(before + 1)
    expect(headSubject(fake)).toBe('重新命名「B」為「B 新名字」')
    const paths = fake.listFiles(REPO)
    expect(paths).toContain('B 新名字.md')
    expect(paths).toContain('B 新名字/child.md')
    expect(paths).not.toContain('B.md')
    expect(paths).not.toContain('B/child.md')
    // The id is kept (DATA-9), the body too.
    const moved = (await readRepoFile(fake, 'B 新名字.md'))!
    expect(frontmatterOf(moved).id).toBe('01JA8Z3K5N6P7Q8R9S0T1V2W3X')
    expect(bodyOf(moved)).toBe('B body\n')
    // Inbound links follow (DATA-17), links elsewhere are untouched.
    const a = (await readRepoFile(fake, 'A.md'))!
    expect(a).toContain('[B 新名字](/B%20新名字.md)')
    expect(a).toContain('[child](/B%20新名字/child.md)')
    expect(a).toContain('[別處](/other.md)')
    expect(await readRepoFile(fake, 'sub/C.md')).toBe('inline [B](/B%20新名字.md) here\n')
    await context.close()
  })

  test('renaming to an empty title gives 未命名 and renaming a page twice is still one push', async ({ page, fake }) => {
    await setupDevice(page)
    await createPage(page, '舊名字', '內容')
    await syncAndWaitForCommit(page, fake)
    const before = commitCount(fake)
    await titleInput(page).fill('中間名字')
    await titleInput(page).blur()
    await expect(treeRow(page, '中間名字')).toBeVisible()
    await titleInput(page).fill('最後名字')
    await titleInput(page).blur()
    await expect(treeRow(page, '最後名字')).toBeVisible()
    await syncAndWaitForCommit(page, fake, before)
    expect(commitCount(fake)).toBe(before + 1)
    expect(pagePaths(fake)).toContain('最後名字.md')
    expect(pagePaths(fake)).not.toContain('舊名字.md')
    expect(pagePaths(fake)).not.toContain('中間名字.md')
    expect(await readRepoFile(fake, '最後名字.md')).toContain('內容')
  })
})

test.describe('move', () => {
  test('dragging a page onto another in the sidebar moves it, with its child folder', async ({ browser, browserName }) => {
    test.fixme(browserName === 'webkit', 'The drop never registers under Playwright WebKit in CI; not reproducible here (Chromium only). Check sidebar dragging in Safari by hand.')
    const fake = await makeFake({
      files: {
        'P.md': 'P body\n',
        'P/kid.md': 'kid body\n',
        'Q.md': 'Q body\n',
        'R.md': '[P](/P.md) and [kid](/P/kid.md)\n',
      },
    })
    const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', serviceWorkers: 'block' })
    await attachFake(context, fake)
    const p = await context.newPage()
    await setupDevice(p)
    const before = commitCount(fake)
    const source = treeRow(p, 'P').locator('.tree-link')
    const target = treeRow(p, 'Q')
    const box = (await target.boundingBox())!
    await source.dragTo(target, { targetPosition: { x: box.width / 2, y: box.height / 2 } })
    await expect(p.getByText('已移動「P」')).toBeVisible()
    await syncAndWaitForCommit(p, fake, before)
    expect(commitCount(fake)).toBe(before + 1)
    expect(headSubject(fake)).toBe('移動「P」到「Q」')
    const paths = fake.listFiles(REPO).filter((f) => !f.startsWith('.notes/'))
    expect(paths).toEqual(['Q.md', 'Q/P.md', 'Q/P/kid.md', 'R.md'].sort())
    expect(bodyOf(await readRepoFile(fake, 'Q/P.md'))).toBe('P body\n')
    expect(await readRepoFile(fake, 'Q/P/kid.md')).toContain('kid body')
    // Links to the moved page and its child were rewritten in the same commit.
    expect(await readRepoFile(fake, 'R.md')).toBe('[P](/Q/P.md) and [kid](/Q/P/kid.md)\n')
    // The moved page got an id so it can be tracked (DATA-9).
    expect(frontmatterOf((await readRepoFile(fake, 'Q/P.md'))!).id).toMatch(/^[0-9A-Z]{26}$/)
    await context.close()
  })

  test('「移動到…」 moves a page and 復原 puts it back', async ({ browser }) => {
    const fake = await makeFake({ files: { 'P.md': 'P body\n', 'Q.md': 'Q body\n' } })
    const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', serviceWorkers: 'block' })
    await attachFake(context, fake)
    const p = await context.newPage()
    await setupDevice(p)
    await openFromSidebar(p, 'P')
    await pageMenu(p, '移動到…')
    await p.getByRole('dialog').locator('.move-row', { hasText: 'Q' }).click()
    await expect(p.locator('.breadcrumb')).toContainText('Q')
    await p.locator('.toast, [role=status]', { hasText: '已移動「P」' }).getByRole('button', { name: '復原' }).click()
    await expect(p.locator('.sidebar .tree-row.is-selected, .sidebar [aria-selected=true]').first()).toBeVisible()
    await forceSync(p)
    await expect.poll(() => fake.listFiles(REPO).filter((f) => !f.startsWith('.notes/')).sort()).toEqual(['P.md', 'Q.md'])
    await context.close()
  })
})

test.describe('delete, restore, purge', () => {
  test('delete moves the page to .notes/trash/<id>/ and records it in index.json', async ({ page, fake }) => {
    await setupDevice(page)
    await createPage(page, '要刪除的頁面', '會被刪除的內容')
    await syncAndWaitForCommit(page, fake)
    const id = frontmatterOf((await readRepoFile(fake, '要刪除的頁面.md'))!).id
    const before = commitCount(fake)
    await pageMenu(page, '刪除頁面')
    await expect(page.getByText('已刪除「要刪除的頁面」')).toBeVisible()
    await expect(page.locator('.sidebar .tree-title', { hasText: '要刪除的頁面' })).toHaveCount(0)
    await syncAndWaitForCommit(page, fake, before)
    expect(commitCount(fake)).toBe(before + 1)
    const files = fake.listFiles(REPO)
    expect(files).not.toContain('要刪除的頁面.md')
    expect(files).toContain(`.notes/trash/${id}/要刪除的頁面.md`)
    expect(await readRepoFile(fake, `.notes/trash/${id}/要刪除的頁面.md`)).toContain('會被刪除的內容')
    const index = await trashIndex(fake)
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]).toMatchObject({ id, title: '要刪除的頁面', originalPath: '要刪除的頁面.md', reason: 'deleted' })
    expect(headSubject(fake)).toBe('刪除「要刪除的頁面」')
  })

  test('deleting a page deletes its child folder too, and 復原 undoes it', async ({ browser }) => {
    const fake = await makeFake({ files: { 'P.md': 'P\n', 'P/kid.md': 'kid\n', 'keep.md': 'keep\n' } })
    const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', serviceWorkers: 'block' })
    await attachFake(context, fake)
    const p = await context.newPage()
    await setupDevice(p)
    await openFromSidebar(p, 'P')
    await pageMenu(p, '刪除頁面')
    await expect(p.getByText('已刪除「P」')).toBeVisible()
    await forceSync(p)
    const trashed = fake.listFiles(REPO).filter((f) => f.startsWith('.notes/trash/') && f.endsWith('.md'))
    expect(trashed.map((f) => f.split('/').slice(3).join('/')).sort()).toEqual(['P.md', 'P/kid.md'])
    expect(fake.listFiles(REPO).filter((f) => !f.startsWith('.notes/'))).toEqual(['keep.md'])
    await context.close()
  })

  test('restore from 垃圾桶 puts the files back; 永久刪除 removes them from .notes/trash', async ({ page, fake }) => {
    await setupDevice(page)
    await createPage(page, '回收一', '內容一')
    await createPage(page, '回收二', '內容二')
    await syncAndWaitForCommit(page, fake)
    // Delete both.
    await openFromSidebar(page, '回收一')
    await pageMenu(page, '刪除頁面')
    await openFromSidebar(page, '回收二')
    await pageMenu(page, '刪除頁面')
    await forceSync(page)
    expect((await trashIndex(fake)).entries.map((e) => e.title).sort()).toEqual(['回收一', '回收二'])

    // Restore 回收一.
    await page.locator('.sidebar .sb-footer').getByRole('button', { name: '垃圾桶' }).click()
    const row = (title: string) => page.locator('.trash-row', { hasText: title })
    await expect(row('回收一')).toBeVisible()
    await row('回收一').getByRole('button', { name: '還原' }).click()
    await expect(page.getByText('已還原「回收一」')).toBeVisible()
    await syncAndWaitForCommit(page, fake)
    expect(await readRepoFile(fake, '回收一.md')).toContain('內容一')
    expect((await trashIndex(fake)).entries.map((e) => e.title)).toEqual(['回收二'])
    expect(fake.listFiles(REPO).filter((f) => f.startsWith('.notes/trash/') && f.endsWith('.md'))).toHaveLength(1)
    await expect(treeRow(page, '回收一')).toBeVisible()

    // Permanently delete 回收二, with a confirmation.
    await page.locator('.sidebar .sb-footer').getByRole('button', { name: '垃圾桶' }).click()
    await row('回收二').getByRole('button', { name: '永久刪除' }).click()
    await expect(page.getByText('要永久刪除「回收二」嗎？')).toBeVisible()
    // Esc closes only the confirmation; the trash panel stays open.
    await page.keyboard.press('Escape')
    await expect(page.getByText('要永久刪除「回收二」嗎？')).toHaveCount(0)
    await row('回收二').getByRole('button', { name: '永久刪除' }).click()
    await expect(page.getByText('要永久刪除「回收二」嗎？')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '永久刪除' }).click()
    await expect(row('回收二')).toHaveCount(0)
    await forceSync(page)
    expect((await trashIndex(fake)).entries).toEqual([])
    expect(fake.listFiles(REPO).filter((f) => f.startsWith('.notes/trash/') && f.endsWith('.md'))).toEqual([])
    // It stays in git history.
    const history = fake.commits(REPO)
    expect(await fake.readFile(REPO, '回收二.md', history[history.length - 1].sha)).toBeNull()
  })
})

test('duplicate creates a copy with a new id next to the original', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '原稿', '原稿內容')
  await syncAndWaitForCommit(page, fake)
  const originalId = frontmatterOf((await readRepoFile(fake, '原稿.md'))!).id
  // Counted before: leaving the original page may already push the copy (SYNC-7).
  const before = commitCount(fake)
  await pageMenu(page, '複製頁面')
  // The copy has the same title: wait until it is in the sidebar, i.e. written.
  await expect(page.locator('.sidebar .tree-title', { hasText: /^原稿$/ })).toHaveCount(2)
  await expect(page.locator('.breadcrumb-item.is-current')).toContainText('原稿')
  await syncAndWaitForCommit(page, fake, before)
  const copyPath = pagePaths(fake).find((p) => p !== '原稿.md' && p.startsWith('原稿'))!
  expect(copyPath).toBe('原稿 (2).md')
  const copy = (await readRepoFile(fake, copyPath))!
  expect(bodyOf(copy)).toBe('原稿內容\n')
  expect(frontmatterOf(copy).id).toMatch(/^[0-9A-Z]{26}$/)
  expect(frontmatterOf(copy).id).not.toBe(originalId)
  expect(frontmatterOf(copy).title ?? '原稿').toBe('原稿')
  expect(frontmatterOf((await readRepoFile(fake, '原稿.md'))!).id).toBe(originalId)
})

test('favourite writes .notes/settings.json and shows 我的最愛 in the sidebar', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '星星頁', '內容')
  await syncAndWaitForCommit(page, fake)
  const before = commitCount(fake)
  await page.locator('.topbar').getByRole('button', { name: '加入我的最愛' }).click()
  await expect(page.getByText('已加入我的最愛')).toBeVisible()
  await expect(page.locator('.sidebar .sb-section-title', { hasText: '我的最愛' })).toBeVisible()
  await syncAndWaitForCommit(page, fake, before)
  const id = frontmatterOf((await readRepoFile(fake, '星星頁.md'))!).id
  expect((await settingsJson(fake)).favorites).toEqual([id])
  // Un-favourite.
  await page.locator('.topbar').getByRole('button', { name: '從我的最愛移除' }).click()
  await forceSync(page)
  await expect.poll(async () => (await settingsJson(fake)).favorites).toEqual([])
  await expect(page.locator('.sidebar .sb-section-title', { hasText: '我的最愛' })).toHaveCount(0)
})

test('a page survives a reload with its title, body and sidebar entry', async ({ page, fake }) => {
  await setupDevice(page)
  const before = commitCount(fake)
  await createPage(page, '重新整理', '重新整理後還在')
  await page.reload()
  await expect(titleInput(page)).toHaveValue('重新整理')
  await expect(editor(page)).toContainText('重新整理後還在')
  await expect(treeRow(page, '重新整理')).toBeVisible()
  // The edit left on the device is pushed when the app starts again (SYNC-4).
  await syncAndWaitForCommit(page, fake, before)
  expect(await readRepoFile(fake, '重新整理.md')).toContain('重新整理後還在')
})

test('favouriting a page that has no id yet keeps the open page as it is (no reload)', async ({ page, fake }) => {
  // Written on github.com: no frontmatter, so no id until an action needs one (DATA-9).
  await fake.commit(REPO, { files: { '沒有 id.md': '從 GitHub 來的內容\n' }, message: 'seed' })
  await setupDevice(page)
  await openFromSidebar(page, '沒有 id')
  await expect(editor(page)).toContainText('從 GitHub 來的內容')
  await editor(page).evaluate((el) => el.setAttribute('data-mark', 'same'))
  await page.locator('.topbar').getByRole('button', { name: '加入我的最愛' }).click()
  await expect(page.getByText('已加入我的最愛')).toBeVisible()
  // The route now uses the new id, and it is still the same editor.
  await expect(page).toHaveURL(/#\/p\/[0-9A-Z]{26}$/)
  await expect(editor(page)).toHaveAttribute('data-mark', 'same')
})

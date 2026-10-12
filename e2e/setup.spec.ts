/** SETUP-1 to SETUP-10: first-run setup against an empty repo, an existing repo, bad tokens and a public repo. */
import { BASE_URL, attachFake, expect, makeFake, test } from './fixtures'
import { chooseRepo, connectToken, LOGIN, pagePaths, readRepoFile, REPO, setupDevice, sidebarTitles, TOKEN, treeRow, waitSynced } from './helpers'

test('an empty repo gets 歡迎使用.md, which is shown', async ({ page, fake }) => {
  await setupDevice(page)
  // Exactly one commit was added: the welcome page (SETUP-9).
  const commits = fake.commits(REPO)
  expect(commits).toHaveLength(1)
  const welcome = await readRepoFile(fake, '歡迎使用.md')
  expect(welcome).toContain('這裡是你的筆記本')
  await expect(page.locator('.sidebar .tree-title', { hasText: '歡迎使用' })).toBeVisible()
  // The home screen greets the user and lists the page.
  await expect(page.locator('.home-greeting')).toContainText('Ting')
  await page.locator('.sidebar .tree-link', { hasText: '歡迎使用' }).click()
  await expect(page.locator('.page-title-input')).toHaveValue('歡迎使用')
  await expect(page.locator('.ProseMirror')).toContainText('這裡是你的筆記本')
})

test('an existing repo: Markdown files and folders become pages and virtual folder pages', async ({ browser }) => {
  const fake = await makeFake({
    files: {
      'README.md': '# Hello\n\nA readme.\n',
      '工作.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W3X\n---\n工作首頁\n',
      '工作/會議記錄.md': '# 會議\n\n討論事項\n',
      'docs/guide.md': 'Guide text\n',
      'docs/deep/page.md': 'Deep\n',
      'notes.txt': 'not a page',
      '_assets/2026/10/ab12cd34.png': 'binary',
      '.github/workflows/x.md': 'hidden',
    },
  })
  const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', serviceWorkers: 'block' })
  await attachFake(context, fake)
  const p = await context.newPage()
  await setupDevice(p)
  // The repo list said how many Markdown files there are.
  const titles = await sidebarTitles(p)
  expect(titles).toEqual(expect.arrayContaining(['README', '工作', 'docs']))
  expect(titles).not.toContain('notes')
  // Nothing was written to an existing repo, and no frontmatter was added (DATA-9).
  expect(fake.commits(REPO)).toHaveLength(1)
  expect(await readRepoFile(fake, 'README.md')).toBe('# Hello\n\nA readme.\n')

  // `工作` has a child page; the virtual page `docs` has one too.
  await treeRow(p, '工作').getByRole('button', { name: '展開' }).click()
  await expect(p.locator('.sidebar .tree-title', { hasText: '會議記錄' })).toBeVisible()
  await treeRow(p, 'docs').getByRole('button', { name: '展開' }).click()
  await expect(p.locator('.sidebar .tree-title', { hasText: 'guide' })).toBeVisible()

  // Opening a virtual page shows the hint and creates no file (DATA-3).
  await p.locator('.sidebar .tree-link', { hasText: /^docs$/ }).click()
  await expect(p.locator('.page-virtual-hint')).toBeVisible()
  await waitSynced(p)
  expect(fake.commits(REPO)).toHaveLength(1)
  expect(pagePaths(fake)).not.toContain('docs.md')

  // Typing in it creates `docs.md`.
  await p.locator('.ProseMirror').click()
  await p.keyboard.type('資料夾的內容')
  await p.locator('.sync-status').click()
  await expect.poll(() => readRepoFile(fake, 'docs.md')).toContain('資料夾的內容')
  expect(await readRepoFile(fake, 'docs/guide.md')).toBe('Guide text\n')
  await context.close()
})

test('a read-only token is refused with the write-access error', async ({ page, fake }) => {
  fake.addToken('github_pat_readonlytoken_0123456789abcdefghijklmnopqrstuvwxyz', { login: LOGIN, permission: 'read' })
  // A repo that already has commits: the write probe decides, not the permissions field.
  await fake.commit(REPO, { files: { 'a.md': 'a\n' } })
  await connectToken(page, { token: 'github_pat_readonlytoken_0123456789abcdefghijklmnopqrstuvwxyz' })
  await chooseRepo(page)
  await expect(page.getByText('這把 token 沒有這個 repo 的寫入權限（Contents: Read and write）')).toBeVisible()
  // The user stays on the repo list and nothing was written.
  await expect(page.getByRole('button', { name: '使用這個 repo' })).toBeVisible()
  expect(fake.commits(REPO)).toHaveLength(1)
})

test('a read-only token on an empty repo is refused too', async ({ page, fake }) => {
  fake.addToken('github_pat_readonlytoken_0123456789abcdefghijklmnopqrstuvwxyz', { login: LOGIN, permission: 'read' })
  await connectToken(page, { token: 'github_pat_readonlytoken_0123456789abcdefghijklmnopqrstuvwxyz' })
  await chooseRepo(page)
  await expect(page.getByText('這把 token 沒有這個 repo 的寫入權限')).toBeVisible()
  expect(fake.commits(REPO)).toHaveLength(0)
})

test('a public repo needs a confirmation', async ({ browser }) => {
  const fake = await makeFake({ files: { 'a.md': 'a\n' } })
  fake.updateRepo(REPO, { private: false })
  const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', serviceWorkers: 'block' })
  await attachFake(context, fake)
  const p = await context.newPage()
  await connectToken(p)
  await expect(p.getByRole('radio', { name: new RegExp(REPO) })).toContainText('Public')
  await chooseRepo(p)
  const dialog = p.getByRole('dialog')
  await expect(dialog).toContainText('公開的 repo 任何人都看得到你的筆記')
  // Cancel keeps us on the list.
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(p.getByRole('button', { name: '使用這個 repo' })).toBeVisible()
  expect(fake.count('POST', `/repos/${REPO}/git/blobs`)).toBe(0)
  // Confirm continues.
  await p.getByRole('button', { name: '使用這個 repo' }).click()
  await p.getByRole('dialog').getByRole('button', { name: '仍要使用' }).click()
  await p.getByRole('button', { name: '開始使用' }).click({ timeout: 30_000 })
  await expect(p.locator('.sidebar')).toBeVisible()
  await context.close()
})

test('a token in the wrong format is rejected inline, without calling GitHub', async ({ page, fake }) => {
  await page.goto('./')
  await page.getByRole('button', { name: '開始設定' }).click()
  await page.getByLabel('GitHub token').fill('not-a-token')
  await page.getByLabel('GitHub token').blur()
  await expect(page.getByText('這看起來不是 GitHub token')).toBeVisible()
  await expect(page.getByRole('button', { name: '連結', exact: true })).toBeDisabled()
  expect(fake.requests).toHaveLength(0)
})

test('a token GitHub answers 401 to shows 「token 無效或已過期」', async ({ page, fake }) => {
  await connectToken(page, { token: 'github_pat_unknowntoken_0123456789abcdefghijklmnopqrstuvwxyzABCDE' })
  await expect(page.getByText('token 無效或已過期')).toBeVisible()
  await expect(page.getByRole('button', { name: '連結', exact: true })).toBeVisible()
  expect(fake.commits(REPO)).toHaveLength(0)
})

test('a classic token is accepted only after a warning', async ({ page, fake }) => {
  fake.addToken('ghp_classictoken0123456789abcdefghijklmnopqrstu', { login: LOGIN })
  await connectToken(page, { token: 'ghp_classictoken0123456789abcdefghijklmnopqrstu' })
  await expect(page.getByText('它可以存取你所有的 repo')).toBeVisible()
  await page.getByRole('button', { name: '仍要使用' }).click()
  await expect(page.getByRole('radio', { name: new RegExp(REPO) })).toBeVisible()
})

test('setup is required: the main UI is not reachable without a workspace', async ({ page }) => {
  await page.goto('./#/p/whatever')
  await expect(page.getByRole('button', { name: '開始設定' })).toBeVisible()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  expect(TOKEN).toBeTruthy()
})

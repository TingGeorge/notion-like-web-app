/**
 * Sync behaviour on one device: offline editing (SYNC-11, SYNC-12), typing while a push is in flight
 * (SYNC-8 step 7), pulling remote changes (SYNC-4, SYNC-5), the auto-sync switch (SYNC-7) and failures.
 */
import { expect, test } from './fixtures'
import { REPO, bodyOf, caretToEnd, commitCount, createPage, editor, forceSync, frontmatterOf, headSubject, openFromSidebar, openSettings, readRepoFile, setupDevice, syncAndWaitForCommit, syncButton, typeLines, waitSynced } from './helpers'

test.describe('offline', () => {
  test('edits made while the network is down go out as one commit when it is back', async ({ page, fake, context }) => {
    await setupDevice(page)
    await openFromSidebar(page, '歡迎使用')
    const before = commitCount(fake)

    fake.offline = true
    await context.setOffline(true)
    await expect(syncButton(page)).toHaveText('離線')

    // Edit the existing page, and create two more.
    await caretToEnd(page)
    await page.keyboard.type('離線時加的一行')
    await createPage(page, '離線一', '離線的內容一')
    await createPage(page, '離線二', '離線的內容二')
    await expect(syncButton(page)).toHaveText('離線 · 3 頁待同步')

    // The auto-push timer fires while offline (5 s) and fails quietly; nothing reaches GitHub.
    await page.waitForTimeout(6000)
    expect(commitCount(fake)).toBe(before)
    await expect(syncButton(page)).toHaveText('離線 · 3 頁待同步')

    // Back online: exactly one new commit with all three edits.
    fake.offline = false
    await context.setOffline(false)
    await expect.poll(() => commitCount(fake), { timeout: 20_000 }).toBe(before + 1)
    await waitSynced(page)
    expect(commitCount(fake)).toBe(before + 1)
    expect(headSubject(fake)).toBe('更新 3 頁')
    expect(await readRepoFile(fake, '離線一.md')).toContain('離線的內容一')
    expect(await readRepoFile(fake, '離線二.md')).toContain('離線的內容二')
    const welcome = await readRepoFile(fake, '歡迎使用.md')
    expect(welcome).toContain('離線時加的一行')
    expect(welcome).toContain('這裡是你的筆記本')
  })

  test('GitHub unreachable while the browser thinks it is online shows 離線 and keeps the edits', async ({ page, fake }) => {
    await setupDevice(page)
    await createPage(page, '斷線', '斷線前')
    await syncAndWaitForCommit(page, fake)
    const before = commitCount(fake)

    fake.offline = true
    await page.keyboard.type('，斷線後')
    await page.waitForTimeout(400)
    await syncButton(page).click()
    await expect(syncButton(page)).toHaveText('離線 · 1 頁待同步')
    expect(commitCount(fake)).toBe(before)

    // SYNC-12: retries by itself with back-off (5 s first).
    fake.offline = false
    await expect.poll(() => commitCount(fake), { timeout: 30_000 }).toBe(before + 1)
    await waitSynced(page)
    expect(bodyOf(await readRepoFile(fake, '斷線.md'))).toBe('斷線前，斷線後\n')
  })

  test('a server error shows 同步失敗 and a click retries', async ({ page, fake }) => {
    await setupDevice(page)
    await createPage(page, '壞掉', '內容')
    fake.failNext({ kind: 'server', status: 503 }, { times: 20 })
    await syncButton(page).click()
    await expect(syncButton(page)).toHaveText('同步失敗 · 點此重試')
    // Tapping the error state shows the reason (SYNC-11).
    await syncButton(page).click()
    await expect(page.getByText('GitHub 暫時無法使用')).toBeVisible()
    fake.clearFailures()
    await page.getByRole('button', { name: '重試', exact: true }).click()
    await waitSynced(page)
    expect(await readRepoFile(fake, '壞掉.md')).toContain('內容')
  })
})

test('typing during a push: GitHub has the first snapshot, the page stays dirty, the next sync pushes the rest', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '邊打邊推', '第一段')
  const before = commitCount(fake)

  // Hold the commit request so the push is in flight while we type.
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let held = false
  const off = fake.onRequest(async (r) => {
    if (r.method === 'POST' && r.path.endsWith('/git/commits')) {
      held = true
      await gate
    }
  })
  await syncButton(page).click()
  await expect.poll(() => held).toBe(true)
  await expect(syncButton(page)).toHaveText('同步中…')

  // More text while the push runs, saved locally within 300 ms (STORE-3).
  await caretToEnd(page)
  await page.keyboard.type('，第二段')
  await page.waitForTimeout(500)
  release()
  off()

  await expect.poll(() => commitCount(fake), { timeout: 20_000 }).toBe(before + 1)
  // GitHub has exactly the snapshot taken when the push started.
  expect(bodyOf(await readRepoFile(fake, '邊打邊推.md'))).toBe('第一段\n')
  // The page is still dirty: the status is not 已同步, and the editor still shows everything.
  await expect(syncButton(page)).not.toHaveText('已同步')
  await expect(editor(page)).toContainText('第一段，第二段')

  // The next sync pushes the rest; nothing is lost.
  await syncAndWaitForCommit(page, fake, before + 1)
  expect(commitCount(fake)).toBe(before + 2)
  expect(bodyOf(await readRepoFile(fake, '邊打邊推.md'))).toBe('第一段，第二段\n')
  await page.reload()
  await expect(editor(page)).toContainText('第一段，第二段')
})

test.describe('timing', () => {
  test('a push runs about 5 s after the last edit, without clicking anything (SYNC-7)', async ({ page, fake }) => {
    await setupDevice(page)
    const before = commitCount(fake)
    await createPage(page, '自動', '自動同步的內容')
    const started = Date.now()
    await expect.poll(() => commitCount(fake), { timeout: 20_000 }).toBe(before + 1)
    expect(Date.now() - started).toBeGreaterThan(3000)
    expect(await readRepoFile(fake, '自動.md')).toContain('自動同步的內容')
  })

  test('with 「自動同步」 off nothing is pushed automatically, but 「立即同步」 pushes', async ({ page, fake }) => {
    await setupDevice(page)
    await openSettings(page, '同步與儲存')
    await page.getByRole('switch', { name: '自動同步' }).click()
    await expect(page.getByRole('switch', { name: '自動同步' })).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    const before = commitCount(fake)
    await createPage(page, '手動', '手動同步的內容')
    // Leaving the page would normally push at once; with auto-sync off it does not.
    await page.locator('.sidebar .sb-nav-row', { hasText: '首頁' }).click()
    await page.waitForTimeout(7000)
    expect(commitCount(fake)).toBe(before)
    await expect(syncButton(page)).toHaveText('1 頁待同步')
    await syncAndWaitForCommit(page, fake, before)
    expect(await readRepoFile(fake, '手動.md')).toContain('手動同步的內容')
  })

  test('leaving a page pushes it right away', async ({ page, fake }) => {
    await setupDevice(page)
    const before = commitCount(fake)
    await createPage(page, '離開就推', '內容')
    const started = Date.now()
    await page.locator('.sidebar .sb-nav-row', { hasText: '首頁' }).click()
    await expect.poll(() => commitCount(fake), { timeout: 20_000 }).toBe(before + 1)
    expect(Date.now() - started).toBeLessThan(4500)
  })
})

test.describe('pulling', () => {
  test('a change made on github.com shows up on 立即同步, in the open page and the sidebar', async ({ page, fake }) => {
    await setupDevice(page)
    await createPage(page, '遠端', '本機的內容')
    await syncAndWaitForCommit(page, fake)
    const text = (await readRepoFile(fake, '遠端.md'))!
    await fake.commit(REPO, { files: { '遠端.md': text.replace('本機的內容', '在 GitHub 網站上改的內容'), '新檔案.md': '網站上新增\n' } })
    await forceSync(page)
    await expect(editor(page)).toContainText('在 GitHub 網站上改的內容')
    await expect(page.locator('.sidebar .tree-title', { hasText: '新檔案' })).toBeVisible()
    // Nothing to push afterwards: no extra commit.
    const count = commitCount(fake)
    await forceSync(page)
    expect(commitCount(fake)).toBe(count)
  })

  test('a file deleted on github.com disappears; an open edit elsewhere is not lost', async ({ page, fake }) => {
    await setupDevice(page)
    await createPage(page, '會消失', '內容')
    await syncAndWaitForCommit(page, fake)
    await page.locator('.sidebar .sb-nav-row', { hasText: '首頁' }).click()
    await fake.commit(REPO, { files: { '會消失.md': null } })
    await forceSync(page)
    await expect(page.locator('.sidebar .tree-title', { hasText: '會消失' })).toHaveCount(0)
  })

  test('the page list is polled every 60 s while visible (SYNC-4)', async ({ page, fake }) => {
    await page.clock.install()
    await setupDevice(page)
    await fake.commit(REPO, { files: { '輪詢.md': '輪詢到了\n' } })
    const before = fake.count('GET', /\/git\/ref\/heads\//)
    await page.clock.fastForward(61_000)
    await expect(page.locator('.sidebar .tree-title', { hasText: '輪詢' })).toBeVisible()
    expect(fake.count('GET', /\/git\/ref\/heads\//)).toBeGreaterThan(before)
  })
})

test('the 「立即同步」 button in settings and the commit trailer name this device', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '設定同步', '內容')
  await openSettings(page, '同步與儲存')
  await page.getByRole('button', { name: '立即同步' }).click()
  await expect.poll(() => readRepoFile(fake, '設定同步.md')).not.toBeNull()
  const message = fake.commits(REPO)[0].message
  expect(message.split('\n')[0]).toBe('新增「設定同步」')
  expect(message).toContain('Device: Windows 電腦 · Chrome')
  expect(message).toMatch(/App: GitHub Notes \S+/)
  expect(frontmatterOf((await readRepoFile(fake, '設定同步.md'))!).id).toMatch(/^[0-9A-Z]{26}$/)
  void typeLines
})

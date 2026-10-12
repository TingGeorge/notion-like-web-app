/** Token expiry and revocation (SETUP-11, SETUP-13). */
import { expect, LOGIN, test, TOKEN } from './fixtures'
import { bodyOf, caretToEnd, commitCount, createPage, editor, readRepoFile, setupDevice, syncAndWaitForCommit, syncButton, titleInput, waitSynced } from './helpers'

const NEW_TOKEN = 'github_pat_11NEWTOKEN0_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'

/** `YYYY-MM-DD` of today + `days` in the browser's time zone (Asia/Taipei). */
function inDays(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(Date.now() + days * 86_400_000))
}

test('an expiry within 14 days shows 「token 將在 N 天後到期」 with 更換 token', async ({ page }) => {
  await setupDevice(page, { expiresOn: inDays(10) })
  const banner = page.locator('.banner.is-warning')
  await expect(banner).toContainText(/token 將在 (9|10|11) 天後到期/)
  await banner.getByRole('button', { name: '更換 token' }).click()
  await expect(page.getByRole('dialog')).toContainText('GitHub 連結')
})

test('a token that expires later shows no banner; the date is shown in settings', async ({ page }) => {
  await setupDevice(page, { expiresOn: inDays(60) })
  await expect(page.locator('.banner')).toHaveCount(0)
})

test('a revoked token makes the app read-only; edits stay; 更換 token pushes them', async ({ page, fake }) => {
  fake.addToken(NEW_TOKEN, { login: LOGIN })
  await setupDevice(page)
  await createPage(page, '會被撤銷', '撤銷前')
  await syncAndWaitForCommit(page, fake)
  const before = commitCount(fake)

  // The token is revoked on github.com; the user keeps typing.
  fake.revokeToken(TOKEN)
  await caretToEnd(page)
  await page.keyboard.type('，撤銷後還是打了字')
  await page.waitForTimeout(400)
  await syncButton(page).click()

  const banner = page.locator('.banner.is-danger')
  await expect(banner).toContainText('token 無效或已過期，現在只能閱讀。你的修改會先保留在這台裝置上。')
  // Read-only: the editor and the title no longer take input.
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false')
  await expect(titleInput(page)).toHaveAttribute('readonly', '')
  expect(commitCount(fake)).toBe(before)
  await expect(syncButton(page)).toHaveText('同步失敗 · 點此重試')
  // The edit is kept on this device across a reload.
  await page.reload()
  await expect(editor(page)).toContainText('撤銷前，撤銷後還是打了字')
  await expect(page.locator('.banner.is-danger')).toBeVisible()
  expect(commitCount(fake)).toBe(before)

  // 更換 token with the new one.
  const auths: string[] = []
  fake.onRequest((r) => {
    auths.push(r.headers.get('authorization') ?? '')
  })
  await page.locator('.banner.is-danger').getByRole('button', { name: '更換 token' }).click()
  await page.getByRole('button', { name: '更換 token' }).last().click()
  const dialog = page.getByRole('dialog', { name: '更換 token' })
  // A token GitHub does not know is refused.
  await dialog.getByLabel('GitHub token').fill('github_pat_unknowntoken_0123456789abcdefghijklmnopqrstuvwxyzABCDE')
  await dialog.getByRole('button', { name: '更換 token' }).click()
  await expect(dialog.getByText('token 無效或已過期')).toBeVisible()
  // A token in the wrong format too.
  await dialog.getByLabel('GitHub token').fill('nope')
  await dialog.getByRole('button', { name: '更換 token' }).click()
  await expect(dialog.getByText('這看起來不是 GitHub token')).toBeVisible()
  // The right one: the banner goes, the edit is pushed.
  auths.length = 0
  await dialog.getByLabel('GitHub token').fill(NEW_TOKEN)
  await dialog.getByRole('button', { name: '更換 token' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => commitCount(fake), { timeout: 20_000 }).toBe(before + 1)
  expect(bodyOf(await readRepoFile(fake, '會被撤銷.md'))).toBe('撤銷前，撤銷後還是打了字\n')
  await expect(page.locator('.banner.is-danger')).toHaveCount(0)
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true')
  await waitSynced(page)
  // The new token is the one used from now on.
  expect(auths.at(-1)).toBe(`Bearer ${NEW_TOKEN}`)
  expect(auths.slice(auths.indexOf(`Bearer ${NEW_TOKEN}`)).every((a) => a === `Bearer ${NEW_TOKEN}`)).toBe(true)
})

test('a replacement token without write access is refused', async ({ page, fake }) => {
  const readOnly = 'github_pat_11READONLY0_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'
  fake.addToken(readOnly, { login: LOGIN, permission: 'read' })
  await fake.commit('TingGeorge/notes', { files: { 'x.md': 'x\n' } })
  await setupDevice(page)
  await page.locator('.sidebar .sb-nav-row', { hasText: '設定' }).click()
  await page.locator('.settings-nav-row', { hasText: 'GitHub 連結' }).click()
  await page.locator('.settings-content').getByRole('button', { name: '更換 token' }).click()
  const dialog = page.getByRole('dialog', { name: '更換 token' })
  await dialog.getByLabel('GitHub token').fill(readOnly)
  await dialog.getByRole('button', { name: '更換 token' }).click()
  await expect(dialog.getByText('這把 token 沒有這個 repo 的寫入權限')).toBeVisible()
})

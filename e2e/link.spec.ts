/**
 * Device linking (LINK-1 to LINK-4): the source device shows an encrypted setup code, the new device pastes it
 * and enters the pairing code. The camera is not testable, so the setup code is copied through the clipboard.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  bodyOf,
  commitCount,
  createPage,
  newContextOn,
  openSettings,
  readRepoFile,
  REPO,
  setupDevice,
  syncAndWaitForCommit,
  TOKEN,
  waitSynced,
} from './helpers'

/** 設定 → 連結新裝置 → 顯示 QR code → 複製設定碼. Returns the payload and the pairing code. */
async function showLinkCode(page: Page): Promise<{ payload: string; code: string }> {
  await openSettings(page, '同步與儲存')
  await page.locator('.settings-content').getByRole('button', { name: '顯示 QR code' }).click()
  const dialog = page.getByRole('dialog', { name: '連結新裝置' })
  // The QR code and the pairing code appear only after the click (LINK-2).
  await expect(dialog.locator('.link-code')).toHaveCount(0)
  await expect(dialog.getByRole('img', { name: '連結新裝置用的 QR code' })).toHaveCount(0)
  await dialog.getByRole('button', { name: '顯示 QR code' }).click()
  await expect(dialog.getByRole('img', { name: '連結新裝置用的 QR code' })).toBeVisible()
  const code = ((await dialog.locator('.link-code').innerText()) ?? '').replace('-', '')
  expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
  // Record what the app copies (clipboard permissions exist only in Chromium).
  await page.evaluate(() => {
    const w = window as Window & { __copied?: string }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void (w.__copied = text) } })
  })
  await dialog.getByRole('button', { name: '複製設定碼' }).click()
  await expect(dialog.getByText('剪貼簿記錄和「通用剪貼板」可能會保留設定碼')).toBeVisible()
  const payload = (await page.evaluate(() => (window as Window & { __copied?: string }).__copied)) ?? ''
  expect(payload).toMatch(/^ghnotes:1:[\w-]+\.[\w-]+\.[\w-]+$/)
  // The token is encrypted: neither the token nor the repo name is readable in the payload.
  expect(payload).not.toContain(TOKEN)
  expect(payload).not.toContain('TingGeorge')
  return { payload, code }
}

async function typeCode(page: Page, code: string) {
  await page.getByLabel('配對碼第 1 碼').click()
  await page.keyboard.type(code)
}

test('a new device links with the setup code and the right pairing code, and syncs the same notes', async ({ page, fake, browser }) => {
  await setupDevice(page)
  await createPage(page, '要帶走的筆記', '裝置一寫的內容')
  await syncAndWaitForCommit(page, fake)
  const { payload, code } = await showLinkCode(page)
  const before = commitCount(fake)

  const d = await newContextOn(browser, fake)
  const b = d.page
  await b.goto('./')
  await b.getByRole('button', { name: '用 QR code 從另一台裝置連結' }).click()
  // No camera here: the paste option is offered.
  await b.getByRole('button', { name: '改用設定碼' }).click()

  // Something that is not our payload.
  await b.getByLabel('設定碼').fill('hello world')
  await b.getByRole('button', { name: '繼續' }).click()
  await expect(b.getByText('這不是 GitHub Notes 的 QR code')).toBeVisible()

  await b.getByLabel('設定碼').fill(payload)
  await b.getByRole('button', { name: '繼續' }).click()
  await expect(b.getByRole('heading', { name: '輸入配對碼' })).toBeVisible()

  // Wrong code: the error and the remaining tries.
  await typeCode(b, 'AAAAAAAA')
  await expect(b.getByText('配對碼不正確，還可以再試 2 次')).toBeVisible()
  await typeCode(b, 'BBBBBBBB')
  await expect(b.getByText('配對碼不正確，還可以再試 1 次')).toBeVisible()
  // Right code: shows what is about to be linked (SEC-8).
  await typeCode(b, code)
  await expect(b.getByText(REPO)).toBeVisible()
  await expect(b.getByText(/GitHub 帳號：TingGeorge · token .* 到期/)).toBeVisible()
  await b.getByRole('button', { name: '連結並開始同步' }).click()
  await b.getByRole('button', { name: '開始使用' }).click({ timeout: 30_000 })
  await expect(b.locator('.sidebar')).toBeVisible()
  await expect(b.locator('.sidebar .tree-title', { hasText: '要帶走的筆記' })).toBeVisible()
  await b.locator('.sidebar .tree-link', { hasText: '要帶走的筆記' }).click()
  await expect(b.locator('.ProseMirror')).toContainText('裝置一寫的內容')
  await waitSynced(b)
  // Linking wrote nothing to the repo.
  expect(commitCount(fake)).toBe(before)
  expect(bodyOf(await readRepoFile(fake, '要帶走的筆記.md'))).toBe('裝置一寫的內容\n')
  await d.context.close()
})

test('three wrong pairing codes discard the payload and go back to scanning', async ({ page, fake, browser }) => {
  await setupDevice(page)
  const { payload } = await showLinkCode(page)
  const usersBefore = fake.count('GET', '/user')
  const d = await newContextOn(browser, fake)
  const b = d.page
  await b.goto('./')
  await b.getByRole('button', { name: '用 QR code 從另一台裝置連結' }).click()
  await b.getByRole('button', { name: '改用設定碼' }).click()
  await b.getByLabel('設定碼').fill(payload)
  await b.getByRole('button', { name: '繼續' }).click()
  for (const [i, wrong] of ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC'].entries()) {
    await typeCode(b, wrong)
    if (i < 2) await expect(b.getByText(`配對碼不正確，還可以再試 ${2 - i} 次`)).toBeVisible()
  }
  await expect(b.getByText('配對碼錯太多次了，請重新掃描 QR code。')).toBeVisible()
  await expect(b.getByRole('heading', { name: '輸入配對碼' })).toHaveCount(0)
  // Nothing was linked: the token never reached the new device.
  expect(fake.count('GET', '/user')).toBe(usersBefore)
  await d.context.close()
})

test('the pairing code and QR code hide after 60 s and 重新產生 makes a new code', async ({ page }) => {
  await setupDevice(page)
  await page.clock.install()
  await openSettings(page, '同步與儲存')
  await page.locator('.settings-content').getByRole('button', { name: '顯示 QR code' }).click()
  const dialog = page.getByRole('dialog', { name: '連結新裝置' })
  await dialog.getByRole('button', { name: '顯示 QR code' }).click()
  const first = await dialog.locator('.link-code').innerText()
  await dialog.getByRole('button', { name: '重新產生' }).click()
  await expect.poll(async () => await dialog.locator('.link-code').innerText()).not.toBe(first)
  await page.clock.fastForward(61_000)
  await expect(dialog.locator('.link-code')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '顯示 QR code' })).toBeVisible()
})

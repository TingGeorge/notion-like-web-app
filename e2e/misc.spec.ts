/** Appearance, printing and security checks: dark mode, print stylesheet, CSP, framing (SEC-3), network and token hygiene. */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { BASE_URL, expect, test, TOKEN, modKey } from './fixtures'
import { createPage, editor, openFromSidebar, openSettings, setupDevice, syncAndWaitForCommit, titleInput } from './helpers'

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme)

test('dark mode: Ctrl+Shift+L toggles it, the choice is kept, and settings can set it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await setupDevice(page)
  expect(await theme(page)).toBe('light')
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const light = await bg()
  await page.keyboard.press(`${await modKey(page)}+Shift+KeyL`)
  await expect.poll(() => theme(page)).toBe('dark')
  expect(await bg()).not.toBe(light)
  // Kept across a reload.
  await page.reload()
  await expect.poll(() => theme(page)).toBe('dark')
  await page.keyboard.press(`${await modKey(page)}+Shift+KeyL`)
  await expect.poll(() => theme(page)).toBe('light')

  // 設定 → 外觀與語言.
  await openSettings(page, '外觀與語言')
  await page.getByRole('radio', { name: '深色' }).click()
  await expect.poll(() => theme(page)).toBe('dark')
  await page.getByRole('radio', { name: '淺色' }).click()
  await expect.poll(() => theme(page)).toBe('light')
  // 跟隨系統 follows prefers-color-scheme.
  await page.getByRole('radio', { name: '跟隨系統' }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => theme(page)).toBe('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => theme(page)).toBe('light')
})

test('設定 → 外觀與語言 switches the UI between 繁體中文 and English, and the choice is kept', async ({ page }) => {
  await setupDevice(page)
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-Hant-TW')
  await openSettings(page, '外觀與語言')
  await expect(page.getByRole('radio', { name: '繁體中文' })).toHaveAttribute('aria-checked', 'true')
  // Choosing English reloads the app in English.
  await page.getByRole('radio', { name: 'English' }).click()
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Search' })).toBeVisible()
  await expect(page.locator('.sidebar .sb-footer').getByRole('button', { name: 'New page' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en')
  // Kept across a reload; the page menu is in English too.
  await page.reload()
  await page.locator('.sidebar .tree-link').first().click()
  await page.locator('.topbar').getByRole('button', { name: 'Page menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Print / Save as PDF' })).toBeVisible()
  await page.keyboard.press('Escape')
  // And back.
  await page.locator('.sidebar .sb-nav-row', { hasText: 'Settings' }).click()
  await page.locator('.settings-nav-row', { hasText: 'Appearance & language' }).click()
  await page.getByRole('radio', { name: '繁體中文' }).click()
  await expect(page.locator('.sidebar').getByRole('button', { name: '搜尋' })).toBeVisible()
})

test('the print stylesheet hides the app chrome and keeps the page', async ({ page }) => {
  await setupDevice(page)
  await createPage(page, '要列印的頁面', '列印的內容')
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.locator('.topbar')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(page.locator('.topbar')).toBeHidden()
  await expect(editor(page)).toBeVisible()
  await expect(titleInput(page)).toBeVisible()
  await page.emulateMedia({ media: 'screen' })
  await expect(page.locator('.sidebar')).toBeVisible()
  // An open menu is not printed.
  await page.locator('.topbar').getByRole('button', { name: '頁面選單' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('menu')).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  // 列印／存成 PDF in the page menu calls window.print() once the menu has closed.
  type Printed = { __printed: { menuOpen: boolean }[] }
  await page.evaluate(() => {
    ;(window as unknown as Printed).__printed = []
    window.print = () => void (window as unknown as Printed).__printed.push({ menuOpen: !!document.querySelector('[role="menu"]') })
  })
  await page.locator('.topbar').getByRole('button', { name: '頁面選單' }).click()
  await page.getByRole('menuitem', { name: '列印／存成 PDF' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as Printed).__printed)).toEqual([{ menuOpen: false }])
})

test('the built index.html carries the CSP of SEC-3', () => {
  const html = readFileSync('dist/index.html', 'utf8')
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)
  expect(meta).not.toBeNull()
  const policy = Object.fromEntries(
    meta![1].split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/)
      return [name, values.join(' ')]
    }),
  )
  expect(policy).toEqual({
    'default-src': "'self'",
    'script-src': "'self'",
    'style-src': "'self' 'unsafe-inline'",
    'img-src': "'self' blob: data: https:",
    'connect-src': "'self' https://api.github.com",
    'worker-src': "'self' blob:",
    'media-src': "'self' blob: mediastream:",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'none'",
  })
  // No third-party script or stylesheet is referenced (ARCH-4).
  expect(html).not.toMatch(/(?:src|href)="https?:\/\/(?!github\.com)/)
})

test('the app refuses to run inside a frame (SEC-3)', async ({ page }) => {
  await page.goto('./')
  await page.setContent(`<iframe id="f" src="${BASE_URL}"></iframe>`)
  const frame = page.frameLocator('#f')
  await expect(frame.locator('body')).toHaveText('GitHub Notes 不能在其他網頁裡面執行。')
  await expect(frame.getByRole('button', { name: '開始設定' })).toHaveCount(0)
})

test('no request leaves for any host but the app and api.github.com; the token is never in a URL or the console', async ({ page, fake }) => {
  const urls: string[] = []
  const consoleText: string[] = []
  page.on('request', (r) => urls.push(r.url()))
  page.on('console', (m) => consoleText.push(m.text()))
  page.on('pageerror', (e) => consoleText.push(e.message))

  await setupDevice(page)
  await createPage(page, '安全檢查', '一些內容 [連結](https://example.com/x)')
  await syncAndWaitForCommit(page, fake)
  await openFromSidebar(page, '歡迎使用')
  await page.keyboard.press(`${await modKey(page)}+K`)
  await page.getByPlaceholder('搜尋頁面…').fill('安全')
  await page.keyboard.press('Escape')
  await openSettings(page, '同步與儲存')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('.sidebar')).toBeVisible()

  const hosts = new Set(urls.filter((u) => /^https?:/.test(u)).map((u) => new URL(u).host))
  // The only external host is GitHub's API (ARCH-3).
  for (const host of hosts) expect([new URL(BASE_URL).host, 'api.github.com']).toContain(host)
  expect(hosts.has('api.github.com')).toBe(true)
  for (const u of urls) {
    expect(u).not.toContain(TOKEN)
    expect(decodeURIComponent(u)).not.toContain('github_pat_')
  }
  for (const line of consoleText) expect(line).not.toContain('github_pat_')
  // The fake saw the token only in the Authorization header.
  expect(fake.requests.every((r) => !r.search.includes('github_pat_'))).toBe(true)
})

test('SW-free page load fetches nothing from other origins at startup (ARCH-4)', async ({ page }) => {
  const urls: string[] = []
  page.on('request', (r) => urls.push(r.url()))
  await page.goto('./')
  await expect(page.getByRole('button', { name: '開始設定' })).toBeVisible()
  expect(urls.filter((u) => /^https?:/.test(u) && !u.startsWith(BASE_URL))).toEqual([])
})

/**
 * Shared helpers for the end-to-end tests: setting up a device, creating pages, forcing a sync and
 * reading the repo through the fake GitHub. Nothing here talks to the real GitHub (TEST-2).
 */
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { deviceName } from '../src/lib/data/device'
import type { FakeGitHub } from '../test/fake-github'
import { BASE_URL, attachFake, expect, LOGIN, modKey, REPO, TOKEN } from './fixtures'

export { expect, LOGIN, REPO, TOKEN }

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
export const PHONE_VIEWPORT = { width: 393, height: 852 }

/** A page file as the app writes it for a new page. */
export function frontmatterOf(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  const out: Record<string, string> = {}
  if (!match) return out
  for (const line of match[1].split('\n')) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
  return out
}

/** The body of a page file (everything after the frontmatter). */
export function bodyOf(text: string | null): string {
  if (text === null) return ''
  return text.replace(/^---\n[\s\S]*?\n---\n/, '')
}

export interface ConnectOptions {
  token?: string
  /** `YYYY-MM-DD`; the default (today + 90 days) is kept when omitted. */
  expiresOn?: string
}

/** 開始設定 → paste the token → 連結. Stops at the repo list. */
export async function connectToken(page: Page, options: ConnectOptions = {}): Promise<void> {
  await page.goto('./')
  // SETUP-2: iPhone Safari outside the home-screen app shows 「加入主畫面」 first.
  const start = page.getByRole('button', { name: '開始設定' })
  const inSafari = page.getByRole('button', { name: '仍要在 Safari 使用' })
  await expect(start.or(inSafari)).toBeVisible()
  if (await inSafari.isVisible()) await inSafari.click()
  await start.click()
  await page.getByLabel('GitHub token').fill(options.token ?? TOKEN)
  if (options.expiresOn) {
    const [y, m, d] = options.expiresOn.split('-')
    await page.getByLabel('到期日').fill(`${y}/${m}/${d}`)
  }
  await page.getByRole('button', { name: '連結', exact: true }).click()
}

/** Pick `repo` in the list and press 「使用這個 repo」. Does not wait for the result. */
export async function chooseRepo(page: Page, repo: string = REPO): Promise<void> {
  await page.getByRole('radio', { name: new RegExp(repo.replace('/', '\\/')) }).click()
  await page.getByRole('button', { name: '使用這個 repo' }).click()
}

/** Finish first-run setup against `repo` and wait for the main UI. */
export async function setupDevice(page: Page, options: ConnectOptions & { repo?: string } = {}): Promise<void> {
  await connectToken(page, options)
  await chooseRepo(page, options.repo)
  await page.getByRole('button', { name: '開始使用' }).click({ timeout: 30_000 })
  await expect(page.locator('.sidebar, .home').first()).toBeVisible()
  await waitSynced(page)
}

export interface Device {
  context: BrowserContext
  page: Page
  /** Cut this device (only this one) off from GitHub, or reconnect it. */
  setOffline(offline: boolean): Promise<void>
}

/**
 * `context.setOffline` does not stop requests that a route answers, so a device is taken offline
 * by a route that aborts them, plus the browser's own offline flag (for the `offline`/`online` events).
 */
export async function offlineSwitch(context: BrowserContext): Promise<(offline: boolean) => Promise<void>> {
  let offline = false
  await context.route('https://api.github.com/**', (route) => (offline ? route.abort('internetdisconnected') : route.fallback()))
  return async (value) => {
    offline = value
    await context.setOffline(value)
  }
}

/**
 * A second (third, …) browser context wired to the same fake GitHub, with its own storage. Its user
 * agent says "Edge" so its commits and conflict dialogs name a different device.
 */
export async function newContextOn(
  browser: Browser,
  fake: FakeGitHub,
  options: { userAgent?: string; viewport?: { width: number; height: number } } = {},
): Promise<Device> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    serviceWorkers: 'block',
    viewport: options.viewport ?? DESKTOP_VIEWPORT,
    userAgent:
      options.userAgent ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.37 Safari/537.36 Edg/141.0.0.0',
  })
  await attachFake(context, fake)
  const setOffline = await offlineSwitch(context)
  return { context, page: await context.newPage(), setOffline }
}

/** A fully set up second device on the same repo. */
export async function secondDevice(browser: Browser, fake: FakeGitHub): Promise<Device> {
  const device = await newContextOn(browser, fake)
  await setupDevice(device.page)
  return device
}

/** SYNC-9: the name the app gives the device and browser `page` runs in (`Mac · Safari`). */
export async function deviceNameOf(page: Page): Promise<string> {
  const env = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }
    return {
      userAgent: nav.userAgent,
      maxTouchPoints: nav.maxTouchPoints,
      userAgentData: nav.userAgentData ? { platform: nav.userAgentData.platform, mobile: nav.userAgentData.mobile } : null,
    }
  })
  return deviceName(env)
}

/** The device part alone (`Mac`), as conflict dialogs name the other side. */
export async function deviceKindOf(page: Page): Promise<string> {
  return (await deviceNameOf(page)).split(' · ')[0]
}

// --- Status and sync -------------------------------------------------------------------------

export function syncButton(page: Page): Locator {
  return page.locator('.sync-status').first()
}

/** Wait until the sync status reads 已同步 (nothing dirty, last pull fine). */
export async function waitSynced(page: Page): Promise<void> {
  await expect(syncButton(page)).toHaveText('已同步', { timeout: 20_000 })
}

/**
 * Click the sync status (「立即同步」) and wait for the push to finish. The editor is flushed first
 * (SYNC-3), so text typed a moment ago is included.
 */
export async function forceSync(page: Page): Promise<void> {
  await syncButton(page).click()
  // The click starts the cycle asynchronously; give the status a chance to leave 已同步.
  await page.waitForTimeout(150)
  await waitSynced(page)
}

/** 「立即同步」 and wait until the fake has gained at least one commit. */
export async function syncAndWaitForCommit(page: Page, fake: FakeGitHub, before = fake.commits(REPO).length): Promise<void> {
  await syncButton(page).click()
  await expect.poll(() => fake.commits(REPO).length, { timeout: 20_000 }).toBeGreaterThan(before)
  await waitSynced(page)
}

// --- Reading the repo ------------------------------------------------------------------------

export function commitCount(fake: FakeGitHub): number {
  return fake.commits(REPO).length
}

export function headMessage(fake: FakeGitHub): string {
  return fake.commits(REPO)[0].message
}

/** The first line of the head commit's message. */
export function headSubject(fake: FakeGitHub): string {
  return headMessage(fake).split('\n')[0]
}

export async function readRepoFile(fake: FakeGitHub, path: string): Promise<string | null> {
  return fake.readFile(REPO, path)
}

/** Paths of the pages (`.md`, outside reserved folders) in the repo. */
export function pagePaths(fake: FakeGitHub): string[] {
  return fake.listFiles(REPO).filter((p) => p.endsWith('.md') && !p.startsWith('.') && !p.includes('/.'))
}

export async function trashIndex(fake: FakeGitHub): Promise<{ entries: Array<{ id: string; title: string; originalPath: string; reason: string }> }> {
  const text = await fake.readFile(REPO, '.notes/trash/index.json')
  return text ? JSON.parse(text) : { entries: [] }
}

export async function settingsJson(fake: FakeGitHub): Promise<{ favorites: string[]; order: Record<string, string[]> }> {
  const text = await fake.readFile(REPO, '.notes/settings.json')
  return text ? JSON.parse(text) : { favorites: [], order: {} }
}

/** Poll until the repo has a file at `path`, then return its text. */
export async function waitForFile(fake: FakeGitHub, path: string): Promise<string> {
  await expect.poll(async () => await fake.readFile(REPO, path), { timeout: 20_000, message: `waiting for ${path}` }).not.toBeNull()
  return (await fake.readFile(REPO, path))!
}

// --- Creating and editing pages --------------------------------------------------------------

export function titleInput(page: Page): Locator {
  return page.locator('.page-title-input')
}

export function editor(page: Page): Locator {
  return page.locator('.ProseMirror')
}

/** Create a page with ⌘⌥N (Ctrl+Alt+N) and wait for its title field. */
export async function newPageByShortcut(page: Page): Promise<void> {
  await page.keyboard.press(`${await modKey(page)}+Alt+KeyN`)
  await expect(titleInput(page)).toBeFocused()
}

/** Put the caret at the end of the page body. (Ctrl+End is a host-platform key, not the app's.) */
export async function caretToEnd(page: Page): Promise<void> {
  await editor(page).focus()
  await editor(page).evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let last: Node | null = null
    while (walker.nextNode()) last = walker.currentNode
    const range = document.createRange()
    if (last) {
      range.setStart(last, last.textContent?.length ?? 0)
      range.collapse(true)
    } else {
      range.selectNodeContents(el)
      range.collapse(false)
    }
    const sel = getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  })
}

/**
 * Create a page through the UI: new page, type the title, move into the body and type the body
 * (one paragraph per line). Does not sync.
 */
export async function createPage(page: Page, title: string, body = ''): Promise<void> {
  await newPageByShortcut(page)
  await titleInput(page).fill(title)
  await titleInput(page).press('Enter')
  await expect(editor(page)).toBeFocused()
  if (body) await typeLines(page, body)
  // Titles are applied on blur / Enter; wait until the rename reached the sidebar or top bar.
  await expect(page.locator('.breadcrumb-item.is-current')).toContainText(title)
  // Edits are written to the local database 300 ms after the last keystroke (STORE-3).
  await page.waitForTimeout(400)
}

/** Type text into the focused editor; "\n" presses Enter. */
export async function typeLines(page: Page, text: string): Promise<void> {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Enter')
    if (lines[i]) await page.keyboard.type(lines[i])
  }
}

/** Open a page from the sidebar tree by its title. */
export async function openFromSidebar(page: Page, title: string): Promise<void> {
  await page.locator('.sidebar .tree-link', { has: page.locator('.tree-title', { hasText: new RegExp(`^${escapeRegExp(title)}$`) }) }).first().click()
  await expect(page.locator('.breadcrumb-item.is-current')).toContainText(title)
}

export function treeRow(page: Page, title: string): Locator {
  return page.locator('.sidebar .tree-row', { has: page.locator('.tree-title', { hasText: new RegExp(`^${escapeRegExp(title)}$`) }) }).first()
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Titles currently shown in the sidebar tree (visible rows only), in order. */
export async function sidebarTitles(page: Page): Promise<string[]> {
  return page.locator('.sidebar .page-tree .tree-title').allTextContents()
}

/** The editor's Markdown-relevant DOM, for checking that blocks render back. */
export async function editorHtml(page: Page): Promise<string> {
  return editor(page).innerHTML()
}

/** Open the page menu (`…` in the top bar) and click an item. */
export async function pageMenu(page: Page, item: string): Promise<void> {
  await page.locator('.topbar').getByRole('button', { name: '頁面選單' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

/** Open 設定 from the sidebar and select a section. */
export async function openSettings(page: Page, section?: string): Promise<void> {
  await page.locator('.sidebar .sb-nav-row', { hasText: '設定' }).click()
  if (section) await page.locator('.settings-nav-row', { hasText: section }).click()
}

// --- Accessibility -----------------------------------------------------------------------------

/** NFR-3: the current screen has no WCAG 2.1 A/AA violations that axe can find (labels, contrast, roles…). */
export async function expectAccessible(page: Page, screen: string): Promise<void> {
  // Let fade-ins finish (spinners run forever and are left alone): axe reads colours mid-fade as faint.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const found = violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim() ?? v.help}`))
  expect(found, `${screen}: accessibility violations`).toEqual([])
}

// --- Attachments -------------------------------------------------------------------------------

/** Three distinct 2×2 PNGs (red, green, blue), for file choosers. */
export function threeImages(): Array<{ name: string; mimeType: string; buffer: Buffer }> {
  return [
    ['red', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg=='],
    ['green', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNg+M8AQhAKABvyA/1tVLjHAAAAAElFTkSuQmCC'],
    ['blue', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC'],
  ].map(([name, b64]) => ({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }))
}

/** The attachments (`_assets/…`) in the repo. */
export function assetPaths(fake: FakeGitHub): string[] {
  return fake.listFiles(REPO).filter((p) => p.startsWith('_assets/'))
}

/** Wait for `count` uploaded images in the editor, failing at the step that went wrong. */
export async function expectUploadedImages(page: Page, count: number): Promise<void> {
  const ed = editor(page)
  await expect(ed.locator('.upload-placeholder, figure.image-block').first(), 'uploads started').toBeVisible()
  await expect(ed.locator('.upload-placeholder:not(.is-error)'), 'uploads still running').toHaveCount(0, { timeout: 20_000 })
  await expect(ed.locator('.upload-placeholder.is-error'), 'upload errors').toHaveCount(0)
  await expect(ed.locator('figure.image-block'), 'image blocks').toHaveCount(count)
  await expect(ed.locator('.image-placeholder:not(.is-loading)'), 'images that failed to show').toHaveCount(0)
  await expect(ed.locator('figure.image-block img'), 'images shown').toHaveCount(count)
}

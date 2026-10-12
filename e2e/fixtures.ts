/**
 * Playwright fixtures: every test gets an in-memory fake GitHub (TEST-2) that `api.github.com`
 * is routed to. Tests never touch real GitHub.
 */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { FakeGitHub, FakeNetworkError } from '../test/fake-github'

export const LOGIN = 'TingGeorge'
export const TOKEN = 'github_pat_11ABCDEFG0testtoken_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'
export const REPO = `${LOGIN}/notes`

/** Route a browser context's GitHub API calls to the fake. */
export async function attachFake(context: BrowserContext, fake: FakeGitHub): Promise<void> {
  // Playwright's WebKit cannot fulfil a 304, so there conditional requests always get a full answer
  // (the 304 path is covered by the unit tests).
  const allow304 = context.browser()?.browserType().name() !== 'webkit'
  await context.route('https://api.github.com/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const headers = await request.allHeaders()
    if (!allow304) delete headers['if-none-match']
    const body = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : (request.postDataBuffer() ?? undefined)?.toString("utf8")
    try {
      const response = await fake.handle(new Request(request.url(), { method, headers, body }))
      const out: Record<string, string> = {}
      response.headers.forEach((value, key) => (out[key] = value))
      await route.fulfill({ status: response.status, headers: out, body: Buffer.from(await response.arrayBuffer()) })
    } catch (error) {
      if (error instanceof FakeNetworkError) await route.abort('internetdisconnected')
      else throw error
    }
  })
}

/** A fake GitHub with one user, one token and (by default) one empty private repo. */
export async function makeFake(options: { files?: Record<string, string>; empty?: boolean } = {}): Promise<FakeGitHub> {
  const fake = new FakeGitHub()
  fake.addUser(LOGIN, { name: 'Ting' })
  fake.addToken(TOKEN, { login: LOGIN })
  await fake.createRepo(REPO, { private: true, empty: options.empty ?? !options.files, files: options.files })
  return fake
}

/** Go through 首次設定 (D12–D14) with the test token and repo. */
export async function setupWorkspace(page: Page): Promise<void> {
  await page.goto('./')
  // SETUP-2: iPhone Safari outside the home-screen app shows 「加入主畫面」 first.
  const start = page.getByRole('button', { name: '開始設定' })
  const inSafari = page.getByRole('button', { name: '仍要在 Safari 使用' })
  await expect(start.or(inSafari)).toBeVisible()
  if (await inSafari.isVisible()) await inSafari.click()
  await start.click()
  await page.getByLabel('GitHub token').fill(TOKEN)
  await page.getByRole('button', { name: '連結', exact: true }).click()
  await page.getByText(REPO).click()
  await page.getByRole('button', { name: '使用這個 repo' }).click()
  await page.getByRole('button', { name: '開始使用' }).click({ timeout: 30_000 })
  await expect(page.locator('.sidebar, .home').first()).toBeVisible()
}

export const test = base.extend<{ fake: FakeGitHub }>({
  // `auto`: every test is routed to the fake, even one that never asks for it (TEST-2).
  fake: [
    async ({ context }, use) => {
      const fake = await makeFake()
      await attachFake(context, fake)
      await use(fake)
    },
    { auto: true },
  ],
})

export { expect }

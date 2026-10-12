// Drives the setup/link flows in the dev harness and checks the user-visible behaviour.
//   node dev/flows.mjs [baseUrl]      (`npm run dev` must be running)
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173/dev/setup.html'
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
let failures = 0
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures++
}

async function open(query, hash, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts })
  const page = await ctx.newPage()
  await page.goto(`${base}?${query}${hash}`)
  return page
}
const text = (page, s) => page.getByText(s, { exact: false }).first().waitFor({ timeout: 4000 }).then(() => true, () => false)
const gone = (page, s) => page.getByText(s, { exact: false }).first().waitFor({ state: 'detached', timeout: 4000 }).then(() => true, () => false)

// ---- SETUP-4: token format
{
  const page = await open('', '#/setup/connect')
  await page.fill('#setup-token', 'hello')
  await page.locator('#setup-token').blur()
  check(await text(page, '這看起來不是 GitHub token'), 'invalid token shows inline message')
  check(await page.getByRole('button', { name: '連結', exact: true }).isDisabled(), 'connect disabled for invalid token')
  await page.fill('#setup-token', '  github_pat_11ABC  ')
  await page.locator('#setup-token').blur()
  check((await page.inputValue('#setup-token')) === 'github_pat_11ABC', 'token is trimmed on blur')
  check(await gone(page, '這看起來不是 GitHub token'), 'message disappears for valid token')

  // SETUP-3: links
  const links = await page.locator('a[target=_blank]').evaluateAll((as) => as.map((a) => [a.href, a.rel]))
  check(links.some(([h, r]) => h === 'https://github.com/new' && r.includes('noopener') && r.includes('noreferrer')), 'new repo link')
  check(links.some(([h]) => h === 'https://github.com/settings/personal-access-tokens/new?name=GitHub+Notes&description=GitHub+Notes+app&contents=write&expires_in=90'), 'new token link')
  // SETUP-5 default expiry
  check((await page.inputValue('#setup-expiry')) === '2027/01/10', 'expiry defaults to today + 90 days')
  // mask / reveal
  check((await page.getAttribute('#setup-token', 'type')) === 'password', 'token masked by default')
  await page.getByRole('button', { name: '顯示' }).click()
  check((await page.getAttribute('#setup-token', 'type')) === 'text', 'token revealed on 顯示')
  await page.context().close()
}

// ---- SETUP-6: 401, classic warning, then repo list
{
  const page = await open('', '#/setup/connect')
  await page.fill('#setup-token', 'github_pat_bad')
  await page.getByRole('button', { name: '連結', exact: true }).click()
  check(await text(page, 'token 無效或已過期'), '401 shows token 無效或已過期')
  await page.fill('#setup-token', 'ghp_classicToken')
  await page.getByRole('button', { name: '連結', exact: true }).click()
  check(await text(page, '這是 classic token'), 'classic token warning')
  check(!(await page.locator('.repo-row').count()), 'classic: not connected before confirming')
  await page.getByRole('button', { name: '仍要使用' }).click()
  check(await page.locator('.repo-row').first().waitFor({ timeout: 4000 }).then(() => true, () => false), 'classic accepted after warning')
  check(page.url().includes('#/setup/repo') && !page.url().includes('ghp_'), 'route is #/setup/repo and URL has no token')
  await page.context().close()
}

// ---- SETUP-7..9: repo step
{
  const page = await open('', '#/setup/connect')
  await page.fill('#setup-token', 'github_pat_11goodtoken')
  await page.getByRole('button', { name: '連結', exact: true }).click()
  await page.locator('.repo-row').first().waitFor()
  check(await text(page, '已有 12 個 Markdown 檔，會直接變成頁面'), 'lazy page count shown')
  check(await text(page, '空的 repo'), 'empty repo text')
  check(await page.locator('.repo-badge', { hasText: 'Public' }).count() === 1, 'public badge')

  // public needs confirmation
  await page.getByRole('radio', { name: /blog/ }).click()
  await page.getByRole('button', { name: '使用這個 repo' }).click()
  check(await text(page, '公開的 repo 任何人都看得到你的筆記'), 'public repo confirmation')
  await page.getByRole('button', { name: '取消' }).click()
  check(await gone(page, '要使用公開的 repo 嗎？'), 'confirmation cancelled')

  // no access
  await page.getByRole('radio', { name: /no-access/ }).click()
  await page.getByRole('button', { name: '使用這個 repo' }).click()
  check(await text(page, '這把 token 沒有這個 repo 的寫入權限（Contents: Read and write）'), 'no-access error')

  // empty repo gets initialised, then the first sync
  await page.getByRole('radio', { name: /github-note-app-db/ }).click()
  await page.getByRole('button', { name: '使用這個 repo' }).click()
  await page.locator('.progress').waitFor()
  const created = await page.evaluate(() => window.__created)
  check(JSON.stringify(created) === JSON.stringify(['歡迎使用.md']), 'empty repo initialised with 歡迎使用.md')
  const ws = await page.evaluate(() => window.__workspace)
  check(ws?.owner === 'TingGeorge' && ws.repo === 'github-note-app-db' && ws.branch === 'main' && ws.login === 'TingGeorge' && ws.tokenExpiresOn === '2027-01-10' && ws.private === true, 'workspace built')
  check(await text(page, '已連結 TingGeorge/github-note-app-db'), 'first sync shows repo')
  check(await page.getByRole('button', { name: '開始使用' }).isDisabled(), '開始使用 disabled while syncing')
  await page.getByRole('button', { name: '開始使用' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('button.btn-primary[disabled]') || true)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === '開始使用' && !b.disabled), null, { timeout: 8000 })
  check(true, '開始使用 enabled when done')
  await page.getByRole('button', { name: '開始使用' }).click()
  check((await page.title()) === 'finished', 'onFinished called')
  await page.context().close()
}

// ---- SETUP-2
{
  const page = await open('ios=1', '')
  check(await text(page, '先把 GitHub Notes 加到主畫面'), 'iOS Safari shows add-to-home first')
  await page.getByRole('button', { name: '仍要在 Safari 使用' }).click()
  check(await text(page, '開始設定'), 'continues to welcome')
  check((await page.title()) === 'safari-accepted', 'choice remembered via callback')
  await page.context().close()
  const standalone = await open('ios=1&standalone=1', '')
  check(await text(standalone, '開始設定'), 'standalone iOS goes straight to welcome')
  await standalone.context().close()
}

// ---- LINK-3: wrong pairing code x3, then success
{
  const page = await open('', '#/setup/scan')
  check(await text(page, '無法使用相機') || (await page.locator('video').count()) > 0, 'scan screen renders')
  await page.getByRole('button', { name: '改用設定碼' }).click()
  await page.locator('textarea').fill('https://example.com')
  await page.getByRole('button', { name: '繼續' }).click()
  check(await text(page, '這不是 GitHub Notes 的 QR code'), 'non ghnotes content rejected')
  await page.locator('textarea').fill(await page.evaluate(() => window.__payload))
  await page.getByRole('button', { name: '繼續' }).click()
  await page.locator('.pair-box').first().waitFor()
  for (const [i, left] of [[0, 2], [1, 1]]) {
    await page.locator('.pair-box').first().click()
    await page.keyboard.type('AAAAAAAA')
    check(await text(page, `配對碼不正確，還可以再試 ${left} 次`), `wrong code #${i + 1} message`)
  }
  await page.locator('.pair-box').first().click()
  await page.keyboard.type('AAAAAAAA')
  check(await text(page, '配對碼錯太多次了'), 'three wrong codes discard the payload and return to scanning')
  check(page.url().endsWith('#/setup/scan'), 'back on #/setup/scan')

  // success, with paste into the boxes
  await page.getByRole('button', { name: '改用設定碼' }).click()
  await page.locator('textarea').fill(await page.evaluate(() => window.__payload))
  await page.getByRole('button', { name: '繼續' }).click()
  await page.locator('.pair-box').first().waitFor()
  await page.evaluate(() => {
    const el = document.querySelector('.pair-box')
    const dt = new DataTransfer()
    dt.setData('text', 'k7qm-2xpa')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  check(await text(page, '即將連結'), 'paste fills all boxes and decrypts')
  check(await text(page, 'GitHub 帳號：TingGeorge · token 2027/01/10 到期'), 'shows account and expiry')
  check(await text(page, 'TingGeorge/github-note-app-db'), 'shows owner/repo')
  check((await page.locator('.pair-box').evaluateAll((els) => els.map((e) => e.value).join(''))) === 'K7QM2XPA', 'code uppercased')
  await page.getByRole('button', { name: '連結並開始同步' }).click()
  await page.locator('.progress').waitFor()
  check(page.url().endsWith('#/setup/sync'), 'continues to first sync')
  await page.context().close()
}

// ---- LINK-3 camera: with a fake device the camera starts and no error is shown
{
  const page = await open('', '#/setup/scan', { permissions: ['camera'] })
  await page.waitForTimeout(800)
  check((await page.locator('video').evaluate((v) => !!v.srcObject)), 'camera stream attached')
  check(!(await page.getByText('無法使用相機').count()), 'no camera error with a camera')
  await page.getByRole('button', { name: '取消' }).click()
  check(page.url().endsWith('#/setup/welcome'), 'cancel returns to welcome')
  await page.context().close()
}

// ---- LINK-2: dialog
{
  const page = await open('view=link', '', { permissions: ['clipboard-read', 'clipboard-write'] })
  check(!(await page.locator('.qr-svg').count()), 'no QR before 顯示 QR code')
  check(!(await page.locator('.link-code').count()), 'no pairing code before click')
  await page.getByRole('button', { name: '顯示 QR code' }).click()
  await page.locator('.qr-svg').waitFor()
  check(await text(page, 'K7QM-2XPA'), 'pairing code shown')
  check(await text(page, '秒後自動隱藏'), 'countdown shown')
  await page.getByRole('button', { name: '複製設定碼' }).click()
  check(await text(page, '剪貼簿記錄和「通用剪貼板」可能會保留設定碼'), 'clipboard warning shown after copy')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  check(await gone(page, 'K7QM-2XPA'), 'hides when the window is hidden')
  check(!(await page.locator('.qr-svg').count()), 'QR removed from DOM when hidden')
  await page.context().close()
}

await browser.close()
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)

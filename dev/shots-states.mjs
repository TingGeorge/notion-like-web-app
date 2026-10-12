// Screenshots of the error and confirmation states (desktop and phone, light).
//   node dev/shots-states.mjs <outDir> [baseUrl]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const out = process.argv[2]
const base = process.argv[3] ?? 'http://localhost:5173/dev/setup.html'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()

for (const [size, viewport, frame] of [
  ['desktop', { width: 1440, height: 900 }, ''],
  ['phone', { width: 393, height: 852 }, '&frame=phone'],
]) {
  const ctx = await browser.newContext({ viewport })
  const open = async (hash) => {
    const page = await ctx.newPage()
    await page.goto(`${base}?theme=light${frame}${hash}`)
    return page
  }
  const shot = (page, name) => page.screenshot({ path: `${out}/${size}-light-state-${name}.png` })

  let page = await open('#/setup/connect')
  await page.fill('#setup-token', 'hello')
  await page.locator('#setup-token').blur()
  await shot(page, '1-invalid-token')
  await page.fill('#setup-token', 'github_pat_bad')
  await page.getByRole('button', { name: '連結', exact: true }).click()
  await page.getByText('token 無效或已過期').waitFor()
  await shot(page, '2-token-401')
  await page.fill('#setup-token', 'ghp_classicToken')
  await page.getByRole('button', { name: '連結', exact: true }).click()
  await page.getByText('這是 classic token').waitFor()
  await shot(page, '3-classic-warning')
  await page.getByRole('button', { name: '仍要使用' }).click()
  await page.locator('.repo-row').first().waitFor()
  await page.waitForTimeout(900)
  await page.getByRole('radio', { name: /blog/ }).click()
  await page.getByRole('button', { name: '使用這個 repo' }).click()
  await page.getByText('公開的 repo 任何人都看得到你的筆記').waitFor()
  await shot(page, '4-public-confirm')
  await page.getByRole('button', { name: '取消' }).click()
  await page.getByRole('radio', { name: /no-access/ }).click()
  await page.getByRole('button', { name: '使用這個 repo' }).click()
  await page.getByText('這把 token 沒有這個 repo 的寫入權限').waitFor()
  await shot(page, '5-no-access')
  await page.close()

  page = await open('#/setup/scan')
  await page.getByRole('button', { name: '改用設定碼' }).click()
  await page.locator('textarea').fill(await page.evaluate(() => window.__payload))
  await page.getByRole('button', { name: '繼續' }).click()
  await page.locator('.pair-box').first().click()
  await page.keyboard.type('AAAAAAAA')
  await page.getByText('還可以再試 2 次').waitFor()
  await shot(page, '6-wrong-code')
  await page.close()
  await ctx.close()
}
await browser.close()

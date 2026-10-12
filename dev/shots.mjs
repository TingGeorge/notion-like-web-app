// Screenshots of every setup/link screen from the dev harness (`npm run dev` must be running).
//   node dev/shots.mjs <outDir> [baseUrl]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const out = process.argv[2]
const base = process.argv[3] ?? 'http://localhost:5173/dev/setup.html'
mkdirSync(out, { recursive: true })

const sizes = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 393, height: 852 },
}
const TOKEN = 'github_pat_11ABCDEFG0xxxxxxxxxxxxxxxxxxxx'

const browser = await chromium.launch()

async function run(size, theme) {
  const ctx = await browser.newContext({ viewport: sizes[size], deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] })
  const frame = size === 'phone' ? '&frame=phone' : ''
  const open = async (query, hash = '') => {
    const page = await ctx.newPage()
    await page.goto(`${base}?theme=${theme}${frame}${query}${hash}`)
    await page.waitForTimeout(250)
    return page
  }
  const shot = (page, name) => page.screenshot({ path: `${out}/${size}-${theme}-${name}.png` })

  let page = await open('', '#/setup/welcome')
  await shot(page, '01-welcome')
  await page.close()

  if (size === 'phone') {
    page = await open('&ios=1&mock=1', '#/setup/welcome')
    await shot(page, '02-add-to-home')
    await page.close()
  }

  page = await open('&freeze=128', '#/setup/connect')
  await page.fill('#setup-token', TOKEN)
  await page.waitForTimeout(300)
  await shot(page, '03-connect')
  await page.getByRole('button', { name: '連結', exact: true }).click()
  await page.locator('.repo-row').first().waitFor()
  await page.waitForTimeout(900)
  await shot(page, '04-choose-repo')
  await page.getByRole('button', { name: '使用這個 repo' }).click()
  await page.locator('.progress').waitFor()
  await page.waitForTimeout(700)
  await shot(page, '05-first-sync')
  await page.close()

  page = await open('', '#/setup/welcome')
  page.on('dialog', () => {})
  await page.close()

  page = await open('&view=link')
  await shot(page, '06-link-before')
  await page.getByRole('button', { name: '顯示 QR code' }).click()
  await page.getByText('秒後自動隱藏').waitFor()
  await page.waitForTimeout(1500)
  await shot(page, '07-link-dialog')
  await page.close()

  page = await open('', '#/setup/scan')
  await shot(page, '08-scan')
  await page.getByRole('button', { name: '改用設定碼' }).click()
  await page.locator('textarea').fill(await page.evaluate(() => window.__payload))
  await shot(page, '09-paste')
  await page.getByRole('button', { name: '繼續' }).click()
  await page.locator('.pair-box').first().waitFor()
  await page.locator('.pair-box').first().click()
  await page.keyboard.type('K7QM2XPA')
  await page.getByText('即將連結').waitFor()
  await page.waitForTimeout(400)
  await shot(page, '10-pairing-code')
  await page.close()

  await ctx.close()
}

for (const size of ['desktop', 'phone']) for (const theme of ['light', 'dark']) await run(size, theme)
await browser.close()

/** Search (UI-9): Ctrl+K, Chinese text, title > heading > body, filters, Enter opens. */
import { BASE_URL, attachFake, expect, makeFake, test, modKey } from './fixtures'
import { openFromSidebar, setupDevice, titleInput } from './helpers'

const FILES = {
  '咖啡.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W01\n---\n關於咖啡的一頁。\n',
  '早晨的習慣.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W02\n---\n# 起床\n\n## 咖啡豆的選擇\n\n淺焙比較酸。\n',
  '採購清單.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W03\n---\n今天要買牛奶、麵包和咖啡。\n',
  '會議記錄.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W04\n---\n討論季度目標。\n',
  '無關.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W05\n---\n完全不相干的內容 hello world。\n',
}

test('Chinese search ranks title, then heading, then body; Enter opens the first result', async ({ browser }) => {
  const fake = await makeFake({ files: FILES })
  const context = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-TW', timezoneId: 'Asia/Taipei', serviceWorkers: 'block' })
  await attachFake(context, fake)
  const page = await context.newPage()
  await setupDevice(page)

  await page.keyboard.press(`${await modKey(page)}+K`)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.getByPlaceholder('搜尋頁面…').fill('咖啡')
  const rows = dialog.locator('.search-row-title')
  await expect(rows).toHaveText(['咖啡', '早晨的習慣', '採購清單'])
  // The snippet shows the match in medium weight.
  await expect(dialog.locator('.search-row').nth(1).locator('mark')).toContainText('咖啡')
  await expect(dialog.locator('.search-row').nth(2).locator('mark')).toContainText('咖啡')
  await expect(dialog.getByText('討論季度目標')).toHaveCount(0)

  // ↓ then Enter opens the second result; Enter alone opens the first.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(titleInput(page)).toHaveValue('早晨的習慣')

  await page.keyboard.press(`${await modKey(page)}+K`)
  await page.getByPlaceholder('搜尋頁面…').fill('咖啡')
  await expect(page.locator('.search-row-title').first()).toHaveText('咖啡')
  await page.keyboard.press('Enter')
  await expect(titleInput(page)).toHaveValue('咖啡')

  // A single character matches by prefix; words inside the title match too.
  await page.keyboard.press(`${await modKey(page)}+K`)
  await page.getByPlaceholder('搜尋頁面…').fill('會')
  await expect(page.locator('.search-row-title')).toHaveText(['會議記錄'])
  await page.getByPlaceholder('搜尋頁面…').fill('記錄')
  await expect(page.locator('.search-row-title')).toHaveText(['會議記錄'])
  // Characters that are not adjacent do not match.
  await page.getByPlaceholder('搜尋頁面…').fill('會錄')
  await expect(page.getByText('找不到符合的頁面')).toBeVisible()
  // Latin text in the body.
  await page.getByPlaceholder('搜尋頁面…').fill('hello')
  await expect(page.locator('.search-row-title')).toHaveText(['無關'])

  // 「只搜尋標題」.
  await page.getByPlaceholder('搜尋頁面…').fill('咖啡')
  await page.getByRole('button', { name: '只搜尋標題' }).click()
  await expect(page.locator('.search-row-title')).toHaveText(['咖啡'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await context.close()
})

test('search finds a page typed on this device right away, and the empty query lists recent pages', async ({ page }) => {
  await setupDevice(page)
  await page.keyboard.press(`${await modKey(page)}+Alt+KeyN`)
  await titleInput(page).fill('剛打的標題')
  await titleInput(page).press('Enter')
  await page.keyboard.type('獨特的內文詞彙')
  await page.waitForTimeout(500)
  await openFromSidebar(page, '歡迎使用')
  await page.keyboard.press(`${await modKey(page)}+P`)
  await expect(page.locator('.search-section')).toHaveText('最近造訪')
  await expect(page.locator('.search-row-title').first()).toHaveText('歡迎使用')
  await page.getByPlaceholder('搜尋頁面…').fill('獨特')
  await expect(page.locator('.search-row-title')).toHaveText(['剛打的標題'])
  await page.keyboard.press('Enter')
  await expect(titleInput(page)).toHaveValue('剛打的標題')
})

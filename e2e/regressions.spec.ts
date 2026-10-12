import { REPO, expect, setupWorkspace, test } from './fixtures'

test('leaving a page never renames it (title committed only when edited)', async ({ page, fake }) => {
  await fake.commit(REPO, { files: { '京都旅行計畫.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2KYT\n---\n清水寺\n' }, message: 'seed' })
  await setupWorkspace(page)
  await page.locator('.sidebar').getByText('京都旅行計畫').click()
  await expect(page.getByText('清水寺')).toBeVisible()
  // Leave the page in several ways.
  await page.keyboard.press('Control+Alt+n')
  await page.locator('.page-title-input:focus').waitFor()
  await page.keyboard.type('新頁')
  await page.keyboard.press('Enter')
  await page.locator('.sidebar').getByText('京都旅行計畫').click()
  await page.getByRole('button', { name: '首頁' }).click()
  await expect(page.locator('.sidebar .tree-title')).toHaveText(['京都旅行計畫', '新頁'])
  await page.locator('.sync-status').first().click()
  await expect(page.locator('.sync-status').first()).toHaveText('已同步', { timeout: 15_000 })
  expect(await fake.readFile(REPO, '京都旅行計畫.md')).toBe('---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2KYT\n---\n清水寺\n')
  expect(await fake.readFile(REPO, '未命名.md')).toBeNull()
})

import { expect, setupWorkspace, test, REPO } from './fixtures'

test('setup with an empty repo creates 歡迎使用 and shows it', async ({ page, fake }) => {
  await setupWorkspace(page)
  await expect(page.getByText('歡迎使用').first()).toBeVisible()
  expect(await fake.readFile(REPO, '歡迎使用.md')).toContain('這裡是你的筆記本')
})

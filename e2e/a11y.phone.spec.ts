/** NFR-3 on the iPhone layout (M01–M22): key screens pass WCAG 2.1 A/AA in light and dark. */
import { REPO, expect, test } from './fixtures'
import { editor, expectAccessible, setupDevice, titleInput } from './helpers'

for (const scheme of ['light', 'dark'] as const) {
  test(`phone screens pass WCAG AA in ${scheme} mode`, async ({ page, fake }) => {
    await fake.commit(REPO, {
      files: {
        '工作.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W01\n---\n- [x] 完成\n- [ ] <span data-color="orange">待辦</span>\n',
        '工作/會議記錄.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2W02\n---\n討論事項\n',
      },
      message: 'seed',
    })
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('./')
    await expect(page.getByRole('button', { name: /開始設定|仍要在 Safari 使用/ }).first()).toBeVisible()
    await expectAccessible(page, 'welcome')
    await setupDevice(page)

    await expectAccessible(page, 'home')
    await page.locator('.tabbar').getByRole('button', { name: '所有頁面' }).tap()
    await expect(page.getByText('工作', { exact: true }).first()).toBeVisible()
    await expectAccessible(page, 'all pages')
    await page.getByText('工作', { exact: true }).first().tap()
    await expect(page.getByText('待辦')).toBeVisible()
    await expectAccessible(page, 'page')
    await page.locator('.m-page-actions').getByRole('button', { name: '頁面選單' }).tap()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectAccessible(page, 'page menu sheet')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator('.m-page-back').tap()

    await page.locator('.tabbar').getByRole('button', { name: '新增' }).tap()
    await expect(titleInput(page)).toBeFocused()
    await titleInput(page).press('Enter')
    await expect(editor(page)).toBeFocused()
    await expectAccessible(page, 'new page with the keyboard toolbar')
    await page.getByRole('toolbar', { name: '編輯工具列' }).getByRole('button', { name: '插入區塊' }).tap()
    await expect(page.getByRole('dialog', { name: '插入區塊' })).toBeVisible()
    await expectAccessible(page, 'insert-block sheet')
  })
}

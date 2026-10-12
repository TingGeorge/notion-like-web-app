/**
 * NFR-3 on the desktop layout: every key screen, in light and dark, has no WCAG 2.1 A/AA violation
 * that axe finds (contrast, names of icon-only buttons, roles), and keyboard focus is visible.
 */
import { REPO, TOKEN, expect, test } from './fixtures'
import { editor, expectAccessible, openSettings, setupDevice } from './helpers'

const RICH = [
  '# 標題一',
  '',
  '一段**粗體**、*斜體*、<span data-color="orange">橘字</span>、<span data-color="red">紅字</span>、<span data-bg="yellow">黃底</span>和[連結](https://example.com)。',
  '',
  '- [ ] 待辦',
  '- [x] 完成',
  '',
  '> [!TIP]',
  '> 提示',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '| 甲 | 乙 |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
].join('\n')

for (const scheme of ['light', 'dark'] as const) {
  test(`desktop screens pass WCAG AA in ${scheme} mode`, async ({ page, fake }) => {
    await fake.commit(REPO, { files: { '豐富.md': `---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2RCH\n---\n${RICH}` }, message: 'seed' })
    await page.emulateMedia({ colorScheme: scheme })

    // D01, D12–D14.
    await page.goto('./')
    await expect(page.getByRole('button', { name: '開始設定' })).toBeVisible()
    await expectAccessible(page, 'welcome')
    await page.getByRole('button', { name: '開始設定' }).click()
    await expect(page.getByLabel('GitHub token')).toBeVisible()
    await expectAccessible(page, 'connect GitHub')
    await page.getByLabel('GitHub token').fill(TOKEN)
    await page.getByRole('button', { name: '連結', exact: true }).click()
    await expect(page.getByText(REPO)).toBeVisible()
    await expectAccessible(page, 'choose repo')
    await page.getByText(REPO).click()
    await page.getByRole('button', { name: '使用這個 repo' }).click()
    await expect(page.getByRole('button', { name: '開始使用' })).toBeEnabled({ timeout: 30_000 })
    await expectAccessible(page, 'first sync')
    await page.getByRole('button', { name: '開始使用' }).click()

    // D02: home, a page with every kind of block, and the editor's menus.
    await expect(page.locator('.home')).toBeVisible()
    await expectAccessible(page, 'home')
    await page.locator('.sidebar').getByText('豐富').click()
    await expect(page.getByText('提示')).toBeVisible()
    await expectAccessible(page, 'page')
    await page.getByText('一段').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await expect(page.locator('.gn-slash')).toBeVisible()
    await expectAccessible(page, '/ menu')
    await page.keyboard.press('Escape')
    await page.getByText('粗體').dblclick()
    await expect(page.getByRole('toolbar', { name: '文字格式' })).toBeVisible()
    await expectAccessible(page, 'format toolbar')
    await page.keyboard.press('Escape')
    // Collapse the selection: its highlight under coloured text is a passing state of the user's.
    await page.keyboard.press('ArrowRight')

    // Overlays.
    await page.locator('.topbar').getByRole('button', { name: '頁面選單' }).click()
    await expectAccessible(page, 'page menu')
    await page.getByRole('menuitem', { name: '頁面歷史' }).click()
    await expect(page.getByRole('dialog', { name: '頁面歷史' })).toBeVisible()
    await expect(page.locator('.history-row').first()).toBeVisible()
    await expectAccessible(page, 'page history')
    await page.keyboard.press('Escape')
    await page.locator('.sidebar .sb-nav-row', { hasText: '搜尋' }).click()
    await page.keyboard.type('提示')
    await expect(page.locator('.search-row').first()).toBeVisible()
    await expectAccessible(page, 'search')
    await page.keyboard.press('Escape')
    await openSettings(page)
    await expectAccessible(page, 'settings')
    await page.locator('.settings-nav-row', { hasText: '同步與儲存' }).click()
    await page.locator('.settings-content').getByRole('button', { name: '顯示 QR code' }).click()
    const link = page.getByRole('dialog', { name: '連結新裝置' })
    await link.getByRole('button', { name: '顯示 QR code' }).click()
    await expect(link.locator('.link-code')).toBeVisible()
    await expectAccessible(page, 'link a device')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.locator('.sidebar .sb-footer').getByRole('button', { name: '垃圾桶' }).click()
    await expectAccessible(page, 'trash')
    await page.keyboard.press('Escape')
    await expect(editor(page)).toBeVisible()
  })
}

test('keyboard focus is visible (NFR-3)', async ({ page, fake }) => {
  await fake.commit(REPO, { files: { '豐富.md': `---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2RCH\n---\n${RICH}` }, message: 'seed' })
  await page.goto('./')
  await expect(page.getByRole('button', { name: '開始設定' })).toBeVisible()
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const style = getComputedStyle(el)
    return { tag: el.tagName, style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
  })
  expect(outline.tag).not.toBe('BODY')
  expect(outline.style).toBe('solid')
  expect(outline.width).toBeGreaterThanOrEqual(2)
})

test('the sidebar page tree works with the arrow keys (NFR-3)', async ({ page, fake }) => {
  await fake.commit(REPO, { files: { 'A 專案.md': 'a\n', 'A 專案/A1 會議.md': 'a1\n', 'B 讀書.md': 'b\n' }, message: 'seed' })
  await setupDevice(page)
  const link = (title: string) => page.locator('.sidebar .tree-link', { hasText: new RegExp(`^${title}$`) })
  const focused = () => page.evaluate(() => document.activeElement?.textContent ?? '')
  await link('A 專案').focus()
  // → expands, ↓ walks into the child, ← on a child goes to its parent, ← again collapses.
  await page.keyboard.press('ArrowRight')
  await expect(link('A1 會議')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  expect(await focused()).toBe('A1 會議')
  await page.keyboard.press('ArrowLeft')
  expect(await focused()).toBe('A 專案')
  await page.keyboard.press('ArrowLeft')
  await expect(link('A1 會議')).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  expect(await focused()).toBe('B 讀書')
  await page.keyboard.press('ArrowUp')
  expect(await focused()).toBe('A 專案')
  // Enter opens the page, as any link.
  await page.keyboard.press('Enter')
  await expect(page.locator('.breadcrumb-item.is-current')).toContainText('A 專案')
})

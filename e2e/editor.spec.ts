/**
 * Editor round trip (§3.4, §7, UI-7): every block type typed through Markdown shortcuts and the `/` menu,
 * the Markdown that reaches the repo, and the blocks rendering back after a reload.
 */
import type { Page } from '@playwright/test'
import { expect, test, modKey } from './fixtures'
import {
  assetPaths,
  bodyOf,
  commitCount,
  createPage,
  editor,
  forceSync,
  readRepoFile,
  setupDevice,
  syncAndWaitForCommit,
  threeImages,
  titleInput,
  waitSynced,
} from './helpers'


async function enter(page: Page, times = 1) {
  for (let i = 0; i < times; i++) await page.keyboard.press('Enter')
}

async function slash(page: Page, query: string) {
  await page.keyboard.type(`/${query}`)
  await expect(page.getByRole('listbox', { name: '插入區塊' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox', { name: '插入區塊' })).toHaveCount(0)
}

async function bodyInRepo(fake: Parameters<typeof readRepoFile>[0], path: string): Promise<string> {
  return bodyOf(await readRepoFile(fake, path))
}

test('Markdown shortcuts produce the Markdown of §3.4, and the blocks render back after a reload', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '區塊')
  const k = page.keyboard

  await k.type('# 標題一')
  await enter(page)
  await k.type('## 標題二')
  await enter(page)
  await k.type('### 標題三')
  await enter(page)
  // Bulleted list: `- `; Enter twice leaves the list.
  await k.type('- 項目一')
  await enter(page)
  await k.type('項目二')
  await enter(page, 2)
  // Numbered list.
  await k.type('1. 第一')
  await enter(page)
  await k.type('第二')
  await enter(page, 2)
  // To-do: `[] `; ⌘Enter (Ctrl+Enter) checks it.
  await k.type('[] 待辦')
  await enter(page)
  await k.type('做完')
  await k.press(`${await modKey(page)}+Enter`)
  await enter(page, 2)
  // Toggle: `> ` (Notion), Enter opens it and creates the first child.
  await k.type('> 摺疊標題')
  await enter(page)
  await k.type('摺疊內容')
  await enter(page, 3)
  // Quote: `" `.
  await k.type('" 引用文字')
  await enter(page, 2)
  // Code block: ``` then a language.
  await k.type('```')
  await page.locator('.code-language').selectOption('javascript')
  await page.locator('.code-content').click()
  await k.type('const a = 1')
  await enter(page)
  await k.type('const b = "2"')
  await k.press(`${await modKey(page)}+Enter`)
  // Divider.
  await k.type('---')
  // Inline marks.
  await k.type('**粗體** *斜體* ~刪除~ `行內碼` 一般')
  await page.waitForTimeout(400)

  const before = commitCount(fake)
  await syncAndWaitForCommit(page, fake, before)
  const expected = [
    '# 標題一',
    '',
    '## 標題二',
    '',
    '### 標題三',
    '',
    '- 項目一',
    '- 項目二',
    '',
    '1. 第一',
    '2. 第二',
    '',
    '- [ ] 待辦',
    '- [x] 做完',
    '',
    '<details>',
    '<summary>摺疊標題</summary>',
    '',
    '摺疊內容',
    '',
    '</details>',
    '',
    '> 引用文字',
    '',
    '```javascript',
    'const a = 1',
    'const b = "2"',
    '```',
    '',
    '---',
    '',
    '**粗體** *斜體* ~~刪除~~ `行內碼` 一般',
    '',
  ].join('\n')
  expect(await bodyInRepo(fake, '區塊.md')).toBe(expected)

  // Reload: the Markdown becomes the same blocks again.
  await page.reload()
  const ed = editor(page)
  await expect(ed.locator('h1')).toHaveText('標題一')
  await expect(ed.locator('h2')).toHaveText('標題二')
  await expect(ed.locator('h3')).toHaveText('標題三')
  await expect(ed.locator('ul > li:not(.todo) p')).toHaveText(['項目一', '項目二'])
  await expect(ed.locator('ol > li p')).toHaveText(['第一', '第二'])
  await expect(ed.locator('li.todo')).toHaveCount(2)
  await expect(ed.locator('li.todo').nth(0)).toHaveAttribute('data-checked', 'false')
  await expect(ed.locator('li.todo').nth(1)).toHaveAttribute('data-checked', 'true')
  await expect(ed.locator('.toggle .toggle-summary')).toHaveText('摺疊標題')
  await expect(ed.locator('.toggle .toggle-body p')).toHaveText('摺疊內容')
  await expect(ed.locator('blockquote')).toHaveText('引用文字')
  await expect(ed.locator('.code-content')).toHaveText('const a = 1\nconst b = "2"')
  await expect(ed.locator('.code-language')).toHaveValue('javascript')
  await expect(ed.locator('hr')).toHaveCount(1)
  await expect(ed.locator('strong')).toHaveText('粗體')
  await expect(ed.locator('em')).toHaveText('斜體')
  await expect(ed.locator('s')).toHaveText('刪除')
  await expect(ed.locator('p code')).toHaveText('行內碼')

  // Nothing was changed by loading, so nothing is pushed (DATA-16: serialize(parse(md)) == md).
  await forceSync(page)
  expect(commitCount(fake)).toBe(before + 1)
  expect(await bodyInRepo(fake, '區塊.md')).toBe(expected)
})

test('the `/` menu inserts every block type', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '斜線')
  const k = page.keyboard

  await slash(page, 'h1')
  await k.type('大標')
  await enter(page)
  await slash(page, 'h2')
  await k.type('中標')
  await enter(page)
  await slash(page, 'h3')
  await k.type('小標')
  await enter(page)
  await slash(page, 'bullet')
  await k.type('點一')
  await enter(page, 2)
  await slash(page, 'number')
  await k.type('一號')
  await enter(page, 2)
  await slash(page, 'todo')
  await k.type('要做')
  await enter(page, 2)
  await slash(page, 'toggle')
  await k.type('收起來')
  await enter(page)
  await k.type('裡面')
  await enter(page, 3)
  await slash(page, 'quote')
  await k.type('名言')
  await enter(page, 2)
  await slash(page, 'callout')
  await k.type('注意')
  await enter(page, 2)
  await slash(page, 'divider')
  await slash(page, 'code')
  await k.type('x = 1')
  await k.press(`${await modKey(page)}+Enter`)
  await slash(page, 'table')
  for (const cell of ['甲', '乙', '丙', '1', '2', '3', '4', '5']) {
    await k.type(cell)
    await k.press('Tab')
  }
  await k.type('6')
  await page.waitForTimeout(400)

  await syncAndWaitForCommit(page, fake)
  const expected = [
    '# 大標',
    '',
    '## 中標',
    '',
    '### 小標',
    '',
    '- 點一',
    '',
    '1. 一號',
    '',
    '- [ ] 要做',
    '',
    '<details>',
    '<summary>收起來</summary>',
    '',
    '裡面',
    '',
    '</details>',
    '',
    '> 名言',
    '',
    '> [!NOTE]',
    '> 注意',
    '',
    '---',
    '',
    '```',
    'x = 1',
    '```',
    '',
    '| 甲 | 乙 | 丙 |',
    '| --- | --- | --- |',
    '| 1 | 2 | 3 |',
    '| 4 | 5 | 6 |',
    '',
  ].join('\n')
  expect(await bodyInRepo(fake, '斜線.md')).toBe(expected)

  await page.reload()
  const ed = editor(page)
  await expect(ed.locator('.callout')).toHaveAttribute('data-kind', 'NOTE')
  await expect(ed.locator('.callout .callout-body')).toHaveText('注意')
  await expect(ed.locator('table tr')).toHaveCount(3)
  await expect(ed.locator('table th')).toHaveText(['甲', '乙', '丙'])
  await expect(ed.locator('hr')).toHaveCount(1)
  await expect(ed.locator('.toggle')).toHaveCount(1)
})

test('the `/` menu filters by Chinese name and English alias, full-width slash, and closes as UI-7 says', async ({ page }) => {
  await setupDevice(page)
  await createPage(page, '選單')
  const menu = page.getByRole('listbox', { name: '插入區塊' })
  const options = menu.getByRole('option')

  await page.keyboard.type('/')
  await expect(menu).toBeVisible()
  await expect(options).toHaveCount(17)
  // Chinese name.
  await page.keyboard.type('標題')
  await expect(options).toHaveText([/標題 1/, /標題 2/, /標題 3/])
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  // Esc keeps the typed text.
  await expect(editor(page)).toContainText('/標題')
  await page.keyboard.press(`${await modKey(page)}+A`)
  await page.keyboard.press('Backspace')

  // English alias, case- and width-insensitive; the full-width slash opens it too.
  await page.keyboard.type('／ＨＲ')
  await expect(options).toHaveText([/分隔線/])
  await page.keyboard.press(`${await modKey(page)}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type('／Ｈ１')
  await expect(options).toHaveText([/標題 1/])
  await page.keyboard.press(`${await modKey(page)}+A`)
  await page.keyboard.press('Backspace')

  // A space closes it.
  await page.keyboard.type('/to')
  await expect(options).toHaveCount(2)
  await page.keyboard.type(' ')
  await expect(menu).toHaveCount(0)
  await page.keyboard.press(`${await modKey(page)}+A`)
  await page.keyboard.press('Backspace')

  // No match for three more characters closes it.
  await page.keyboard.type('/zzz')
  await expect(menu).toHaveCount(0)
  await page.keyboard.press(`${await modKey(page)}+A`)
  await page.keyboard.press('Backspace')

  // ↑/↓ move, Enter inserts.
  await page.keyboard.type('/h')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(editor(page).locator('h2, h3, h1')).toHaveCount(1)

  // Not in code blocks.
  await page.keyboard.press(`${await modKey(page)}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type('```')
  await page.keyboard.type('/')
  await expect(menu).toHaveCount(0)
  await expect(editor(page).locator('.code-content')).toContainText('/')
})

test('the page title field and Enter: Enter moves to the body, the body is not lost', async ({ page, fake }) => {
  await setupDevice(page)
  await page.keyboard.press(`${await modKey(page)}+Alt+KeyN`)
  await titleInput(page).fill('標題欄')
  await titleInput(page).press('Enter')
  await expect(editor(page)).toBeFocused()
  await page.keyboard.type('內文')
  await page.waitForTimeout(400)
  await syncAndWaitForCommit(page, fake)
  expect(await bodyInRepo(fake, '標題欄.md')).toBe('內文\n')
  await waitSynced(page)
})

test('several images picked at once from the / menu all land in the page (UI-18)', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '多張圖片', '上面\n')
  // The caret is on an empty line: the first image takes its place.
  const chooser = page.waitForEvent('filechooser')
  await slash(page, '圖片')
  const fc = await chooser
  expect(fc.isMultiple()).toBe(true)
  await fc.setFiles(threeImages())
  await expect(editor(page).locator('img')).toHaveCount(3)
  await expect(editor(page).locator('.upload-placeholder')).toHaveCount(0)
  await page.waitForTimeout(400)
  await syncAndWaitForCommit(page, fake)
  const assets = assetPaths(fake)
  expect(assets).toHaveLength(3)
  const body = await bodyInRepo(fake, '多張圖片.md')
  const links = [...body.matchAll(/!\[\]\(([^)]+)\)/g)].map((m) => m[1])
  expect(links).toHaveLength(3)
  expect(body.startsWith('上面\n\n![](')).toBe(true)
  expect(links.map((l) => decodeURIComponent(l).replace(/^\.?\//, '')).sort()).toEqual([...assets].sort())
})

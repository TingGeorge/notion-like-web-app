/**
 * IME composition (UI-17): Markdown shortcuts, the `/` menu and Enter must not act while composing, and must
 * work after `compositionend`. Real composition events come from Chromium's `Input.imeSetComposition`.
 */
import type { CDPSession, Page } from '@playwright/test'
import { expect, test, modKey } from './fixtures'
import { bodyOf, createPage, editor, readRepoFile, setupDevice, syncAndWaitForCommit, titleInput } from './helpers'

// Composition is driven through CDP, which only Chromium has; the editor's composition handling is
// also covered by the unit tests in src/editor/ime.test.ts.
test.skip(({ browserName }) => browserName !== 'chromium', 'IME composition is simulated through Chromium CDP')

async function ime(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page)
}

/** Show `text` as the (uncommitted) composition. */
const compose = (client: CDPSession, text: string) => client.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
/** End the composition with `text` as the result. */
const commit = (client: CDPSession, text: string) => client.send('Input.insertText', { text })

test('the editor: shortcuts wait for compositionend, then work; no text is lost', async ({ page, fake }) => {
  await setupDevice(page)
  await createPage(page, '輸入法')
  const client = await ime(page)
  const events = await page.evaluate(() => {
    const log: string[] = []
    ;(window as unknown as { __ime: string[] }).__ime = log
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(type, () => log.push(type), true)
    return log
  })
  expect(events).toEqual([])

  // `# ` through an IME: still a paragraph while composing, a heading once it ends.
  await compose(client, '#')
  await compose(client, '# ')
  await expect(editor(page).locator('p').first()).toContainText('#')
  await expect(editor(page).locator('h1')).toHaveCount(0)
  await commit(client, '# ')
  await expect(editor(page).locator('h1')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __ime: string[] }).__ime)).toEqual(expect.arrayContaining(['compositionstart', 'compositionupdate', 'compositionend']))

  // Zhuyin typing: the intermediate symbols and the final characters all arrive.
  await compose(client, 'ㄓ')
  await compose(client, 'ㄓㄨ')
  await compose(client, 'ㄓㄨˋ')
  await expect(editor(page).locator('h1')).toContainText('ㄓㄨˋ')
  await commit(client, '注')
  await compose(client, 'ㄧㄣ')
  await commit(client, '音')
  await expect(editor(page).locator('h1')).toHaveText('注音')

  // Enter during composition does not split the block; Enter afterwards does.
  const blocks = await editor(page).locator(':scope > *').count()
  await compose(client, 'ㄕ')
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror')!
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }))
  })
  await expect(editor(page).locator('h1')).toHaveCount(1)
  await expect(editor(page).locator(':scope > *')).toHaveCount(blocks)
  await commit(client, '詩')
  await expect(editor(page).locator('h1')).toHaveText('注音詩')
  await page.keyboard.press('Enter')

  // `/` typed through the IME (full-width ／): the menu waits for compositionend.
  await compose(client, '／')
  await expect(page.getByRole('listbox', { name: '插入區塊' })).toHaveCount(0)
  await commit(client, '／')
  await expect(page.getByRole('listbox', { name: '插入區塊' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Arrow keys during composition do not move a slash-menu selection, and `- ` works after the end.
  await page.keyboard.press(`${await modKey(page)}+A`)
  await page.keyboard.press('Backspace')
  await compose(client, '-')
  await compose(client, '- ')
  await expect(editor(page).locator('ul')).toHaveCount(0)
  await commit(client, '- ')
  await expect(editor(page).locator('ul > li')).toHaveCount(1)
  await compose(client, 'ㄒ')
  await commit(client, '項')
  await page.keyboard.type('目')

  await page.waitForTimeout(500)
  await syncAndWaitForCommit(page, fake)
  const body = bodyOf(await readRepoFile(fake, '輸入法.md'))
  expect(body).toBe('- 項目\n')
})

test('the title: Enter during composition stays in the title; after compositionend it moves to the body', async ({ page, fake }) => {
  await setupDevice(page)
  await page.keyboard.press(`${await modKey(page)}+Alt+KeyN`)
  await expect(titleInput(page)).toBeFocused()
  const client = await ime(page)
  await compose(client, 'ㄗ')
  await compose(client, 'ㄗㄨㄥ')
  await page.evaluate(() => {
    const el = document.querySelector('.page-title-input')!
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }))
  })
  await expect(titleInput(page)).toBeFocused()
  await commit(client, '總')
  await compose(client, 'ㄊㄧˊ')
  await commit(client, '題')
  await expect(titleInput(page)).toHaveValue('總題')
  await titleInput(page).press('Enter')
  await expect(editor(page)).toBeFocused()
  await compose(client, 'ㄋㄟˋ')
  await commit(client, '內')
  await page.keyboard.type('容')
  await page.waitForTimeout(500)
  await syncAndWaitForCommit(page, fake)
  expect(bodyOf(await readRepoFile(fake, '總題.md'))).toBe('內容\n')
})

import { launch, docJSON, selectText, check, OUT } from './lib.mjs'

const txt = (n) => (n.text ?? '') + (n.content ?? []).map(txt).join('')
const top = async (page) => (await docJSON(page)).content
const gn = (page, key) => page.evaluate((k) => window.__gn[k], key)

// --- Lists, Tab, Backspace, Enter ------------------------------------------------------------
{
  const { browser, page, errors } = await launch()
  await selectText(page, '做出頁面樹和編輯器', { caretAt: 'end' })
  await page.keyboard.press('Tab')
  let doc = await top(page)
  const todoList = doc.find((n) => n.type === 'bullet_list' && n.content[0].attrs.checked !== null)
  check('Tab indents a to-do under the previous item', todoList.content.length === 2 && todoList.content[0].content.length === 2, JSON.stringify(todoList.content.map((i) => i.content.length)))
  await page.keyboard.press('Shift+Tab')
  doc = await top(page)
  const todoList2 = doc.find((n) => n.type === 'bullet_list' && n.content[0].attrs.checked !== null)
  check('Shift+Tab outdents it', todoList2.content.length === 3)
  // Tab on a paragraph does nothing (DATA-13) and keeps focus.
  const before = JSON.stringify(await top(page))
  await selectText(page, '10/11 產品週會', { caretAt: 'end' })
  await page.keyboard.press('Tab')
  check('Tab on a paragraph does nothing', JSON.stringify(await top(page)) === before)
  check('focus stays in the editor after Tab', await page.evaluate(() => document.activeElement?.classList.contains('gn-prose')))
  await selectText(page, '標題 3', { caretAt: 'end' })
  await page.keyboard.press('Tab')
  check('Tab on a heading does nothing', JSON.stringify(await top(page)) === before)
  // Backspace at the start of a heading -> text.
  await selectText(page, '標題 3', { caretAt: 'start' })
  await page.keyboard.press('Backspace')
  doc = await top(page)
  const idx = doc.findIndex((n) => txt(n) === '標題 3')
  check('Backspace at the start of a heading turns it into text', doc[idx].type === 'paragraph')
  // Backspace at start of a list item -> text.
  await selectText(page, '第一版先把', { caretAt: 'start' })
  await page.keyboard.press('Backspace')
  doc = await top(page)
  check('Backspace at the start of a bullet turns it into text', doc.some((n) => n.type === 'paragraph' && txt(n).startsWith('第一版先把')))
  // Enter on a to-do creates an unchecked to-do.
  await selectText(page, '畫好 Figma 設計稿', { caretAt: 'end' })
  await page.keyboard.press('Enter')
  doc = await top(page)
  const tl = doc.find((n) => n.type === 'bullet_list' && n.content[0].attrs.checked !== null)
  check('Enter after a checked to-do creates an unchecked one', tl.content[0].attrs.checked === true && tl.content[1].attrs.checked === false)
  // Toggle: Enter at the end of the summary creates the first child.
  await selectText(page, 'Toggle 標題', { caretAt: 'end' })
  await page.keyboard.press('Enter')
  doc = await top(page)
  const tg = doc.find((n) => n.type === 'toggle' && txt(n.content[0]) === 'Toggle 標題')
  check('Enter at the end of a toggle summary creates the first child', tg.content[1].type === 'paragraph' && txt(tg.content[1]) === '' && tg.content.length === 4, String(tg.content.length))
  check('  caret is in the new child', await page.evaluate(() => window.__gn.handle.view.state.selection.$from.parent.type.name === 'paragraph' && window.__gn.handle.view.state.selection.$from.parent.content.size === 0))
  // Enter in a code block inserts a newline.
  await selectText(page, "const note = await", { caretAt: 'start' })
  await page.keyboard.press('Enter')
  doc = await top(page)
  const code = doc.find((n) => n.type === 'code_block')
  check('Enter in a code block inserts a newline', txt(code).startsWith('\nconst note'))
  await page.keyboard.press('Control+z')
  // Backspace at the very start of the doc and ArrowUp on the first line call onExitTop.
  await page.evaluate(() => document.getElementById('title').removeAttribute('data-exit'))
  await selectText(page, '10/11 產品週會', { caretAt: 'start' })
  await page.keyboard.press('ArrowUp')
  check('ArrowUp on the first line calls onExitTop', await page.evaluate(() => document.getElementById('title').hasAttribute('data-exit')))
  await page.evaluate(() => document.getElementById('title').removeAttribute('data-exit'))
  await selectText(page, '10/11 產品週會', { caretAt: 'start' })
  await page.keyboard.press('Backspace')
  check('Backspace at the very start calls onExitTop', await page.evaluate(() => document.getElementById('title').hasAttribute('data-exit')))
  console.log('errors', errors)
  await browser.close()
}

// --- Toggle, callout, checkbox, links --------------------------------------------------------
{
  const { browser, page, errors } = await launch()
  const changes0 = await gn(page, 'changes')
  const arrow = page.locator('.toggle-arrow').first()
  await arrow.click()
  let doc = await top(page)
  check('click on the arrow opens the toggle', doc.find((n) => n.type === 'toggle').attrs.open === true)
  check('toggle children are visible', await page.locator('.toggle').first().locator('.toggle-body > p').isVisible())
  check('toggling did not call onChange', (await gn(page, 'changes')) === changes0)
  await arrow.click()
  check('click again closes it', (await top(page)).find((n) => n.type === 'toggle').attrs.open === false)
  check('children hidden when closed', !(await page.locator('.toggle').first().locator('.toggle-body > p').isVisible()))
  // Undo does not bring toggle state back / does not create history.
  await arrow.click()
  await page.keyboard.press('Control+z')
  check('toggle open is not in undo history', (await top(page)).find((n) => n.type === 'toggle').attrs.open === true)
  await arrow.click()

  // Checkbox click.
  await page.locator('.todo-box').nth(1).click()
  doc = await top(page)
  const tl = doc.find((n) => n.type === 'bullet_list' && n.content[0].attrs.checked !== null)
  check('clicking a checkbox checks the to-do', tl.content[1].attrs.checked === true)
  await page.keyboard.press('Control+z')

  // Callout emoji picker.
  await page.locator('.callout-icon').click()
  await page.waitForSelector('.gn-emoji')
  await page.screenshot({ path: `${OUT}/emoji.png`, clip: { x: 340, y: 380, width: 560, height: 300 } })
  await page.locator('.gn-emoji', { hasText: '🧠' }).click()
  doc = await top(page)
  let callout = doc.find((n) => n.type === 'callout')
  check('emoji picker sets a custom icon (kind NOTE)', callout.attrs.icon === '🧠' && callout.attrs.kind === 'NOTE', JSON.stringify(callout.attrs))
  await page.locator('.callout-icon').click()
  await page.locator('.gn-emoji', { hasText: '⚠️' }).click()
  callout = (await top(page)).find((n) => n.type === 'callout')
  check('picking ⚠️ maps back to WARNING with the default icon', callout.attrs.kind === 'WARNING' && callout.attrs.icon === null, JSON.stringify(callout.attrs))

  // Links: internal -> openPage, external -> new tab with rel.
  await page.locator('.gn-prose a', { hasText: '站內連結' }).click()
  check('internal link opens inside the app', JSON.stringify(await gn(page, 'opened')) === '["/工作/專案%20A.md"]', JSON.stringify(await gn(page, 'opened')))
  const ext = page.locator('.gn-prose a', { hasText: '外部連結' })
  check('external link has rel=noopener noreferrer and target=_blank', (await ext.getAttribute('rel')) === 'noopener noreferrer' && (await ext.getAttribute('target')) === '_blank')
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 3000 }).catch(() => null), ext.click()])
  check('external link click opens a new tab', !!popup)
  popup?.close()
  // page link block
  await page.locator('.page-link-block').click()
  check('page link block opens the page', (await gn(page, 'opened')).length === 2)
  check('page link shows the live title from pageInfo', (await page.locator('.page-link-title').textContent()) === '專案 A')
  // file block download
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 3000 }).catch(() => null), page.locator('.file-block').click()])
  check('file block downloads (a[download], never navigates)', !!download)
  check('page did not navigate', page.url().includes('/dev/editor.html'))
  console.log('errors', errors)
  await browser.close()
}

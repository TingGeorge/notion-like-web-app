import { launch, selectText, OUT } from './lib.mjs'

for (const theme of ['light', 'dark']) {
  const { browser, page, errors } = await launch({ theme })
  await page.screenshot({ path: `${OUT}/desktop-${theme}.png` })

  // Block handle on a to-do row.
  const todo = page.locator('li.todo').nth(1)
  const box = await todo.boundingBox()
  await page.mouse.move(box.x + 120, box.y + 12)
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/desktop-${theme}-handle.png`, clip: { x: 300, y: 330, width: 800, height: 200 } })

  // Slash menu at the end of the todo list: add a paragraph with "/".
  await page.evaluate(() => {
    const view = window.__gn.handle.view
    view.focus()
  })
  await selectText(page, '完成 GitHub 同步與離線模式', { caretAt: 'end' })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter') // exit the list into a paragraph
  await page.keyboard.type('/')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/desktop-${theme}-slash.png` })
  await page.keyboard.press('Escape')

  // Format toolbar + colour menu.
  await selectText(page, 'GitHub private repo')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/desktop-${theme}-toolbar.png` })
  await page.locator('.gn-tb-color').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/desktop-${theme}-colors.png` })
  console.log(theme, 'errors', errors)
  await browser.close()
}

import { launch, docJSON, selectText, check, OUT } from './lib.mjs'

const txt = (n) => (n.text ?? '') + (n.content ?? []).map(txt).join('')
for (const theme of ['light', 'dark']) {
  const { browser, page, errors } = await launch({ mobile: true, theme })
  await page.screenshot({ path: `${OUT}/mobile-${theme}.png` })
  await selectText(page, '完成 GitHub 同步與離線模式', { caretAt: 'end' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/mobile-${theme}-bar.png` })
  if (theme === 'light') {
    check('keyboard bar visible when focused', await page.locator('.gn-kbbar').isVisible())
    const labels = await page.locator('.gn-kbbar button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    console.log(labels.join(' | '))
    check('bar buttons', labels.length === 9, String(labels.length))
  }
  // Insert sheet.
  await page.locator('.gn-kbbar [aria-label="插入區塊"]').tap()
  await page.waitForSelector('.gn-insert-sheet')
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${OUT}/mobile-${theme}-sheet.png` })
  if (theme === 'light') {
    await page.locator('.gn-sheet-item', { hasText: '分隔線' }).tap()
    await page.waitForTimeout(300)
    const doc = (await docJSON(page)).content
    check('sheet inserts a divider', doc.some((n) => n.type === 'horizontal_rule'))
  } else {
    await page.locator('.gn-sheet-close').tap()
  }
  await page.waitForTimeout(200)
  // Format bar.
  await selectText(page, 'GitHub private repo')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/mobile-${theme}-format.png` })
  if (theme === 'light') {
    check('format bar shows on selection', (await page.locator('.gn-kbbar .gn-kb-done').count()) === 1)
    await page.locator('.gn-kbbar [aria-label="粗體"]').tap()
    const doc = JSON.stringify((await docJSON(page)).content)
    check('bold from the format bar', doc.includes('"GitHub private repo"') && doc.includes('bold'))
    await page.locator('.gn-kbbar [aria-label="顏色"]').first().tap()
    await page.waitForSelector('.gn-sheet')
    await page.screenshot({ path: `${OUT}/mobile-${theme}-colors.png` })
    await page.locator('.gn-sheet [role=menuitem]', { hasText: '橙色' }).first().tap()
    check('colour from the sheet', JSON.stringify((await docJSON(page)).content).includes('"orange"'))
    await page.waitForTimeout(200)
    await page.locator('.gn-kbbar .gn-kb-done').tap()
    check('完成 collapses the selection', (await page.locator('.gn-kbbar .gn-kb-done').count()) === 0)
    // 待辦 / 清單 / 轉換成
    await selectText(page, '網站放在 GitHub Pages', { caretAt: 'end' })
    await page.locator('.gn-kbbar [aria-label="待辦清單"]').tap()
    check('待辦 turns the bullet into a to-do', JSON.stringify((await docJSON(page)).content).includes('"checked":false'))
    await page.locator('.gn-kbbar [aria-label="轉換成"]').tap()
    await page.waitForSelector('.gn-sheet')
    await page.screenshot({ path: `${OUT}/mobile-${theme}-turn.png` })
    await page.locator('.gn-sheet [role=menuitem]', { hasText: '標題 2' }).tap()
    check('轉換成 → 標題 2', (await docJSON(page)).content.some((n) => n.type === 'heading' && txt(n) === '網站放在 GitHub Pages，沒有伺服器'))
    await page.locator('.gn-kbbar [aria-label="復原"]').tap()
    check('復原 undoes', !(await docJSON(page)).content.some((n) => n.type === 'heading' && txt(n) === '網站放在 GitHub Pages，沒有伺服器'))
    await page.locator('.gn-kbbar [aria-label="收起鍵盤"]').tap()
    await page.waitForTimeout(300)
    check('收起鍵盤 blurs and hides the bar', (await page.locator('.gn-kbbar').count()) === 0)
    // image picker from camera button
    await selectText(page, '網站放在', { caretAt: 'end' })
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null), page.locator('.gn-kbbar [aria-label="拍照／圖片"]').tap()])
    check('拍照/圖片 opens an image file picker', !!chooser && (await chooser.isMultiple()) === false)
  }
  console.log(theme, 'errors', errors)
  await browser.close()
}

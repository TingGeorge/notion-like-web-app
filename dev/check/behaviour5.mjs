import { launch, docJSON, selectText, check, OUT } from './lib.mjs'

const txt = (n) => (n.text ?? '') + (n.content ?? []).map(txt).join('')
const top = async (page) => (await docJSON(page)).content
const gn = (page, key) => page.evaluate((k) => window.__gn[k], key)

// --- Empty page (D11) and hints ------------------------------------------------------------------
{
  const { browser, page, errors } = await launch({ empty: true })
  const ph = await page.locator('.gn-prose p.is-empty').getAttribute('data-placeholder')
  check('empty page shows the placeholder prop without focus', ph === '按 Enter 開始寫，或輸入「/」插入區塊', ph)
  await page.screenshot({ path: `${OUT}/empty-light.png`, clip: { x: 300, y: 0, width: 800, height: 200 } })
  await page.click('.gn-prose p')
  await page.keyboard.type('x')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const hint = await page.locator('.gn-prose p.is-empty').getAttribute('data-placeholder')
  check('focused empty paragraph shows 輸入「/」插入區塊', hint === '輸入「/」插入區塊', hint)
  await page.keyboard.type('## ')
  check('empty heading hint 標題 2', (await page.locator('h2.is-empty').getAttribute('data-placeholder')) === '標題 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- ')
  check('empty bullet hint 清單', (await page.locator('li p.is-empty').getAttribute('data-placeholder')) === '清單')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[] ')
  check('empty to-do hint 待辦事項', (await page.locator('li.todo p.is-empty').getAttribute('data-placeholder')) === '待辦事項')
  await page.screenshot({ path: `${OUT}/hints.png`, clip: { x: 300, y: 0, width: 800, height: 260 } })
  console.log('errors', errors)
  await browser.close()
}

// --- Read-only ------------------------------------------------------------------------------------
{
  const { browser, page, errors } = await launch({ readonly: true })
  check('read-only: contenteditable=false', (await page.locator('.gn-prose').getAttribute('contenteditable')) === 'false')
  await page.mouse.move(500, 300)
  await page.waitForTimeout(200)
  check('read-only: no block handle', (await page.locator('.gn-handle').count()) === 0)
  await page.locator('.gn-prose').click()
  await page.keyboard.type('zzz')
  check('read-only: typing does nothing', !(await gn(page, 'changes')))
  await page.locator('.toggle-arrow').first().click()
  check('read-only: toggles still open', (await top(page)).find((n) => n.type === 'toggle').attrs.open === true)
  await page.locator('.todo-box').nth(1).click()
  const tl = (await top(page)).find((n) => n.type === 'bullet_list' && n.content[0].attrs.checked !== null)
  check('read-only: checkboxes do not change', tl.content[1].attrs.checked === false)
  await page.locator('.gn-prose a', { hasText: '站內連結' }).click()
  check('read-only: links still open', (await gn(page, 'opened')).length === 1)
  console.log('errors', errors)
  await browser.close()
}

// --- replaceDoc keeps the caret, no onChange ------------------------------------------------------
{
  const { browser, page, errors } = await launch()
  await selectText(page, '網站放在 GitHub Pages', { caretAt: 'end' })
  const before = await page.evaluate(() => {
    const v = window.__gn.handle.view
    const $h = v.state.selection.$head
    return { idx: $h.index(0), off: $h.parentOffset }
  })
  const changes0 = await gn(page, 'changes')
  await page.evaluate(() => {
    const h = window.__gn.handle
    const json = h.getDoc().toJSON()
    // Remote edit: change the first paragraph and the heading above the caret.
    json.content[0].content[0].text = '遠端改過的第一段。'
    json.content[1].content[0].text = '決議事項（遠端）'
    h.replaceDoc(h.getDoc().type.schema.nodeFromJSON(json))
  })
  const after = await page.evaluate(() => {
    const v = window.__gn.handle.view
    const $h = v.state.selection.$head
    return { idx: $h.index(0), off: $h.parentOffset, text: v.state.doc.child(0).textContent }
  })
  check('replaceDoc applied', after.text === '遠端改過的第一段。')
  check('replaceDoc keeps the caret block index and offset', after.idx === before.idx && after.off === before.off, JSON.stringify([before, after]))
  check('replaceDoc does not call onChange', (await gn(page, 'changes')) === changes0)
  await page.keyboard.press('Control+z')
  check('replaceDoc is not undoable', (await page.evaluate(() => window.__gn.handle.view.state.doc.child(0).textContent)) === '遠端改過的第一段。')
  console.log('errors', errors)
  await browser.close()
}

// --- Drop a file -------------------------------------------------------------------------------------
{
  const { browser, page, errors } = await launch()
  const target = await page.locator('.gn-prose li', { hasText: '網站放在' }).boundingBox()
  await page.evaluate(
    ([x, y]) => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'dropped.png', { type: 'image/png' }))
      const view = window.__gn.handle.view
      view.dom.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      view.dom.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    },
    [target.x + 100, target.y + 10],
  )
  await page.waitForSelector('.upload-placeholder')
  await page.waitForSelector('.image-block >> nth=1', { timeout: 5000 })
  const doc = await top(page)
  const imgs = doc.filter((n) => n.type === 'image')
  check('dropping an image uploads it as an image block below the list', imgs.length === 2 && imgs.some((n) => n.attrs.src === '/_assets/2026/10/dropped.png'))
  const idx = doc.findIndex((n) => n.type === 'image' && n.attrs.src.endsWith('dropped.png'))
  check('  placed after the list that was dropped on', doc[idx - 1].type === 'bullet_list' && txt(doc[idx - 1]).includes('網站放在'), doc[idx - 1].type)
  console.log('errors', errors)
  await browser.close()
}

// --- Handle alignment across block types -----------------------------------------------------------
{
  const { browser, page, errors } = await launch()
  const cases = [
    ['p', '10/11 產品週會'],
    ['h2', '決議事項'],
    ['li', '第一版先把'],
    ['todo', '做出頁面樹'],
    ['callout', '離線時寫的'],
    ['toggle', '會議逐字稿'],
    ['h1', '標題 1'],
    ['li-nested', '縮排的項目'],
    ['quote', '引用：'],
    ['num', '編號清單第一項'],
  ]
  for (const [name, str] of cases) {
    const el = page.locator('.gn-prose', { has: page.locator(`text=${str}`) }).locator(`text=${str}`).first()
    await el.scrollIntoViewIfNeeded()
    const box = await el.boundingBox()
    await page.mouse.move(box.x + 12, box.y + box.height / 2)
    await page.waitForTimeout(120)
    const grip = await page.locator('.gn-handle-grip').boundingBox().catch(() => null)
    if (!grip) {
      check(`handle visible for ${name}`, false)
      continue
    }
    const gy = grip.y + grip.height / 2
    const ty = box.y + box.height / 2
    check(`handle for ${name} is centred on the first line`, Math.abs(gy - ty) <= (name === 'h1' ? 16 : name === 'h2' ? 12 : 4), `grip ${gy.toFixed(1)} text ${ty.toFixed(1)}`)
  }
  console.log('errors', errors)
  await browser.close()
}

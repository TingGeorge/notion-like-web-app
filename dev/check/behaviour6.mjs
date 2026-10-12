import { launch, docJSON, selectText, check, OUT } from './lib.mjs'

const txt = (n) => (n.text ?? '') + (n.content ?? []).map(txt).join('')
const top = async (page) => (await docJSON(page)).content

{
  const { browser, page, errors } = await launch({ empty: true })
  await page.click('.gn-prose p')
  // Oversized upload: the placeholder shows the error, then disappears.
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(26 * 1024 * 1024)], 'huge.bin', { type: 'application/octet-stream' }))
    window.__gn.handle.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await page.waitForSelector('.upload-placeholder.is-error', { timeout: 5000 })
  const msg = await page.locator('.upload-placeholder.is-error').textContent()
  check('upload error is shown in the placeholder', msg === '上傳失敗：檔案超過 25 MB，無法上傳。', msg)
  await page.screenshot({ path: `${OUT}/upload-error.png`, clip: { x: 300, y: 0, width: 800, height: 200 } })
  check('no block was inserted', (await top(page)).every((n) => n.type === 'paragraph'))

  // Offline image: placeholder, click retries.
  await page.evaluate(() => {
    const v = window.__gn.handle.view
    const img = v.state.schema.nodes.image.create({ src: '/_assets/offline.png', alt: '' })
    v.dispatch(v.state.tr.insert(0, img))
  })
  await page.waitForSelector('.image-placeholder:not(.is-loading)')
  await page.screenshot({ path: `${OUT}/image-offline.png`, clip: { x: 300, y: 0, width: 800, height: 260 } })
  check('offline image shows a placeholder, no <img>', (await page.locator('.image-block img').count()) === 0)
  // Caption editing.
  await page.evaluate(() => {
    const v = window.__gn.handle.view
    v.dispatch(v.state.tr.setNodeMarkup(0, null, { src: '/_assets/ok.png', alt: '' }))
  })
  await page.waitForSelector('.image-block img')
  await page.locator('.image-block').hover()
  await page.locator('.image-caption').fill('我的圖片')
  await page.locator('.image-caption').press('Enter')
  check('caption is stored in alt', (await top(page))[0].attrs.alt === '我的圖片')
  // Esc then Enter on an image goes to a new paragraph below.
  await page.locator('.image-block img').click()
  const sel = await page.evaluate(() => window.__gn.handle.view.state.selection.constructor.name)
  check('click selects the image block', sel === 'NodeSelection')
  await page.keyboard.press('Enter')
  const doc = await top(page)
  check('Enter on a selected image adds a paragraph and moves the caret there', doc[0].type === 'image' && doc[1].type === 'paragraph' && (await page.evaluate(() => window.__gn.handle.view.state.selection.$from.parent.type.name)) === 'paragraph')
  // Typing "/image" then choosing opens a file chooser.
  await page.keyboard.type('/image')
  const chooserP = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null)
  await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  const chooser = await chooserP
  check('/image opens the file chooser', !!chooser)
  if (chooser) {
    await chooser.setFiles({ name: 'cat.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') })
    await page.waitForFunction(() => window.__gn.handle.getDoc().toJSON().content.some((n) => n.type === 'image' && n.attrs.src.endsWith('cat.jpg')), null, { timeout: 5000 })
    check('chosen image is uploaded and inserted', true)
  }
  // /page creates a child page and inserts a link block.
  await page.keyboard.type('/page')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.page-link-block')
  check('/page inserts a page link block', (await top(page)).some((n) => n.type === 'page_link' && n.attrs.href === '/工作/未命名.md'))
  // /link in block mode: choose a page.
  await page.keyboard.type('/link')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.gn-link-popover')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/link-block.png`, clip: { x: 300, y: 0, width: 800, height: 500 } })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  check('/link inserts a page link block for the chosen page', (await top(page)).filter((n) => n.type === 'page_link').length === 2)
  // /table
  await page.keyboard.type('/table')
  await page.keyboard.press('Enter')
  const t = (await top(page)).find((n) => n.type === 'table')
  check('/table inserts a 3x3 table with a header row', t && t.content.length === 3 && t.content[0].content[0].type === 'table_header')
  check('  caret is in the first cell', await page.evaluate(() => window.__gn.handle.view.state.selection.$from.parent.type.name === 'table_header'))
  console.log('errors', errors.filter((e) => !e.includes('Failed to load resource')))
  await browser.close()
}

// Raw block and callout interplay, nested drag.
{
  const { browser, page, errors } = await launch()
  await page.locator('.raw-label').hover()
  const tip = await page.locator('.raw-label').getAttribute('title')
  check('raw block label has the rawHint tooltip', tip === '這段 Markdown 編輯器還不支援，會原封不動地保留。')
  // Raw block is editable text.
  await selectText(page, '</div>', { caretAt: 'end' })
  await page.keyboard.type('!')
  const raw = (await top(page)).find((n) => n.type === 'raw')
  check('raw block is editable and keeps its source', txt(raw).endsWith('</div>!') || txt(raw).includes('!'))
  // Code block language selector and copy.
  await page.locator('.code-language').selectOption('python')
  check('code language selector sets the language', (await top(page)).find((n) => n.type === 'code_block').attrs.language === 'python')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.locator('.code-block').hover()
  await page.locator('.code-copy').click()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  check('copy button copies the code', clip.startsWith('const note = await'), clip.slice(0, 20))
  // Callout: Enter in empty last paragraph exits.
  await selectText(page, '離線時寫的內容會先存在裝置上，連上網路後自動同步到 GitHub。', { caretAt: 'end' })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  const doc = await top(page)
  const ci = doc.findIndex((n) => n.type === 'callout')
  check('Enter on the empty last line of a callout exits it', doc[ci].content.length === 1 && doc[ci + 1].type === 'paragraph' && txt(doc[ci + 1]) === '')
  console.log('errors', errors)
  await browser.close()
}

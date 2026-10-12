import { launch, docJSON, selectText, check, OUT } from './lib.mjs'

const txt = (n) => (n.text ?? '') + (n.content ?? []).map(txt).join('')
const blocks = async (page) => (await docJSON(page)).content.map((n) => `${n.type}${n.attrs?.level ? n.attrs.level : ''}:${txt(n)}`)

// --- IME (UI-17) ---------------------------------------------------------------------------
{
  const { browser, page, errors } = await launch({ empty: true })
  const cdp = await page.context().newCDPSession(page)
  await page.click('.gn-prose p')
  // Composition in progress: nothing may trigger.
  await cdp.send('Input.imeSetComposition', { text: '#', selectionStart: 1, selectionEnd: 1 })
  await page.waitForTimeout(100)
  await cdp.send('Input.imeSetComposition', { text: '# ', selectionStart: 2, selectionEnd: 2 })
  await page.waitForTimeout(100)
  let b = await blocks(page)
  check('IME: "# " during composition does not make a heading', b[0].startsWith('paragraph'), JSON.stringify(b))
  const composing = await page.evaluate(() => window.__gn.handle.view.composing)
  check('view.composing is true during composition', composing === true)
  // Commit: the rule runs on compositionend.
  await cdp.send('Input.insertText', { text: '# ' })
  await page.waitForTimeout(200)
  b = await blocks(page)
  console.log('after commit', JSON.stringify(b))
  check('IME: heading rule applied after compositionend', b[0].startsWith('heading1'), JSON.stringify(b))

  // "/" typed during composition must not open the menu; it opens after compositionend.
  await page.keyboard.press('Enter')
  await cdp.send('Input.imeSetComposition', { text: '/', selectionStart: 1, selectionEnd: 1 })
  await page.waitForTimeout(150)
  check('IME: no slash menu while composing', (await page.locator('.gn-slash').count()) === 0)
  await cdp.send('Input.insertText', { text: '/' })
  await page.waitForTimeout(250)
  check('IME: slash menu after compositionend', (await page.locator('.gn-slash').count()) === 1)
  await page.keyboard.press('Escape')

  // Enter during composition does not split the block.
  await page.keyboard.type('x')
  const before = (await blocks(page)).length
  await page.evaluate(() => {
    const v = window.__gn.handle.view
    v.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    // An IME's Enter confirms the candidate: keyCode 229, isComposing.
    v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(100)
  check('IME: Enter during composition does not add a block', (await blocks(page)).length === before)
  await page.evaluate(() => window.__gn.handle.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await cdp.send('Input.insertText', { text: '好' })
  console.log('errors', errors)
  await browser.close()
}

// --- Slash menu ----------------------------------------------------------------------------
{
  const { browser, page, errors } = await launch({ empty: true })
  await page.click('.gn-prose p')
  const items = () => page.locator('.gn-slash [role=option] .menu-label').allTextContents()
  await page.keyboard.type('/')
  check('slash opens', (await page.locator('.gn-slash').count()) === 1)
  const all = await items()
  check('slash lists all blocks', all.length === 17, String(all.length))
  await page.screenshot({ path: `${OUT}/slash-all.png` })
  await page.keyboard.type('h1')
  check('filter "h1" -> 標題 1 only', JSON.stringify(await items()) === '["標題 1"]', JSON.stringify(await items()))
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('H')
  check('filter is case-insensitive ("H")', (await items()).includes('標題 1') && (await items()).includes('分隔線'), JSON.stringify(await items()))
  await page.keyboard.press('Backspace')
  await page.keyboard.type('Ｈ１')
  check('filter is width-insensitive ("Ｈ１")', JSON.stringify(await items()) === '["標題 1"]', JSON.stringify(await items()))
  await page.keyboard.press('Enter')
  let b = await blocks(page)
  check('Enter inserts the heading and removes /query', b[0] === 'heading1:', JSON.stringify(b))
  // Chinese name filter + full-width slash.
  await page.keyboard.press('Enter')
  await page.keyboard.type('／待辦')
  check('full-width ／ opens; Chinese filter', JSON.stringify(await items()) === '["待辦清單"]', JSON.stringify(await items()))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  b = await blocks(page)
  console.log(JSON.stringify(b))
  check('待辦 inserted a to-do list', b.at(-1).startsWith('bullet_list'))
  const j = await docJSON(page)
  check('to-do is unchecked', j.content.at(-1).content[0].attrs.checked === false)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  // Closes after 3 non-matching chars.
  await page.keyboard.type('/zzz')
  check('closes after 3 chars without a match', (await page.locator('.gn-slash').count()) === 0)
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('/co')
  check('"co" matches code', JSON.stringify(await items()) === '["程式碼"]', JSON.stringify(await items()))
  await page.keyboard.type(' ')
  check('closes on space', (await page.locator('.gn-slash').count()) === 0)
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('/qu')
  await page.keyboard.press('Escape')
  check('Esc closes', (await page.locator('.gn-slash').count()) === 0)
  check('Esc keeps the typed text', (await blocks(page)).at(-1).includes('/qu'))
  // Slash inside code does nothing.
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('```')
  await page.keyboard.type('/')
  check('no slash menu in code', (await page.locator('.gn-slash').count()) === 0)
  console.log('errors', errors)
  await browser.close()
}

// --- Shortcuts -----------------------------------------------------------------------------
{
  const { browser, page, errors } = await launch({ empty: true })
  await page.click('.gn-prose p')
  await page.keyboard.type('hello world')
  await selectText(page, 'world')
  await page.keyboard.press('Control+b')
  await page.keyboard.press('Control+i')
  await page.keyboard.press('Control+u')
  await page.keyboard.press('Control+Shift+s')
  await page.keyboard.press('Control+e')
  let j = await docJSON(page)
  const m = j.content[0].content.find((n) => n.text === 'world')?.marks?.map((x) => x.type).sort().join(',')
  check('⌘B ⌘I ⌘U ⌘⇧S ⌘E', m === 'bold,code,italic,strike,underline', m)
  await selectText(page, 'hello', { caretAt: 'end' })
  const kinds = [
    ['Control+Shift+Digit1', 'heading'],
    ['Control+Shift+Digit2', 'heading'],
    ['Control+Shift+Digit3', 'heading'],
    ['Control+Shift+Digit4', 'bullet_list'],
    ['Control+Shift+Digit5', 'bullet_list'],
    ['Control+Shift+Digit6', 'ordered_list'],
    ['Control+Shift+Digit7', 'toggle'],
    ['Control+Shift+Digit8', 'code_block'],
    ['Control+Shift+Digit0', 'paragraph'],
  ]
  for (const [key, expected] of kinds) {
    await page.keyboard.press(key)
    j = await docJSON(page)
    const got = j.content[0].type
    const extra = got === 'bullet_list' ? (j.content[0].content[0].attrs.checked === false ? ':todo' : ':bullet') : got === 'heading' ? String(j.content[0].attrs.level) : ''
    check(`${key} -> ${expected}`, got === expected, got + extra)
    check(`  caret kept after ${key}`, await page.evaluate(() => window.__gn.handle.view.state.selection.$from.parentOffset === 5))
  }
  // todo toggle with ⌘Enter
  await page.keyboard.press('Control+Shift+Digit4')
  await page.keyboard.press('Control+Enter')
  j = await docJSON(page)
  check('⌘Enter checks a to-do', j.content[0].content[0].attrs.checked === true)
  await page.keyboard.press('Control+Enter')
  j = await docJSON(page)
  check('⌘Enter unchecks a to-do', j.content[0].content[0].attrs.checked === false)
  // duplicate / move
  await page.keyboard.press('Control+d')
  j = await docJSON(page)
  check('⌘D duplicates the block (item)', j.content[0].content.length === 2)
  await page.keyboard.press('Control+Shift+Digit0')
  await page.keyboard.press('Enter')
  await page.keyboard.type('second')
  const order = async () => (await blocks(page)).filter((x) => x.startsWith('paragraph:') && x !== 'paragraph:').map((x) => x.slice(10))
  check('setup: two paragraphs', JSON.stringify(await order()) === '["hello","second world"]', JSON.stringify(await order()))
  await page.keyboard.press('Control+Shift+ArrowUp')
  check('⌘⇧↑ moves the block up', JSON.stringify(await order()) === '["second world","hello"]', JSON.stringify(await order()))
  await page.keyboard.press('Control+Shift+ArrowDown')
  check('⌘⇧↓ moves the block down', JSON.stringify(await order()) === '["hello","second world"]', JSON.stringify(await order()))
  await page.keyboard.press('Control+z')
  check('⌘Z undoes the move', JSON.stringify(await order()) === '["second world","hello"]', JSON.stringify(await order()))
  await page.keyboard.press('Control+Shift+z')
  check('⌘⇧Z redoes it', JSON.stringify(await order()) === '["hello","second world"]', JSON.stringify(await order()))
  // Esc selects the block
  await page.keyboard.press('Escape')
  const nodeSel = await page.evaluate(() => window.__gn.handle.view.state.selection.constructor.name)
  check('Esc selects the block', nodeSel === 'NodeSelection', nodeSel)
  console.log('errors', errors)
  await browser.close()
}

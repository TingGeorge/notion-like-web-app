import { launch, docJSON, docText, selectText, check, OUT } from './lib.mjs'

const summarize = (node) => {
  const kids = node.content ?? []
  const txt = (n) => (n.text ?? '') + (n.content ?? []).map(txt).join('')
  switch (node.type) {
    case 'doc':
      return kids.map(summarize)
    case 'paragraph':
      return `p:${txt(node)}`
    case 'heading':
      return `h${node.attrs.level}:${txt(node)}`
    case 'bullet_list':
      return `ul[${kids.map(summarize).join('|')}]`
    case 'ordered_list':
      return `ol[${kids.map(summarize).join('|')}]`
    case 'list_item':
      return `${node.attrs.checked === null ? '' : node.attrs.checked ? 'x ' : 'o '}${kids.map((k) => (k.type === 'paragraph' ? txt(k) : summarize(k))).join('/')}`
    case 'toggle':
      return `toggle(${node.attrs.open ? 'open' : 'closed'})[${kids.map((k) => (k.type === 'toggle_summary' ? txt(k) : summarize(k))).join('|')}]`
    case 'blockquote':
      return `quote[${kids.map(summarize).join('|')}]`
    case 'code_block':
      return `code(${node.attrs.language}):${txt(node)}`
    case 'horizontal_rule':
      return 'hr'
    default:
      return node.type
  }
}
const sum = async (page) => (await docJSON(page)).content.map(summarize)

const { browser, page, errors } = await launch({ empty: true })
await page.click('.gn-prose p')
const type = (s) => page.keyboard.type(s)

// --- Markdown shortcuts --------------------------------------------------------------------
await type('# 一')
await page.keyboard.press('Enter')
await type('## 二')
await page.keyboard.press('Enter')
await type('### 三')
await page.keyboard.press('Enter')
let s = await sum(page)
check('# ## ### make headings', s[0] === 'h1:一' && s[1] === 'h2:二' && s[2] === 'h3:三', JSON.stringify(s))
await type('- a')
await page.keyboard.press('Enter')
await type('b')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter') // empty item exits
await type('1. n1')
await page.keyboard.press('Enter')
await type('n2')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
await type('[] t1')
await page.keyboard.press('Enter')
await type('t2')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
s = await sum(page)
console.log(JSON.stringify(s))
check('bullet list', s[3] === 'ul[a|b]')
check('numbered list', s[4] === 'ol[n1|n2]')
check('todo list (second item unchecked)', s[5] === 'ul[o t1|o t2]', s[5])
await type('> tog')
await page.keyboard.press('Enter')
await type('child')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
await type('" q')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
await type('```')
await type('x = 1')
await page.keyboard.press('Enter')
await type('y')
await page.keyboard.down('Control')
await page.keyboard.press('Enter')
await page.keyboard.up('Control')
await type('---')
s = await sum(page)
console.log(JSON.stringify(s))
check('> makes a toggle with a child', s.some((x) => x.startsWith('toggle(open)[tog|p:child')), '')
check('" makes a quote', s.some((x) => x.startsWith('quote[p:q')))
check('``` makes a code block with newline', s.some((x) => x === 'code():x = 1\ny'))
check('--- makes a divider', s.includes('hr'))
// inline
await type('**粗** *斜* ~刪~ `碼` ')
let j = await docJSON(page)
const lastP = j.content.filter((n) => n.type === 'paragraph').at(-1)
const marks = (lastP.content ?? []).filter((n) => n.marks?.length).map((n) => `${n.text}:${n.marks.map((m) => m.type)}`)
check('inline bold/italic/strike/code rules', ['粗:bold', '斜:italic', '刪:strike', '碼:code'].every((m) => marks.includes(m)), marks.join(','))
await page.screenshot({ path: `${OUT}/typing.png` })

// --- Undo of an input rule (Backspace right after) ----------------------------------------
await page.keyboard.press('Enter')
await type('# ')
check('"# " converts', (await sum(page)).at(-1) === 'h1:')
await page.keyboard.press('Backspace')
check('Backspace right after a rule undoes it', (await sum(page)).at(-1) === 'p:# ', (await sum(page)).at(-1))
// clean the line
await page.keyboard.press('Control+a')

console.log('errors', errors)
await browser.close()

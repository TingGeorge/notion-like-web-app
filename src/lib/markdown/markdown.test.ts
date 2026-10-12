/**
 * §3.4 corpus: every row of the Blocks ↔ Markdown tables with the exact Markdown written, plus
 * DATA-11 to DATA-16 details. Each `both` case checks serialize(doc) === md and
 * parse(md) equals doc.
 */
import { describe, expect, it } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { canonicalize, parseMarkdown, serializeMarkdown } from './index'
import { firstDifference } from './testing/diff'
import {
  bg,
  bold,
  br,
  callout,
  code,
  color,
  doc,
  file,
  h,
  hr,
  img,
  inlineCode,
  italic,
  li,
  link,
  ol,
  p,
  pageLink,
  quote,
  raw,
  strike,
  t,
  table,
  todo,
  toggle,
  ul,
  underline,
} from './testing/builders'

function expectSameDoc(actual: PMNode, expected: PMNode): void {
  const diff = firstDifference(expected, actual)
  expect(diff, diff ?? '').toBeNull()
}

/** serialize(doc) === md and parse(md) equals doc. */
function both(document: PMNode, md: string): void {
  expect(serializeMarkdown(document)).toBe(md)
  expectSameDoc(parseMarkdown(md), document)
}

describe('§3.4 blocks', () => {
  it('text', () => {
    both(doc(p('中文段落，含 English。')), '中文段落，含 English。\n')
    both(doc(p('第一段'), p('第二段')), '第一段\n\n第二段\n')
  })

  it('headings 1–3 (ATX)', () => {
    both(doc(h(1, '一級'), h(2, '二級'), h(3, '三級')), '# 一級\n\n## 二級\n\n### 三級\n')
    both(doc(h(2)), '##\n')
  })

  it('bulleted list', () => {
    both(doc(ul(li(p('蘋果')), li(p('香蕉')))), '- 蘋果\n- 香蕉\n')
  })

  it('numbered list, sequential from start, children indented by the marker width (DATA-13)', () => {
    const items: PMNode[] = []
    for (let i = 1; i <= 12; i++) {
      items.push(i === 9 || i === 10 ? li(p(`第${i}項`), ul(li(p('子項')))) : li(p(`第${i}項`)))
    }
    const md = [
      '1. 第1項',
      '2. 第2項',
      '3. 第3項',
      '4. 第4項',
      '5. 第5項',
      '6. 第6項',
      '7. 第7項',
      '8. 第8項',
      '9. 第9項',
      '   - 子項',
      '10. 第10項',
      '    - 子項',
      '11. 第11項',
      '12. 第12項',
      '',
    ].join('\n')
    both(doc(ol(1, ...items)), md)
    both(doc(ol(7, li(p('a')), li(p('b')))), '7. a\n8. b\n')
    both(doc(ol(98, li(p('a')), li(p('b'), p('c')), li(p('d')))), '98. a\n99. b\n\n    c\n100. d\n')
  })

  it('to-do, also nested and inside numbered lists', () => {
    both(doc(ul(todo(false, p('待辦')), todo(true, p('完成')))), '- [ ] 待辦\n- [x] 完成\n')
    both(doc(ul(todo(false, p('父'), ul(todo(true, p('子')), li(p('一般')))))), '- [ ] 父\n  - [x] 子\n  - 一般\n')
    both(doc(ol(1, todo(true, p('a')), li(p('b')))), '1. [x] a\n2. b\n')
    // An empty to-do keeps its checkbox.
    both(doc(ul(todo(false, p()), todo(true, p(), ul(li(p('x')))))), '- [ ]\n- [x]\n  - x\n')
  })

  it('list items with an empty first line', () => {
    both(doc(ul(li(p()), li(p(), ul(li(p('子')))))), '-\n-\n  - 子\n')
    both(doc(ul(li(p(), code('', 'x')))), '-\n  ```\n  x\n  ```\n')
    // A list item whose text is a page link is a Link to page block on the marker line.
    both(doc(ul(li(p(), pageLink('/a.md', 'A')))), '- [A](/a.md)\n')
  })

  it('toggle', () => {
    both(doc(toggle('標題', p('內容'))), '<details>\n<summary>標題</summary>\n\n內容\n\n</details>\n')
    both(doc(toggle('空')), '<details>\n<summary>空</summary>\n\n</details>\n')
    both(doc(toggle('a & <b> c')), '<details>\n<summary>a &amp; &lt;b&gt; c</summary>\n\n</details>\n')
    both(
      doc(toggle('外', toggle('內', p('x')), p('y'))),
      '<details>\n<summary>外</summary>\n\n<details>\n<summary>內</summary>\n\nx\n\n</details>\n\ny\n\n</details>\n',
    )
    both(
      doc(ul(li(p('項目'), toggle('T', p('子項'))))),
      '- 項目\n\n  <details>\n  <summary>T</summary>\n\n  子項\n\n  </details>\n',
    )
  })

  it('toggle: `open` is UI state and never written', () => {
    const open = doc(toggle('T', p('x')))
    const withOpen = open.type.create(null, [open.child(0).type.create({ open: true }, open.child(0).content)])
    expect(serializeMarkdown(withOpen)).toBe('<details>\n<summary>T</summary>\n\nx\n\n</details>\n')
    expectSameDoc(parseMarkdown('<details open>\n<summary>T</summary>\n\nx\n\n</details>\n'), open)
  })

  it('quote', () => {
    both(doc(quote(p('引用'))), '> 引用\n')
    both(doc(quote(p('a'), p('b'))), '> a\n>\n> b\n')
    both(doc(quote(ul(li(p('a'))), quote(p('b')))), '> - a\n>\n> > b\n')
  })

  it('callout: GitHub alert with optional icon (DATA-12)', () => {
    both(doc(callout('NOTE', null, p('內容'))), '> [!NOTE]\n> 內容\n')
    both(doc(callout('TIP', null, p('a'), p('b'))), '> [!TIP]\n> a\n>\n> b\n')
    both(doc(callout('IMPORTANT', '🧠', p('內容'))), '> [!IMPORTANT]\n> <!-- icon: 🧠 -->\n> 內容\n')
    both(doc(callout('WARNING', null, ul(li(p('x'))))), '> [!WARNING]\n>\n> - x\n')
    both(doc(callout('CAUTION', null, p())), '> [!CAUTION]\n')
    both(doc(callout('NOTE', '🔥', p())), '> [!NOTE]\n> <!-- icon: 🔥 -->\n')
  })

  it('a quote that starts with an alert marker is escaped, not a callout', () => {
    both(doc(quote(p('[!NOTE]\n不是提示'))), '> \\[!NOTE]\n> 不是提示\n')
    both(doc(quote(p('[!TIP]'))), '> \\[!TIP]\n')
  })

  it('callouts are top-level only: a nested alert marker is plain text', () => {
    expectSameDoc(parseMarkdown('- > [!NOTE]\n  > x\n'), doc(ul(li(p(), quote(p('[!NOTE]\nx'))))))
  })

  it('divider', () => {
    both(doc(p('a'), hr(), p('b')), 'a\n\n---\n\nb\n')
  })

  it('code block', () => {
    both(doc(code('js', 'const a = 1\nconsole.log(a)')), '```js\nconst a = 1\nconsole.log(a)\n```\n')
    both(doc(code('', '')), '```\n```\n')
    both(doc(code('md', 'before\n```\nafter')), '````md\nbefore\n```\nafter\n````\n')
    both(doc(code('', 'trailing newline\n')), '```\ntrailing newline\n\n```\n')
    both(doc(code('x`y', 'z')), '~~~x`y\nz\n~~~\n')
  })

  it('simple table: header row, alignment, escaped pipes', () => {
    const tbl = table(
      ['left', 'center', 'right'],
      [['名稱'], ['數量'], ['備註']],
      [['a | b'], ['1'], [t('x|y', inlineCode)]],
      [[], ['2'], [t('粗', bold)]],
    )
    both(doc(tbl), '| 名稱 | 數量 | 備註 |\n| :--- | :---: | ---: |\n| a \\| b | 1 | `x\\|y` |\n|  | 2 | **粗** |\n')
    both(doc(table([null], [['只有標題']])), '| 只有標題 |\n| --- |\n')
    both(doc(table([null, null], [[' 前後空白 '], ['b']])), '| &#x20;前後空白&#x20; | b |\n| --- | --- |\n')
  })

  it('image, file and link to page alone in a paragraph', () => {
    both(doc(img('/_assets/2026/10/3f9a2c1b.png', '說明')), '![說明](/_assets/2026/10/3f9a2c1b.png)\n')
    both(doc(img('/_assets/a.png', 'a', '標題')), '![a](/_assets/a.png "標題")\n')
    both(doc(file('/_assets/2026/10/ab12cd34.pdf', '報告.pdf')), '[報告.pdf](/_assets/2026/10/ab12cd34.pdf)\n')
    both(doc(pageLink('/工作/會議記錄.md', '會議記錄')), '[會議記錄](/工作/會議記錄.md)\n')
    both(doc(pageLink('/工作/專案%20A.md#目標', '專案 A')), '[專案 A](/工作/專案%20A.md#目標)\n')
    // Other links alone stay a paragraph with a link.
    both(doc(p(t('網站', link('https://example.com')))), '[網站](https://example.com)\n')
    both(doc(p(t('相對', link('other.md')))), '[相對](other.md)\n')
  })

  it('line break inside a block: backslash at the end of the line', () => {
    both(doc(p('第一行', br(), '第二行')), '第一行\\\n第二行\n')
    both(doc(ul(li(p('a', br(), 'b')))), '- a\\\n  b\n')
  })

  it('empty document', () => {
    both(doc(p()), '')
    expect(serializeMarkdown(doc(p(), p()))).toBe('')
    expectSameDoc(parseMarkdown('\n\n  \n'), doc(p()))
  })
})

describe('§3.4 inline marks', () => {
  it('bold, italic, strikethrough, inline code, underline', () => {
    both(
      doc(p(t('粗', bold), '、', t('斜', italic), '、', t('刪', strike), '、', t('碼', inlineCode), '、', t('底', underline))),
      '**粗**、*斜*、~~刪~~、`碼`、<u>底</u>\n',
    )
  })

  it('links', () => {
    both(doc(p('見', t('頁面', link('/a/b.md')), '。')), '見[頁面](/a/b.md)。\n')
    both(doc(p(t('x', link('https://e.com/a b', 't')))), '[x](<https://e.com/a b> "t")\n')
  })

  it('text colour and background (DATA-11)', () => {
    both(doc(p(t('紅字', color('red')))), '<span data-color="red">紅字</span>\n')
    both(doc(p(t('黃底', bg('yellow')))), '<span data-bg="yellow">黃底</span>\n')
    // One span with both attributes is read too.
    expectSameDoc(
      parseMarkdown('<span data-color="red" data-bg="yellow">x</span>\n'),
      doc(p(t('x', color('red'), bg('yellow')))),
    )
    // Unknown colours are not ours: the paragraph is kept as Markdown.
    expectSameDoc(parseMarkdown('<span data-color="teal">x</span>\n'), doc(raw('<span data-color="teal">x</span>')))
  })

  it('marks are written outer → inner in the fixed DATA-14 order', () => {
    const all = [bg('yellow'), color('red'), link('https://e.com'), bold, italic, strike, underline, inlineCode]
    both(
      doc(p(t('x', ...all))),
      // to-markdown picks `_` for the inner emphasis: `***~~` would not pair as intended.
      '<span data-bg="yellow"><span data-color="red">[**_~~<u>`x`</u>~~_**](https://e.com)</span></span>\n',
    )
    both(doc(p(t('a', bold, color('blue')), t('b', bold))), '<span data-color="blue">**a**</span>**b**\n')
  })

  it('spans and <u> are read in any nesting order', () => {
    const expected = doc(p(t('x', underline, color('red'), bg('gray'))))
    expectSameDoc(parseMarkdown('<u><span data-color="red"><span data-bg="gray">x</span></span></u>\n'), expected)
    expectSameDoc(parseMarkdown('<span data-color="red"><u><span data-bg="gray">x</span></u></span>\n'), expected)
  })

  it('CJK punctuation next to marks (CommonMark flanking)', () => {
    const d = doc(p('這是', t('「引號」', bold), '文字'))
    const md = serializeMarkdown(d)
    expectSameDoc(parseMarkdown(md), d)
    expect(md).toBe('這&#x662F;**「引號」**&#x6587;字\n')
    const d2 = doc(p(t('粗體', bold), t('斜體', italic), '，', t('「刪除」', strike), '。'))
    expectSameDoc(parseMarkdown(serializeMarkdown(d2)), d2)
  })

  it('whitespace at the edges of marks and paragraphs is kept', () => {
    both(doc(p(t(' a ', bold))), '**&#x20;a&#x20;**\n')
    both(doc(p('  縮排')), '&#x20; 縮排\n')
    both(doc(p('尾 ')), '尾&#x20;\n')
  })

  it('escapes Markdown syntax in text', () => {
    both(doc(p('# 不是標題')), '\\# 不是標題\n')
    both(doc(p('1. 不是清單')), '1\\. 不是清單\n')
    both(doc(p('- 不是清單')), '\\- 不是清單\n')
    both(doc(p('> 不是引用')), '\\> 不是引用\n')
    both(doc(p('*星* _底_ `碼` ~刪~ [括號] <u>標籤</u> &amp;')), '\\*星\\* \\_底\\_ \\`碼\\` \\~刪\\~ \\[括號] \\<u>標籤\\</u> \\&amp;\n')
    both(doc(p('價格 $5 和 $6')), '價格 \\$5 和 \\$6\n')
    both(doc(p('C:\\Users\\me')), 'C:\\\\Users\\\\me\n')
    both(doc(ul(li(p('[ ] 不是待辦')))), '- \\[ ] 不是待辦\n')
  })

  it('bare URLs stay text (GFM autolink literals are not links to the editor)', () => {
    both(doc(p('見 https://example.com 和 www.example.com')), '見 https://example.com 和 www.example.com\n')
    both(doc(p(t('https://example.com', link('https://example.com')))), '<https://example.com>\n')
  })

  it('a line break in text (soft break) is kept', () => {
    both(doc(p('第一行\n第二行')), '第一行\n第二行\n')
    both(doc(p('a\n\nb')), 'a&#xA;&#xA;b\n')
  })
})

describe('other Markdown styles are read (normalised only when the page is edited)', () => {
  const cases: [string, PMNode][] = [
    ['* a\n+ b\n', doc(ul(li(p('a')), li(p('b'))))],
    ['1) a\n2) b\n', doc(ol(1, li(p('a')), li(p('b'))))],
    ['標題\n===\n\n副標\n---\n', doc(h(1, '標題'), h(2, '副標'))],
    ['    indented\n    code\n', doc(code('', 'indented\ncode'))],
    ['_em_ __strong__\n', doc(p(t('em', italic), ' ', t('strong', bold)))],
    ['<strong>a</strong><em>b</em><del>c</del>\n', doc(p(t('a', bold), t('b', italic), t('c', strike)))],
    ['> [!note]\n> x\n', doc(callout('NOTE', null, p('x')))],
    ['***\n', doc(hr())],
    ['- [ ]\n', doc(ul(todo(false, p())))],
    ['a  \nb\n', doc(p('a', br(), 'b'))],
    ['```\nunclosed', doc(code('', 'unclosed'))],
    ['- a\n\n- b\n', doc(ul(li(p('a')), li(p('b'))))],
    ['- a\n* b\n', doc(ul(li(p('a')), li(p('b'))))],
    ['<details><summary>T</summary>\n\nx\n\n</details>\n', doc(toggle('T', p('x')))],
  ]
  for (const [md, expected] of cases) {
    it(JSON.stringify(md), () => {
      const parsed = parseMarkdown(md)
      expectSameDoc(parsed, expected)
      expect(canonicalize(parsed).eq(parsed)).toBe(true)
    })
  }
})

describe('DATA-15 unknown Markdown is kept byte-for-byte', () => {
  const unknown = [
    '<div align="center">\n  <img src="/_assets/logo.png" width="80">\n</div>',
    '<!-- 註解 -->',
    '<!--\n多行\n\n註解\n-->',
    '腳註參照[^1]。',
    '[^1]: 腳註內容。',
    '行內數學 $E = mc^2$。',
    '$$\n\\int_0^1 x\\,dx\n$$',
    '[參考連結][ref] 文字',
    '[ref]: https://example.com "標題"',
    '#### 四級標題',
    '##### 五級',
    '###### 六級',
    '文字中的 ![圖](/_assets/a.png) 圖片',
    '有 <kbd>Ctrl</kbd> 的段落',
    '- 清單裡有 $x$\n- 第二項',
    '> 引用裡的 <!-- 註解 -->',
    '| a | b |\n| - | - |\n| $x$ | <br> |',
    '<details>\n<summary>沒有空行</summary>\n內容\n</details>',
    '<pre>\ncode\n\nmore\n</pre>',
    '   <div>縮排的 HTML</div>',
  ]

  it('each construct alone', () => {
    // A footnote reference or reference link is only one when its definition exists.
    for (const md of unknown.filter((_, i) => i !== 3 && i !== 7)) {
      const parsed = parseMarkdown(md + '\n')
      expect(parsed.childCount, md).toBe(1)
      expect(parsed.firstChild?.type.name, md).toBe('raw')
      expect(parsed.firstChild?.textContent).toBe(md)
      expect(serializeMarkdown(parsed)).toBe(md + '\n')
    }
  })

  it('footnote references and reference links with their definitions', () => {
    for (const [use, def] of [
      [unknown[3], unknown[4]],
      [unknown[7], unknown[8]],
    ]) {
      const md = `${use}\n\n${def}\n`
      expectSameDoc(parseMarkdown(md), doc(raw(use), raw(def)))
      expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
    }
  })

  it('mixed with editor blocks, consecutive and next to lists', () => {
    const md = [
      '# 標題',
      '',
      unknown[0],
      '',
      unknown[1],
      '',
      '- 清單',
      '- 項目',
      '',
      unknown[3],
      '',
      unknown[4],
      '',
      unknown[5],
      '',
      unknown[6],
      '',
      unknown[7],
      '',
      unknown[8],
      '',
      unknown[9],
      '',
      '1. 一',
      '2. 二',
      '',
      unknown[14],
      '',
      '> 引用',
      '',
      unknown[15],
      '',
      unknown[16],
      '',
      '段落',
      '',
    ].join('\n')
    const parsed = parseMarkdown(md)
    expect(serializeMarkdown(parsed)).toBe(md)
    const raws: string[] = []
    parsed.forEach((b) => {
      if (b.type.name === 'raw') raws.push(b.textContent)
    })
    expect(raws).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16].map((i) => unknown[i]))
  })

  it('unknown Markdown written without blank lines keeps its bytes', () => {
    // Separators may be normalised, the constructs themselves are not.
    const md = '- a\n<!-- c -->\n# h\n<div>\nx\n</div>\n'
    const parsed = parseMarkdown(md)
    const out = serializeMarkdown(parsed)
    expect(out).toContain('<!-- c -->')
    expect(out).toContain('<div>\nx\n</div>')
    expectSameDoc(parseMarkdown(out), parsed)
  })

  it('a block that contains anything unknown becomes one raw block', () => {
    const md = '- a\n- b <!-- c -->\n  - d\n'
    expectSameDoc(parseMarkdown(md), doc(raw('- a\n- b <!-- c -->\n  - d')))
    const toggleMd = '<details>\n<summary>T</summary>\n\n文字 $x$\n\n</details>\n'
    expectSameDoc(parseMarkdown(toggleMd), doc(raw(toggleMd.trimEnd())))
    const calloutMd = '> [!NOTE]\n> 有 <br> 的提示\n'
    expectSameDoc(parseMarkdown(calloutMd), doc(raw(calloutMd.trimEnd())))
  })
})

describe('DATA-10 body format', () => {
  it('LF, one trailing newline', () => {
    expect(serializeMarkdown(doc(p('a'), p('b')))).toBe('a\n\nb\n')
    expectSameDoc(parseMarkdown('a\r\n\r\nb\r\n'), doc(p('a'), p('b')))
  })

  it('parse never throws', () => {
    for (const md of ['', '\0', '\uFFFF', '<', '[', '```', '> ', '- ', '|', '$$', '<details>', '</details>', '\\', '&#0;', '*'.repeat(1000)]) {
      expect(() => parseMarkdown(md)).not.toThrow()
    }
  })
})

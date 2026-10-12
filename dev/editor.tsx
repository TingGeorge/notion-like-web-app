/**
 * Dev-only harness for the block editor: `npm run dev`, then open /dev/editor.html.
 * Query: `?theme=dark`, `?mobile=1`, `?empty=1`, `?readonly=1`.
 * `window.__gn` exposes the handle and a change counter for Playwright.
 */
import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/styles/global.css'
import { Editor, type EditorHandle, type EditorServices, type PageRef } from '../src/editor'
import { schema } from '../src/lib/schema'

const params = new URLSearchParams(location.search)
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme')!
const mobile = params.get('mobile') === '1'

type J = Record<string, unknown>
const text = (t: string, marks?: J[]): J => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t })
const p = (...c: (string | J)[]): J => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? text(x) : x)) })
const h = (level: number, t: string): J => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const li = (checked: boolean | null, ...c: (string | J)[]): J => ({
  type: 'list_item',
  attrs: { checked },
  content: [typeof c[0] === 'string' ? p(c[0]) : (c[0] as J), ...c.slice(1).map((x) => x as J)],
})
const ul = (...items: J[]): J => ({ type: 'bullet_list', content: items })
const ol = (...items: J[]): J => ({ type: 'ordered_list', attrs: { start: 1 }, content: items })
const cell = (type: string, t: string): J => ({ type, content: t ? [text(t)] : [] })
const row = (type: string, ...cells: string[]): J => ({ type: 'table_row', content: cells.map((c) => cell(type, c)) })

const SAMPLE: J = {
  type: 'doc',
  content: [
    p('10/11 產品週會。今天決定第一版的範圍，並分配接下來兩週的工作。'),
    h(2, '決議事項'),
    ul(
      li(null, '第一版先把筆記核心功能做好，Database 之後再做'),
      li(null, p('資料存在自己的 ', text('GitHub private repo', [{ type: 'color', attrs: { color: 'blue' } }]), '，每一頁是一個 Markdown 檔')),
      li(null, '網站放在 GitHub Pages，沒有伺服器'),
    ),
    h(2, '待辦'),
    ul(
      li(true, '畫好 Figma 設計稿'),
      li(false, '做出頁面樹和編輯器'),
      li(false, '完成 GitHub 同步與離線模式'),
    ),
    {
      type: 'callout',
      attrs: { kind: 'TIP', icon: null },
      content: [p('離線時寫的內容會先存在裝置上，連上網路後自動同步到 GitHub。')],
    },
    {
      type: 'toggle',
      attrs: { open: false },
      content: [{ type: 'toggle_summary', content: [text('會議逐字稿')] }, p('展開後的內容。點左邊的三角形就能收起來。')],
    },
    h(2, '分工'),
    {
      type: 'table',
      content: [
        row('table_header', '項目', '負責人', '狀態'),
        row('table_cell', '首頁設計', 'Ting', '進行中'),
        row('table_cell', '同步功能', 'Claude', '完成'),
      ],
    },
    h(1, '標題 1：區塊一覽'),
    h(3, '標題 3'),
    p(
      text('粗體', [{ type: 'bold' }]),
      '、',
      text('斜體', [{ type: 'italic' }]),
      '、',
      text('底線', [{ type: 'underline' }]),
      '、',
      text('刪除線', [{ type: 'strike' }]),
      '、',
      text('code()', [{ type: 'code' }]),
      '、',
      text('站內連結', [{ type: 'link', attrs: { href: '/工作/專案%20A.md', title: null } }]),
      '、',
      text('外部連結', [{ type: 'link', attrs: { href: 'https://example.com', title: null } }]),
      '、',
      text('橘色文字', [{ type: 'color', attrs: { color: 'orange' } }]),
      '、',
      text('黃色背景', [{ type: 'bg', attrs: { color: 'yellow' } }]),
      '。',
    ),
    ol(li(null, '編號清單第一項', ul(li(null, '縮排的項目'), li(null, '另一個項目'))), li(null, '第二項'), li(null, '第三項')),
    {
      type: 'toggle',
      attrs: { open: true },
      content: [
        { type: 'toggle_summary', content: [text('Toggle 標題')] },
        p('展開後的內容。點左邊的三角形就能收起來。'),
        ul(li(null, 'Toggle 裡的清單')),
      ],
    },
    { type: 'blockquote', content: [p('引用：好的筆記軟體，應該讓你忘記它的存在。')] },
    {
      type: 'code_block',
      attrs: { language: 'javascript' },
      content: [text("const note = await github.getFile('工作/會議記錄.md');\nconsole.log(note.title);")],
    },
    { type: 'horizontal_rule' },
    { type: 'image', attrs: { src: '/_assets/2026/10/whiteboard.svg', alt: '白板照片 · 2026/10/11', title: null } },
    { type: 'file', attrs: { href: '/_assets/2026/10/spec.pdf', name: '產品規格.pdf' } },
    { type: 'page_link', attrs: { href: '/工作/專案%20A.md', title: '專案 A' } },
    { type: 'raw', content: [text('<div class="note">\n  這段 HTML 編輯器還不支援\n</div>')] },
    p(),
  ],
}

const PAGES: PageRef[] = [
  { href: '/工作/會議記錄.md', title: '會議記錄', icon: '📝', parentTitle: '工作' },
  { href: '/工作/專案%20A.md', title: '專案 A', icon: '🚀', parentTitle: '工作' },
  { href: '/工作/週報.md', title: '週報', icon: '🗓️', parentTitle: '工作' },
  { href: '/讀書筆記.md', title: '讀書筆記', icon: null, parentTitle: null },
  { href: '/食譜.md', title: '食譜', icon: '🍳', parentTitle: null },
]

const whiteboard =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="708" height="260"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#d7e8f7"/><stop offset="1" stop-color="#eddff3"/></linearGradient></defs><rect width="708" height="260" fill="url(#g)"/><text x="354" y="140" font-size="22" text-anchor="middle" fill="#787774">whiteboard</text></svg>',
  )

const w = window as unknown as { __gn: Record<string, unknown> }
w.__gn = { changes: 0, moved: [], opened: [], uploads: [], last: null }

const services: EditorServices = {
  async uploadFile(file) {
    ;(w.__gn.uploads as string[]).push(file.name)
    await new Promise((r) => setTimeout(r, 600))
    if (file.size > 25 * 1024 * 1024) throw new Error('檔案超過 25 MB，無法上傳。')
    return { href: `/_assets/2026/10/${encodeURIComponent(file.name)}`, name: file.name, isImage: file.type.startsWith('image/') }
  },
  async resolveAsset(href) {
    if (href.endsWith('.svg') || href.includes('whiteboard')) return whiteboard
    if (href.endsWith('.png') || href.endsWith('.jpg')) return whiteboard
    if (href.includes('offline')) return null
    return URL.createObjectURL(new Blob(['demo'], { type: 'application/octet-stream' }))
  },
  async createChildPage() {
    return { href: '/工作/未命名.md', title: '未命名', icon: null }
  },
  openPage(href) {
    ;(w.__gn.opened as string[]).push(href)
  },
  async searchPages(query) {
    const q = query.trim().toLowerCase()
    return PAGES.filter((pg) => !q || pg.title.toLowerCase().includes(q))
  },
  pageInfo(href) {
    return PAGES.find((pg) => pg.href === href) ?? null
  },
  async moveBlocksToPage(markdown, href) {
    ;(w.__gn.moved as unknown[]).push({ markdown, href })
  },
  getLastColor() {
    try {
      return localStorage.getItem('gn-last-color')
    } catch {
      return null
    }
  },
  setLastColor(value) {
    try {
      localStorage.setItem('gn-last-color', value)
    } catch {
      /* ignore */
    }
  },
}

function Harness() {
  const handle = useRef<EditorHandle>(null)
  const [count, setCount] = useState(0)
  const doc = params.get('empty') === '1' ? schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] }) : schema.nodeFromJSON(SAMPLE)
  return (
    <div className="harness" style={{ maxWidth: mobile ? undefined : 708, margin: '0 auto', padding: mobile ? '16px 20px 220px' : '48px 20px 400px' }}>
      <h1 style={{ fontSize: mobile ? 26 : 40, margin: '0 0 12px', fontWeight: 700 }} id="title">
        會議記錄
      </h1>
      <Editor
        ref={(h) => {
          handle.current = h
          w.__gn.handle = h
        }}
        doc={doc}
        editable={params.get('readonly') !== '1'}
        mobile={mobile}
        services={services}
        placeholder="按 Enter 開始寫，或輸入「/」插入區塊"
        onChange={(d) => {
          ;(w.__gn.changes as number)++
          w.__gn.last = d
          setCount((c) => c + 1)
        }}
        onExitTop={() => {
          document.getElementById('title')?.setAttribute('data-exit', String(Date.now()))
        }}
      />
      <span hidden data-count={count} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)

/**
 * Starter page bodies (UI-10) and the welcome page (SETUP-9), as Markdown in exactly the form the
 * editor writes (SPEC §3.4): `- ` bullets, `- [ ]` to-dos, `<details>` toggles, `> [!TIP]` callouts,
 * blocks separated by one blank line, one trailing newline (DATA-10).
 *
 * These are page *content* that ends up in the user's repo, so they live here and not in
 * `src/strings/zh-TW.ts`. Page titles for the starters are `t.templates.*`.
 */
import { t } from '../../strings/zh-TW'

/** 空白頁面. */
export const TEMPLATE_BLANK = ''

/** 待辦清單. */
export const TEMPLATE_TODO = `- [ ] 第一件要做的事
- [ ] 第二件要做的事
- [ ] 第三件要做的事
`

/** 會議記錄範本. */
export const TEMPLATE_MEETING = `## 日期

## 與會者

- 姓名

## 議程

1. 議題一
2. 議題二

## 決議事項

- 決議

## 待辦

- [ ] 待辦事項
`

export type TemplateId = 'blank' | 'todo' | 'meeting'

export interface PageTemplate {
  id: TemplateId
  /** Button label (「或從這裡開始」). */
  label: string
  /** Title given to the page when it is still 未命名; `null` keeps the page untitled. */
  title: string | null
  body: string
}

/** UI-10: the starters offered under 「或從這裡開始」, in display order. */
export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  { id: 'blank', label: t.page.templateBlank, title: null, body: TEMPLATE_BLANK },
  { id: 'todo', label: t.page.templateTodo, title: t.templates.todoTitle, body: TEMPLATE_TODO },
  { id: 'meeting', label: t.page.templateMeeting, title: t.templates.meetingTitle, body: TEMPLATE_MEETING },
]

/** SETUP-9: the repo path and title of the page created in an empty repo. */
export const WELCOME_PAGE_PATH = '歡迎使用.md'
export const WELCOME_PAGE_TITLE = '歡迎使用'

/** SETUP-9: body of `歡迎使用.md` (without frontmatter). */
export const WELCOME_PAGE_BODY = `# 歡迎使用 GitHub Notes

這裡是你的筆記本。每一頁都是你自己 GitHub repo 裡的一個 Markdown 檔，沒有伺服器，也不用註冊。

> [!TIP]
> 想看看筆記長什麼樣子，可以到 GitHub 打開這個 repo，你會看到一個叫「歡迎使用.md」的檔案，就是這一頁。

## 頁面就是檔案

- 每一頁是一個 \`.md\` 檔，頁面的標題就是檔名
- 在頁面底下新增子頁面，會多出一個同名的資料夾
- 圖片和附件放在 \`_assets\` 資料夾裡
- 你隨時可以在 GitHub 或任何文字編輯器裡直接打開、修改這些檔案

## 用「/」插入區塊

在空白的一行輸入 \`/\`，會出現區塊選單：標題、清單、待辦、Toggle、引用、Callout、程式碼、分隔線、表格、圖片，繼續輸入文字可以篩選。

<details>
<summary>Toggle 長這樣，點一下展開</summary>

這裡的內容平常是收起來的。在 GitHub 上看到的也是同樣的折疊區塊。

</details>

## Markdown 快速輸入

在行首輸入這些符號再按空白鍵，就會變成對應的區塊：

- \`#\`、\`##\`、\`###\`：標題 1、2、3
- \`-\` 或 \`*\`：項目清單
- \`1.\`：編號清單
- \`[]\`：待辦清單
- \`>\`：Toggle
- \`"\`：引用
- 三個反引號：程式碼區塊
- \`---\`：分隔線

文字內也可以輸入 \`**粗體**\`、\`*斜體*\`、\`~刪除線~\`，寫完就會套用格式。

- [ ] 試試看：把這個待辦打勾
- [ ] 試試看：在下面新增一個 Callout

## 同步與離線

- 你的修改會先存在這台裝置上，停止輸入幾秒後自動同步到 GitHub
- 沒有網路也能閱讀、編輯，連上網路後會自動補上
- 兩台裝置改到同一段文字時，會請你選擇要保留哪一個版本，不會悄悄覆蓋
- 左下角的狀態會告訴你目前是「已同步」、「同步中」還是「離線」

## 連結另一台裝置

到「設定 → 連結新裝置」，在電腦上顯示 QR code，再用手機掃描並輸入配對碼，就能把同一個筆記本帶到另一台裝置。QR code 和配對碼合起來等於你的 token，不要一起給別人看。

## 垃圾桶

刪除的頁面會先放進垃圾桶，預設保留 30 天，可以從側邊欄的「垃圾桶」還原。就算永久刪除，也還能從 GitHub 的歷史記錄找回來。

---

準備好了嗎？從側邊欄按「新增頁面」開始寫吧。
`

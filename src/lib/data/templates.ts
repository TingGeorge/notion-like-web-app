/**
 * Starter page bodies (UI-10) and the welcome page (SETUP-9), as Markdown in exactly the form the
 * editor writes (SPEC §3.4): `- ` bullets, `- [ ]` to-dos, `<details>` toggles, `> [!TIP]` callouts,
 * blocks separated by one blank line, one trailing newline (DATA-10).
 *
 * These are page *content* that ends up in the user's repo, so they live here and not in
 * `src/strings`. Each comes in the device's UI language. Page titles for the starters are
 * `t.templates.*`.
 */
import { language, t } from '../../strings'

const english = language === 'en'

/** 空白頁面. */
export const TEMPLATE_BLANK = ''

/** 待辦清單. */
export const TEMPLATE_TODO = english
  ? `- [ ] First thing to do
- [ ] Second thing to do
- [ ] Third thing to do
`
  : `- [ ] 第一件要做的事
- [ ] 第二件要做的事
- [ ] 第三件要做的事
`

/** 會議記錄範本. */
export const TEMPLATE_MEETING = english
  ? `## Date

## Attendees

- Name

## Agenda

1. Topic one
2. Topic two

## Decisions

- Decision

## Action items

- [ ] Action item
`
  : `## 日期

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
export const WELCOME_PAGE_TITLE = english ? 'Welcome' : '歡迎使用'
export const WELCOME_PAGE_PATH = `${WELCOME_PAGE_TITLE}.md`

const WELCOME_ZH = `這裡是你的筆記本。每一頁都是你自己 GitHub repo 裡的一個 Markdown 檔，沒有伺服器，也不用註冊。

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
- 右上角的狀態會告訴你目前是「已同步」、「同步中」還是「離線」

## 連結另一台裝置

到「設定 → 連結新裝置」，在電腦上顯示 QR code，再用手機掃描，就能把同一個筆記本帶到另一台裝置。QR code 等於你的 token，不要給別人看或拍下來。

## 垃圾桶

刪除的頁面會先放進垃圾桶，預設保留 30 天，可以從側邊欄的「垃圾桶」還原。就算永久刪除，也還能從 GitHub 的歷史記錄找回來。

---

準備好了嗎？從側邊欄按「新增頁面」開始寫吧。
`

const WELCOME_EN = `This is your notebook. Every page is a Markdown file in your own GitHub repo. No server, no sign-up.

> [!TIP]
> To see what your notes look like, open this repo on GitHub: the file “Welcome.md” is this page.

## Pages are files

- Every page is a \`.md\` file, and the page title is the file name
- Adding a subpage under a page creates a folder with the same name
- Images and attachments go in the \`_assets\` folder
- You can open and edit these files on GitHub or in any text editor at any time

## Insert blocks with “/”

Type \`/\` on an empty line to open the block menu: headings, lists, to-dos, toggles, quotes, callouts, code, dividers, tables and images. Keep typing to filter.

<details>
<summary>This is a toggle. Click to expand</summary>

What is in here stays folded away. GitHub shows the same folded block.

</details>

## Markdown shortcuts

Type one of these at the start of a line, then a space, to turn it into a block:

- \`#\`, \`##\`, \`###\`: heading 1, 2, 3
- \`-\` or \`*\`: bulleted list
- \`1.\`: numbered list
- \`[]\`: to-do list
- \`>\`: toggle
- \`"\`: quote
- Three backticks: code block
- \`---\`: divider

Inside text you can also type \`**bold**\`, \`*italic*\` and \`~strikethrough~\`; the formatting applies as you finish.

- [ ] Try it: check this to-do
- [ ] Try it: add a callout below

## Sync and offline

- Your changes are saved on this device first, then synced to GitHub a few seconds after you stop typing
- You can read and edit without a network; changes catch up once you are back online
- If two devices change the same text, you are asked which version to keep; nothing is silently overwritten
- The status in the top right tells you whether you are “Synced”, “Syncing” or “Offline”

## Link another device

Go to “Settings → Link a new device”, show the QR code on your computer and scan it with your phone to bring the same notebook to that device. The QR code is as good as your token: don’t show it to anyone or photograph it.

## Trash

Deleted pages go to the trash first and are kept for 30 days by default; restore them from “Trash” in the sidebar. Even after deleting permanently, you can find them in the GitHub history.

---

Ready? Click “New page” in the sidebar to start writing.
`

/** SETUP-9: body of the welcome page (without frontmatter). */
export const WELCOME_PAGE_BODY = english ? WELCOME_EN : WELCOME_ZH

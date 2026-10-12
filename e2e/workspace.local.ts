// A workspace like the Figma example (D02), for exploration screenshots.
export const D02_FILES: Record<string, string> = {
  '工作.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2WRK\nicon: "💼"\n---\n工作相關的頁面。\n',
  '工作/會議記錄.md': `---
id: 01JA8Z3K5N6P7Q8R9S0T1V2MTG
icon: "📝"
cover: "gradient:1"
---
10/11 產品週會。今天決定第一版的範圍，並分配接下來兩週的工作。

## 決議事項

- 第一版先把筆記核心功能做好，Database 之後再做
- 資料存在自己的 GitHub private repo，每一頁是一個 Markdown 檔
- 網站放在 GitHub Pages，沒有伺服器

## 待辦

- [x] 畫好 Figma 設計稿
- [ ] 做出頁面樹和編輯器
- [ ] 完成 GitHub 同步與離線模式

> [!TIP]
> 離線時寫的內容會先存在裝置上，連上網路後自動同步到 GitHub。

<details>
<summary>會議逐字稿</summary>

Ting：我們先確認範圍。

</details>

## 分工

| 項目 | 負責人 | 狀態 |
| --- | --- | --- |
| 首頁設計 | Ting | 進行中 |
| 同步功能 | Claude | 完成 |
`,
  '工作/專案 A.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2PRJ\nicon: "🚀"\n---\n下次會議前完成首頁設計。\n',
  '工作/週報.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2WKR\nicon: "📆"\n---\n週五的會議重點整理。\n',
  '讀書筆記.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2BKS\nicon: "📔"\n---\n《高效會議》第三章。\n',
  '京都旅行計畫.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2KYT\nicon: "✈️"\n---\n第三天：清水寺 → 二寧坂 → 祇園，晚上吃湯豆腐。\n',
  '食譜.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2RCP\nicon: "🍳"\n---\n京都風親子丼：醬汁比例 1:1:1。\n',
  '點子.md': '---\nid: 01JA8Z3K5N6P7Q8R9S0T1V2DEA\nicon: "💡"\n---\n',
  '.notes/settings.json': JSON.stringify({ version: 1, favorites: ['01JA8Z3K5N6P7Q8R9S0T1V2BKS', '01JA8Z3K5N6P7Q8R9S0T1V2PRJ'], order: { root: ['01JA8Z3K5N6P7Q8R9S0T1V2WRK', '01JA8Z3K5N6P7Q8R9S0T1V2BKS'], '01JA8Z3K5N6P7Q8R9S0T1V2WRK': ['01JA8Z3K5N6P7Q8R9S0T1V2MTG', '01JA8Z3K5N6P7Q8R9S0T1V2PRJ', '01JA8Z3K5N6P7Q8R9S0T1V2WKR'] }, trashRetentionDays: 30 }, null, 2) + '\n',
}

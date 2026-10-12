# GitHub Notes

像 Notion 一樣好用的筆記 App，所有筆記都存在你自己的 GitHub private repo。

A Notion-like notes PWA that stores every page as a Markdown file in your own private GitHub repository. No server, no sign-up.

- **沒有伺服器、不用註冊**：第一次使用時貼上一把只開放你筆記 repo 的 GitHub token，設定只存在你的裝置上。
- **電腦和 iPhone 都能用**：iPhone 加入主畫面後就像一個 App；換裝置時掃一下 QR code 就能帶入設定。
- **離線也能寫**：連上網路後自動同步；每一頁都是 Markdown 檔，在 GitHub 上也看得懂。

> 狀態：開發中（v0.1）。規格見 [SPEC.md](SPEC.md)，圖解版見 [SPEC.html](SPEC.html)。

## 開發 Development

Requires Node 22.

```sh
npm ci
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest)
npm run check        # lint + typecheck + unit tests
npm run e2e          # end-to-end tests (Playwright) against a production build
npm run build        # static files in dist/, deployable to GitHub Pages
```

Tests never touch real GitHub: they use an in-memory fake GitHub API (`test/fake-github/`).
Pushes to `main` deploy to GitHub Pages after CI passes (`.github/workflows/ci.yml`).

| Folder | What |
| --- | --- |
| `src/lib/` | Data format, Markdown ⇄ editor, GitHub client, sync engine, search, storage |
| `src/editor/` | The block editor (ProseMirror) |
| `src/app/` | Screens and layouts (desktop and iPhone) |
| `src/strings/zh-TW.ts` | All UI text |

## 授權

[MIT](LICENSE)

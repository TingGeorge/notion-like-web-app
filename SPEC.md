# GitHub Notes — Spec v0.1

A Notion-like notes app that runs entirely in the browser (a PWA) and stores every page as a Markdown file in the user's own private GitHub repository. There is no server.

- Plan and decision log (zh-TW): [`TingGeorge/ideas` → `github-notes/README.md`](https://github.com/TingGeorge/ideas/blob/claude/bold-sagan-uthv65/github-notes/README.md)
- Design: [Figma](https://www.figma.com/design/N3TDXtJeqjUd6wiUBHPzNu/Untitled). Screen codes `D01`–`D15` (desktop) and `M01`–`M16` (iPhone) below refer to frames in that file.
- Requirement IDs (`DATA-3`, `SYNC-7`, …) are referenced by tests. "MUST" is required for v1; "SHOULD" may slip to a later release.

## 1. Scope

| In scope (v1) | Out of scope (v1) |
| --- | --- |
| One user, many devices, one repo per device setup | Real-time multi-user editing, sharing, comments, @people |
| Desktop browsers: Safari 17+, Chrome/Edge 120+, Firefox 125+ | Databases (table/board/calendar views), templates, formulas |
| iPhone: iOS 17+ home-screen web app | Importing a Notion export (the file format is kept compatible so it can be added) |
| Offline reading and writing, automatic sync | Android-specific polish (it should work, but it is not tested) |
| Notion-style editing, shortcuts, colours, search | Encryption of notes inside the repo |
| Traditional Chinese UI | Other UI languages (strings live in one file, ready for later) |

## 2. Architecture

```
┌──────────────── Device (iPhone / PC) ────────────────┐
│  UI (React) ── Editor (Milkdown)                      │
│     │                                                 │
│  Store (IndexedDB / Dexie): config, files, index      │──▶ works offline
│     │                                                 │
│  Sync engine ── GitHub client (fetch)                 │
│  Search index (MiniSearch + Intl.Segmenter)           │
│  Service worker (app shell cache)                     │
└────────────┬──────────────────────────┬───────────────┘
             │ app code only            │ token, HTTPS
             ▼                          ▼
   GitHub Pages                    api.github.com ──▶ user's private repo
   tinggeorge.github.io/notion-like-web-app/
```

- **ARCH-1** The app is static files served from GitHub Pages under the base path `/notion-like-web-app/`. It MUST NOT depend on any server other than `api.github.com`.
- **ARCH-2** Routing uses the URL hash (`#/…`) so GitHub Pages never returns 404 for deep links. Routes: `#/` home, `#/p/<pageId>` page, `#/search?q=`, `#/settings/<section>`, `#/setup/<step>`, `#/link`.
- **ARCH-3** All network calls go to `https://api.github.com`. The token MUST NOT be sent anywhere else.
- **ARCH-4** No third-party scripts, fonts or analytics are loaded at runtime. Libraries are bundled at build time.
- **ARCH-5** UI text uses the system font stack: `-apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Segoe UI", sans-serif`. Code uses `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. (Figma uses Noto Sans TC and JetBrains Mono as stand-ins.) Colours come from the Figma variables, exported as CSS custom properties (`--bg-default`, `--text-primary`, …) with light and dark values.

## 3. Repository data format

The repo is the source of truth. It must stay readable on github.com and usable by other Markdown tools.

### 3.1 Workspace

- **DATA-1** A workspace is `(owner, repo, branch)`. The branch is the repo's default branch at setup time.
- **DATA-2** Every `.md` file is a page, except files under a top-level folder whose name starts with `.` or `_`. Those folders are reserved: `_assets/` holds attachments and `.notes/` holds app metadata. Any other file type is ignored and never modified.

```
README.md                      ← an ordinary page if present
工作.md                         ← page 「工作」
工作/                           ← children of 「工作」
  會議記錄.md
  專案 A.md
讀書筆記.md
_assets/2026/10/3f9a2c1b.png   ← attachments
.notes/settings.json           ← favourites, sidebar order
.notes/trash/…                 ← deleted pages
```

### 3.2 Pages and file names

- **DATA-3** A page `P` lives at `<dir>/<name>.md`. Its children live in the sibling folder `<dir>/<name>/`. A page with no children has no folder. Moving the last child out of a folder deletes the empty folder; git has no empty folders anyway.
- **DATA-4** The name comes from the title:
  - The characters `/ \ : * ? " < > |` are replaced by their full-width forms `／ ＼ ： ＊ ？ ＂ ＜ ＞ ｜`. Control characters are removed.
  - Leading and trailing spaces and dots are trimmed.
  - An empty result becomes `未命名`.
  - The name is truncated at a character boundary to 150 UTF-8 bytes.
- **DATA-5** If the file name cannot hold the exact title (because of replacement or truncation), the exact title is stored in the frontmatter `title`. When reading a page, its title is `frontmatter.title`, or the file name without `.md` if there is none.
- **DATA-6** Names are unique within a folder when compared case-insensitively after Unicode NFC normalisation. On a clash the app appends ` (2)`, ` (3)`, … to the name; the title itself is unchanged and goes into the frontmatter.
- **DATA-7** Renaming or moving a page renames or moves its `.md` file and its child folder in one commit (§5.4).

### 3.3 Page file

```markdown
---
id: 01JA8Z3K5N6P7Q8R9S0T1V2W3X
icon: "📝"
cover: "_assets/2026/10/ab12cd34.jpg"
created: 2026-10-11T10:00:00+08:00
---
Body Markdown…
```

- **DATA-8** Frontmatter is YAML. The app reads and writes these keys:

  | Key | Required | Meaning |
  | --- | --- | --- |
  | `id` | yes, once the app has saved the page | ULID; stable page identity across renames |
  | `title` | only when needed (DATA-5) | exact title |
  | `icon` | no | one emoji |
  | `cover` | no | repo path of an image, or `gradient:<1-8>` for a built-in gradient |
  | `created` | no | ISO 8601 timestamp |

  Unknown keys MUST be kept verbatim, in their original order.
- **DATA-9** A file without frontmatter (for example one created on github.com) is valid. Until the app first saves that page, its identity is its path. On first save the app adds `id` (and `created` if missing). Merely opening or syncing a file MUST NOT rewrite it.
- **DATA-10** Files are UTF-8 with LF line endings and one trailing newline. The page title is not repeated as a `#` heading in the body.

### 3.4 Blocks ↔ Markdown

The editor document is converted to and from Markdown with these exact forms (CommonMark + GFM):

| Block (Notion name) | Markdown written |
| --- | --- |
| Text | the paragraph |
| Heading 1 / 2 / 3 | `# ` / `## ` / `### ` |
| Bulleted list | `- item` (children indented 2 spaces) |
| Numbered list | `1. item` (children indented 3 spaces; always written as `1.`, `2.`, …) |
| To-do | `- [ ] item` / `- [x] item` |
| Toggle | `<details>` / `<summary>Title</summary>`, a blank line, the children, a blank line, `</details>` |
| Quote | `> text` |
| Callout | GitHub alert: `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` plus the content (see DATA-12) |
| Divider | `---` |
| Code | fenced block with a language: ```` ```js ```` |
| Simple table | GFM pipe table; the first row is the header |
| Image | `![caption](relative/path/to/_assets/…)` alone in a paragraph |
| File | `[file name.pdf](relative/path/to/_assets/…)` alone in a paragraph |
| Link to page | `[Title](relative/path/Title.md)` alone in a paragraph |
| Line break inside a block | backslash at the end of the line |

| Inline (Notion) | Markdown written |
| --- | --- |
| Bold / italic / strikethrough / code | `**x**` / `*x*` / `~~x~~` / `` `x` `` |
| Underline | `<u>x</u>` |
| Link | `[x](https://…)`; to another page: `[x](relative/path.md)` |
| Text colour | `<span data-color="red">x</span>` |
| Background colour | `<span data-bg="yellow">x</span>` |

- **DATA-11** Colours use Notion's names: `gray brown orange yellow green blue purple pink red`. On github.com these spans show as plain text.
- **DATA-12** Callout icons map to alert types: 💡 → `TIP`, ⚠️ → `WARNING`, ❗ → `IMPORTANT`, 🛑 → `CAUTION`, anything else → `NOTE`. When the icon is not the default for its type (`NOTE` defaults to ℹ️), the line `<!-- icon: 🧠 -->` follows the alert marker.
- **DATA-13** Nesting is allowed under list items, to-dos, toggles and callouts. In Notion any block can be indented, but Markdown cannot express that for paragraphs and headings, so `Tab` on them does nothing (a documented deviation).
- **DATA-14** Markdown the editor does not understand (raw HTML blocks, footnotes, math, front-of-line HTML comments other than DATA-12) MUST be kept byte-for-byte. It is shown as a "Markdown" block whose source can be edited.
- **DATA-15** Round trip: `parse(serialize(doc)) == doc` for every document. `serialize(parse(md)) == md` for Markdown written by the app. Markdown in other styles (such as `*` bullets) may be normalised, but only when the user edits that page.
- **DATA-16** Links between pages are relative paths, URL-encoded (`專案%20A.md`), so they work on github.com. When a page is renamed or moved, every link to it in other pages is rewritten in the same commit. Backlinks are computed from the local index (STORE-4).

### 3.5 Attachments

- **DATA-17** An uploaded file is stored at `_assets/<YYYY>/<MM>/<first 8 hex chars of SHA-256>.<ext>`. Identical files are stored once.
- **DATA-18** Images longer than 2560 px on their long edge are scaled down before upload. Images without transparency are re-encoded as JPEG quality 0.85; images with transparency stay PNG. Any single file larger than 25 MB is rejected with an explanation.
- **DATA-19** Deleting a page does not delete its attachments, because other pages or versions may use them. Cleaning up orphaned files is out of scope for v1.

### 3.6 Settings and trash

- **DATA-20** `.notes/settings.json`:

  ```json
  { "version": 1,
    "favorites": ["<pageId>", "…"],
    "order": { "root": ["<pageId>", "…"], "<parentPageId>": ["<pageId>", "…"] },
    "trashRetentionDays": 30 }
  ```

  Children listed in `order` come first, in that order. The rest follow, sorted by title with `Intl.Collator("zh-TW")`.
- **DATA-21** Deleting a page moves its file and its child folder to `.notes/trash/<pageId>/` and appends `{ id, title, originalPath, deletedAt }` to `.notes/trash/index.json`. Restoring moves them back; if the name is taken, DATA-6 applies. "Delete permanently" removes the files from `.notes/trash/` (they remain in git history). On sync, items older than `trashRetentionDays` are deleted permanently.

## 4. Device storage

- **STORE-1** One IndexedDB database `github-notes` (Dexie), with schema versioning and migrations.

  | Table | Key | Contents |
  | --- | --- | --- |
  | `config` | key | `workspace` `{owner, repo, branch, token, tokenExpiresAt, login, linkedAt}`, `device` `{id, name}`, `ui` `{theme, sidebarWidth, collapsed, recent[]}` |
  | `files` | path | `kind` (`page` / `meta`), `baseSha`, `baseText`, `text`, `dirty`, `deleted`, `conflict`, `updatedAt` |
  | `pages` | id | derived: `path`, `title`, `icon`, `parentId`, `links[]`, `excerpt`, `updatedAt` (can always be rebuilt from `files`) |
  | `assets` | path | `blob`, `size`, `lastUsed` (cache, at most 200 MB, least-recently-used eviction) |
  | `sync` | key | `headSha`, `etag`, `lastPullAt`, `lastPushAt`, `lastError` |
  | `search` | key | serialised MiniSearch index |

- **STORE-2** `baseText` and `baseSha` are the file as last seen on GitHub. `text` is the local version. `dirty = text !== baseText` (or `deleted`).
- **STORE-3** Every edit is written to `files.text` within 300 ms of the last keystroke and before the page is left. An edit is never lost because the network is down or the app is closed.
- **STORE-4** The `pages` index and the search index are updated from `files` on every local write and every pull.
- **STORE-5** After setup the app calls `navigator.storage.persist()`.
- **STORE-6** Several tabs on one device share the database. They exchange changes through `BroadcastChannel`, and only one tab syncs at a time (Web Locks API: `navigator.locks.request("sync")`).
- **STORE-7** The token is kept in plain text in IndexedDB (see §8). It never appears in logs, URLs, error messages or exports.

## 5. Sync

### 5.1 Principles

- **SYNC-1** The remote branch head is the truth. Locally the app keeps the commit it last synced with (`headSha`) plus local changes.
- **SYNC-2** No data is ever lost. Both the local and the remote version of a page must survive every case, either merged or as a copy.
- **SYNC-3** Only one pull or push runs at a time per device (STORE-6).

### 5.2 Pull

- **SYNC-4** When it runs:
  - app start
  - window becomes visible
  - every 60 s while visible
  - right before every push
  - "立即同步"
- **SYNC-5** Steps:
  1. `GET /repos/{o}/{r}/git/ref/heads/{b}` with `If-None-Match: <etag>`. A `304` means nothing changed; stop.
  2. `GET /repos/{o}/{r}/git/trees/{commitTreeSha}?recursive=1`. If the response is `truncated`, report "repo too large" (out of scope).
  3. For every page or meta path whose blob SHA differs from `baseSha`: `GET /repos/{o}/{r}/git/blobs/{sha}`, at most 6 in parallel.
  4. Apply each change as follows:
     - Not dirty locally → take the remote text (`baseText = text = remote`).
     - Dirty locally → three-way merge by line (node-diff3) with base = `baseText`, ours = `text`, theirs = remote. Clean merge → `text = merged`, `baseText = remote`. Overlapping changes → SYNC-6.
     - Deleted remotely and not dirty → delete locally.
     - Deleted remotely and dirty → keep the local page; it will be re-created by the next push. Show the notice 「這一頁在另一台裝置被刪除，但這台裝置有修改，所以保留了。」
     - Missing locally and new remotely → add it.
     - Same `id` at a new path (renamed or moved elsewhere) → treat as a move. Apply local edits to the new path.
  5. Set `headSha` and the new `etag`.
- **SYNC-6** Conflict (D10):
  - The page is marked `conflict` and shows a banner. The rest of the workspace keeps syncing. Pushes for that page are held until the user decides.
  - The dialog shows both versions with the changed text highlighted. The other device and time come from the `Device:` trailer of the latest remote commit touching the file (SYNC-9).
  - Choices:
    - 「使用這台電腦的版本」: local wins.
    - 「使用 iPhone 的版本」: remote wins; the local text is discarded, but it stays in page history only if it was ever pushed.
    - 「兩個都保留」 (default): remote stays in place, and local is saved as a sibling page `<title>（衝突副本 <device> <HH:mm>）`.
- **SYNC-6a** `.notes/settings.json` never raises a conflict. It is merged key by key:
  - `favorites`: union, minus entries removed on either side since base.
  - `order`: local wins for each parent.
  - `trash/index.json`: union by `id`.

### 5.3 Push

- **SYNC-7** When it runs:
  - 5 s after the last edit
  - when leaving a page
  - when the app is hidden (best effort)
  - on "立即同步"

  The "自動同步" switch in settings turns off the timer, leaving only the page-leave and manual triggers.
- **SYNC-8** Steps (Git Data API, one commit per push):
  1. Pull (SYNC-5) so the base is the current head.
  2. For new or changed attachments: `POST /git/blobs` (base64).
  3. `POST /git/trees` with `base_tree` = the head tree, plus:
     - an entry with inline `content` for each changed text file
     - an entry with the blob SHA for each attachment
     - an entry with `sha: null` for each deleted path
  4. `POST /git/commits` with `parents: [headSha]`.
  5. `PATCH /git/refs/heads/{b}` with `force: false`. On `422` (someone pushed meanwhile), go back to step 1. Give up after 3 tries and show the Error state.
  6. On success, for every pushed file set `baseText = text` and set `baseSha` from the new tree, then set `headSha`.
- **SYNC-9** Commit message, written in the UI language:

  ```
  更新「會議記錄」              ← or 更新 3 頁 / 新增「x」 / 移動「x」 / 刪除「x」 / 上傳圖片
                                 ← blank line
  Device: iPhone · Safari
  App: GitHub Notes 0.1.0
  ```

  The device name is derived from the user agent (`iPhone`, `iPad`, `Mac`, `Windows 電腦`, `Linux 電腦`, `Android`), followed by the browser.

### 5.4 Renames, moves, deletes

- **SYNC-10** A rename or move is one local operation. It covers:
  - deleting and adding the page file and every file in its child folder
  - rewriting the links in other pages (DATA-16)
  - updating `.notes/settings.json`

  It goes out in one push, with a message such as 「移動「專案 A」到「工作」」.

### 5.5 Status, errors, limits

- **SYNC-11** Sync/Status shows one of:
  - **已同步**: nothing dirty, last pull OK
  - **同步中…**: a pull or push is running
  - **離線 · N 頁待同步**: no network, N dirty pages
  - **同步失敗 · 點此重試**: any other error. A tap shows the reason: 「token 已過期」, 「token 沒有寫入權限」, 「GitHub 暫時無法使用」, 「repo 找不到」, …
- **SYNC-12** Network failures retry with exponential backoff (5 s → 5 min), and immediately on the browser `online` event.
- **SYNC-13** The app reads `x-ratelimit-remaining`. Below 100 it stops polling (SYNC-4 timer) until `x-ratelimit-reset`. A `403` or `429` with `retry-after` waits that long.
- **SYNC-14** Limits for v1: up to 5,000 pages, up to 1 MB per page, 25 MB per attachment. Above these limits the app warns but keeps working where it can.

### 5.6 Page history (D06)

- **SYNC-15** Versions come from `GET /repos/{o}/{r}/commits?path=<path>&per_page=30` (paged). Each row shows the date, time and the `Device:` trailer. The preview loads `GET /repos/{o}/{r}/contents/<path>?ref=<sha>`. 「還原這個版本」 replaces the local text with that version as a normal edit, which then syncs.
- **SYNC-16** History starts at the page's latest move or rename. The REST API cannot follow renames, so this is a known limitation.

## 6. Setup and device linking

### 6.1 First run

- **SETUP-1** With no `workspace` in config, the app shows D01/M01 (歡迎) and the main UI is not reachable.
- **SETUP-2** On iOS, when not running as a home-screen app (`navigator.standalone !== true`), the app shows M16 (加入主畫面) first. Reason: home-screen apps and Safari have separate storage. A small link 「仍要在 Safari 使用」 lets the user continue anyway.

### 6.2 Connect GitHub (D12/M12)

- **SETUP-3** 「在 GitHub 新建 repo ↗」 opens `https://github.com/new`. 「在 GitHub 建立 token ↗」 opens `https://github.com/settings/personal-access-tokens/new`. If GitHub supports pre-filling that form by URL parameters, the app pre-fills it: name 「GitHub Notes」, Contents read and write. Otherwise it opens the plain page; both are acceptable.
- **SETUP-4** Accepted input:
  - **Fine-grained token** (`^github_pat_[A-Za-z0-9_]{20,}$`): accepted.
  - **Classic token** (`^gh[pousr]_…`): accepted only after a warning that it can reach all of the user's repos.
  - **Anything else**: rejected inline with 「這看起來不是 GitHub token」.
  - Leading and trailing whitespace is removed.
- **SETUP-5** On 「連結」:
  1. `GET /user` (gives the login; 401 → 「token 無效或已過期」).
  2. Read `github-authentication-token-expiration` from the response, if present.
  3. `GET /user/repos?per_page=100&sort=updated` (paged). Zero repos → 「這把 token 沒有任何 repo 的權限」.
  4. Go to D13.

### 6.3 Choose repo (D13/M13)

- **SETUP-6** The list shows the repos the token can see, each with a Private or Public badge.
  - Choosing a public repo needs an extra confirmation: 「公開的 repo 任何人都看得到你的筆記」.
  - A repo where `permissions.push` is false cannot be chosen: 「這把 token 沒有寫入權限」.
- **SETUP-7** An empty repo (`409` on the ref) is initialised with one commit, made through `PUT /repos/{o}/{r}/contents/歡迎使用.md`. That page explains the basics. A non-empty repo is used as it is, and its existing `.md` files become pages.

### 6.4 First sync (D14/M14)

- **SETUP-8** The app downloads every page (SYNC-5) with a progress bar (files done / total), then builds the search index. 「開始使用」 is enabled when both are done. Attachments download lazily when first shown.

### 6.5 Link a new device with a QR code (D15/M15)

- **LINK-1** The payload is `ghnotes:1:` followed by base64url of the UTF-8 JSON `{"o":owner,"r":repo,"b":branch,"t":token}`. QR error correction level M.
- **LINK-2** On the source device: 設定 → 連結新裝置 → 「顯示 QR code」.
  - The code is shown only after that click.
  - It hides after 60 s, and also when the window loses visibility.
  - 「重新產生」 restarts the timer.
  - The warning text from D15 is always visible.
- **LINK-3** On the new device: 「用 QR code 從另一台裝置連結」 opens the camera (`getUserMedia`, rear camera), and frames are decoded with jsQR.
  1. A valid `ghnotes:1:` payload skips D12/D13.
  2. The app runs the checks from SETUP-5 and SETUP-6 for that repo.
  3. It goes to D14/M14.
  4. Any other QR content shows 「這不是 GitHub Notes 的 QR code」.
- **LINK-4** If camera access is denied or unavailable, the scanner offers 「改用設定碼」. The source device's QR dialog has 「複製設定碼」, which copies the same payload as text after a confirmation.

### 6.6 Changing the setup (D08)

- **SETUP-9** 更換 token:
  1. Validates like SETUP-5.
  2. Requires the new token to reach the current repo with write access.
  3. Replaces only the token.
- **SETUP-10** 更換 repo:
  1. Requires zero dirty files (or an explicit 「放棄 N 個未同步的修改」).
  2. Clears `files`, `pages`, `assets`, `sync` and `search`.
  3. Goes to D13.
- **SETUP-11** 中斷連結 has the same dirty-file rule as SETUP-10. It clears the whole database and the asset cache, then returns to D01/M01. 清除這台裝置的資料 clears the caches and re-downloads everything; the token and repo stay.
- **SETUP-12** Token expiry:
  - 14 days before the expiry date, a banner reads 「token 將在 N 天後到期」 with 「更換 token」.
  - Once the token has expired, the app is read-only with a banner. Local edits are still kept and pushed after the token is replaced.

## 7. Screens and behaviour

Each Figma frame is the visual spec for its screen. This section adds the behaviour the pictures cannot show.

| Code | Screen | Behaviour |
| --- | --- | --- |
| D01 M01 | 歡迎 | SETUP-1, SETUP-2; two entry points (開始設定, QR code) |
| D02 M03 | 頁面 | See UI-1 to UI-6 |
| D03 M06 | 插入區塊 | UI-7 |
| D04 M09 | 文字格式 | UI-8 |
| D05 M07 | 搜尋 | UI-9 |
| D06 | 頁面歷史 | SYNC-15, SYNC-16 |
| D07 | 垃圾桶 | DATA-21; search box filters by title; 還原 and 永久刪除 (with confirmation) |
| D08 | 設定 | §6.6; sections 連結, 外觀與語言 (theme: 跟隨系統 / 淺色 / 深色), 鍵盤快捷鍵 (§7.1 as a list), 同步與儲存, 匯出 (download all as `.zip`) |
| D09 M10 M11 | 深色模式 | Follows `prefers-color-scheme` unless set in D08 |
| D10 | 同步衝突 | SYNC-6 |
| D11 | 新頁面 | UI-10 |
| D12–D14 M12–M14 | 首次設定 | §6.2–6.4 |
| D15 M15 | 連結新裝置 | §6.5 |
| M02 | 首頁 | UI-11 |
| M04 | 編輯中 | UI-12 |
| M05 | 所有頁面 | Same tree as the desktop sidebar; tap to open, long-press for the page menu (M08) |
| M08 | 頁面選單 | 加入我的最愛, 複製連結 (`#/p/<id>`), 複製頁面, 移動到…, 頁面歷史, 匯出 Markdown, 刪除頁面 |
| M16 | 加入主畫面 | SETUP-2 |

- **UI-1** Sidebar (desktop):
  - Width 240 px, resizable from 200 to 480; collapsed and expanded with `⌘\`.
  - Rows can be dragged to reorder or to move under another page; dropping onto the middle of a row makes the page its child.
  - Hovering a row shows `…` (page menu) and `+` (new child page).
  - Favourites come from `settings.json`.
- **UI-2** Page header:
  - 「加入圖示」 and 「加入封面」 appear on hover; the icon is chosen from an emoji picker.
  - The title is a plain-text field; pressing `Enter` moves into the body.
- **UI-3** Block handle: hovering a block shows `+` (insert below and open the `/` menu) and `⋮⋮`. Dragging `⋮⋮` moves the block; clicking it opens the block menu: 刪除, 複製, 轉換成…, 顏色, 移到頁面….
- **UI-4** Top bar:
  - breadcrumb (each part opens that page)
  - Sync/Status (SYNC-11; clicking it runs 立即同步)
  - 「已編輯 N 分鐘前」 (local `updatedAt`)
  - 頁面歷史, 我的最愛 toggle, and the `…` page menu
- **UI-5** Clicking a link to another page opens it inside the app. External links open in a new tab with `rel="noopener noreferrer"`.
- **UI-6** A 「反向連結」 section at the bottom of a page lists the pages that link to it.
- **UI-7** The `/` menu (D03) opens when `/` is typed at the start of a block or after a space.
  - Typing filters by the Chinese name or an English alias (`h1`, `todo`, `bullet`, `code`, `table`, `quote`, `callout`, `toggle`, `divider`, `image`, `page`). Matching is case- and width-insensitive.
  - `↑`/`↓` move, `Enter` inserts, `Esc` closes.
  - On iPhone the same list is the M06 sheet, opened from `+` on the keyboard toolbar.
- **UI-8** The format toolbar (D04) appears above any non-empty text selection.
  - 文字 ▾ turns the block into another type.
  - It has B, I, U, S, code, link, colour, and `…`.
  - The colour menu has 預設 plus the nine text colours and the same ten background colours (DATA-11). The last colour used is remembered per device.
- **UI-9** Search (D05) opens with `⌘K` (no selection) or `⌘P`. On iPhone it is the 搜尋 tab.
  - Results are ranked: title matches first, then headings, then body.
  - Each result shows its path and a snippet with the match in medium weight.
  - Filters: 只搜尋標題, 排序 (最相關 / 最近編輯), 日期 (any / 7 days / 30 days).
  - `Enter` opens the result, `⌘Enter` opens it in a new browser tab.
  - Chinese is segmented with `Intl.Segmenter("zh-TW", {granularity: "word"})`; single characters also match by prefix.
- **UI-10** 新增頁面 (sidebar, `⌘N`, or `+` on a row) creates a local page titled 未命名 and opens it with the caret in the title (D11).
  - A page that is still untitled and empty when the user leaves it is discarded and never pushed.
  - 「或從這裡開始」 offers 空白頁面, 待辦清單 and 會議記錄範本. These are the built-in starter contents; this is not the "templates" feature.
- **UI-11** Home (M02):
  - Greeting by local time: 早安 (05–11), 午安 (11–18), 晚安 (18–05).
  - 最近造訪: the last 8 pages opened on this device.
  - 我的最愛, then the top-level 頁面 list.
- **UI-12** iPhone editing (M04): the keyboard toolbar sits above the keyboard (`visualViewport` resize). It has `+` (M06), 轉換成, 待辦, 清單, 拍照/圖片 (`<input type="file" accept="image/*">`, with the camera allowed), 連結, 顏色, 復原, and 收起鍵盤.
- **UI-13** Toasts confirm actions that have no other visible result (「已複製連結」, 「已移到垃圾桶 · 復原」). Undo is offered for deletes and moves for 5 s.
- **UI-14** When a new app version is ready, the service worker shows 「有新版本 · 重新整理」. The app never reloads by itself while there are unsaved edits.

### 7.1 Keyboard shortcuts (Notion parity)

On Windows and Linux, `⌘` is `Ctrl`, and `⌘⌥<n>` is `Ctrl+Shift+<n>`.

| Shortcut | Action |
| --- | --- |
| `⌘K` (no selection) / `⌘P` | Search |
| `⌘K` (text selected) | Add link |
| `⌘N` | New page |
| `⌘\` | Toggle sidebar |
| `⌘⇧L` | Toggle dark mode |
| `⌘[` / `⌘]` | Back / forward |
| `⌘B` `⌘I` `⌘U` `⌘⇧S` `⌘E` | Bold, italic, underline, strikethrough, inline code |
| `⌘⌥0` … `⌘⌥8` | Text, H1, H2, H3, to-do, bullet, numbered, toggle, code |
| `⌘Enter` | Check / uncheck to-do; open / close toggle |
| `⌘D` | Duplicate block |
| `⌘⇧↑` / `⌘⇧↓` | Move block up / down |
| `Tab` / `⇧Tab` | Indent / outdent (DATA-13) |
| `Esc` | Select the current block |
| `⌘Z` / `⌘⇧Z` | Undo / redo |

Markdown shortcuts while typing:

| Typed | Result |
| --- | --- |
| `# ` / `## ` / `### ` | Heading 1 / 2 / 3 |
| `- ` or `* ` | Bulleted list |
| `1. ` | Numbered list |
| `[] ` | To-do |
| `> ` | Toggle (as in Notion) |
| `" ` | Quote (as in Notion) |
| ```` ``` ```` | Code block |
| `---` | Divider |
| `**x**` `*x*` `~x~` `` `x` `` | Bold, italic, strikethrough, inline code |

## 8. Security

- **SEC-1** Token scope. The UI and the docs tell users to create a fine-grained token with:
  - only the notes repo selected
  - Contents: Read and write
  - an expiry date

  Classic tokens trigger a warning (SETUP-4).
- **SEC-2** The token is used only in the `Authorization` header of requests to `https://api.github.com`. It MUST NOT appear in URLs, logs, error reports, exports or the service-worker cache.
- **SEC-3** Content Security Policy is set with a `<meta>` tag, because GitHub Pages cannot set headers:

  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https:; connect-src 'self' https://api.github.com;
  worker-src 'self' blob:; media-src 'self' blob: mediastream:;
  object-src 'none'; base-uri 'self'; form-action 'none'
  ```

- **SEC-4** HTML inside Markdown is sanitised with DOMPurify (bundled) before rendering. Allowed:
  - elements: `details`, `summary`, `span` (only `data-color` and `data-bg`), `u`, `br`, `kbd`, `sub`, `sup`
  - URLs: links only `http(s):`, `mailto:` and relative paths; images only relative `_assets` paths, `blob:` and `https:`

  Everything else is shown as text.
- **SEC-5** The QR code and the setup code contain the token. They are shown only on explicit request, with a warning, and only for 60 s (LINK-2).
- **SEC-6** Known risk, accepted by the owner. GitHub Pages serves all of an account's project sites from one origin (`tinggeorge.github.io`), so another Pages site on that account could read this app's IndexedDB. Mitigations:
  - keep other Pages sites free of third-party code
  - or move this app to a custom domain, which needs no code change
- **SEC-7** Lost device: revoking the token on github.com is enough. The notes themselves remain in the repo.

## 9. Non-functional requirements

- **NFR-1** Performance on an iPhone 12 with 1,000 cached pages:
  - Cold start to an interactive page view: ≤ 2 s.
  - Typing latency: ≤ 16 ms per keystroke.
  - Search over 5,000 pages: ≤ 100 ms.
  - First sync of 1,000 pages: ≤ 60 s.
- **NFR-2** Works fully offline after the first sync: open, read, edit, create, move, delete and search. History, attachments not yet cached, and setup need the network, and say so.
- **NFR-3** Accessibility:
  - every action reachable by keyboard, with a visible focus ring
  - text contrast WCAG AA in light and dark
  - `prefers-reduced-motion` respected
  - VoiceOver labels on icon-only buttons
- **NFR-4** All UI strings live in one `zh-TW` strings file.

## 10. Testing and acceptance

- **TEST-1** Unit tests (Vitest):
  - the Markdown corpus round-trips for every row of §3.4 (DATA-15), including Chinese text, nesting, colours and unknown constructs
  - file-name rules (DATA-4 to DATA-6) and the link rewriter (DATA-16)
  - three-way merge (SYNC-5 step 4) and the settings merge (SYNC-6a)
  - QR payload encode/decode (LINK-1)
- **TEST-2** A fake GitHub API (an in-memory git object store implementing the endpoints in §5 and §6) is used by the sync-engine unit tests and the end-to-end tests. Tests never touch real GitHub.
- **TEST-3** End-to-end tests (Playwright): Chromium and WebKit, at 1440×900 and 393×852. Scenarios:
  - setup with an empty repo and with an existing repo
  - create / edit / rename / move / delete / restore pages, with the resulting commits checked
  - edit offline, reconnect, and confirm one commit
  - two browser contexts editing the same page: a clean merge, and a conflict resolved each of the three ways
  - Chinese search
  - QR payload handling (the payload is injected; camera capture itself is not testable)
  - token expired, and token without write permission
- **TEST-4** CI (GitHub Actions) runs lint, typecheck, unit and e2e tests on every push. A push to `main` deploys to GitHub Pages only if everything passes.
- **TEST-5** Before each release, key screens are compared with Figma at both sizes, in light and dark, by a person.
- **TEST-6** v1 is done when every MUST in this spec has a passing test or a checked manual item, and the owner has used it on an iPhone and a PC for a week without losing data.

## 11. Milestones

1. **Skeleton**: Vite + React + TS, PWA, routing, design tokens, CI and Pages deploy, D01/M01, M16.
2. **Setup and read**: D12–D14 and M12–M14, pull (SYNC-5), sidebar tree, read-only page view.
3. **Write**: editor with the full §3.4 mapping, push (SYNC-8), new / rename / move / delete, trash.
4. **Robust sync**: offline queue, conflicts (D10), rate limits, multiple tabs, token expiry.
5. **Find and recover**: search, page history, backlinks, favourites, recents.
6. **iPhone polish**: M02–M09, keyboard toolbar, camera upload, QR linking (D15/M15).
7. **Release**: dark mode check, accessibility, performance budget, the acceptance run (TEST-6).

## 12. Defaults chosen (say if you disagree)

| Topic | Default | Alternative |
| --- | --- | --- |
| Auto-sync delay | 5 s after the last edit (many small commits; history groups them by time) | 30 s, or only when leaving a page |
| Trash | Deleted permanently after 30 days (as in Notion); still in git history | Keep forever |
| Untitled empty pages | Discarded when left | Kept as 未命名 |
| Public repos | Allowed after a confirmation | Not allowed at all |
| Classic tokens | Allowed after a warning | Only fine-grained tokens |
| Polling | Every 60 s while the app is visible | Only on open and focus |
| Attachment cap | 25 MB per file; images scaled to 2560 px | Other limits |

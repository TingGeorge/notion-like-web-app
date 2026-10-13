# GitHub Notes — working notes

A Notion-like PWA that stores pages as Markdown in the user's private GitHub repo. No backend.
**SPEC.md is the source of truth**; requirement IDs (`DATA-3`, `SYNC-7`, …) are referenced in code and tests.
Design: Figma file `N3TDXtJeqjUd6wiUBHPzNu` (screens D01–D15 desktop, M01–M22 iPhone).

## Commands

- `npm run dev` — dev server
- `npm test` — Vitest unit tests (`src/**/*.test.ts`, `test/**/*.test.ts`); Node env with fake-indexeddb.
  Use `// @vitest-environment happy-dom` at the top of a test file that needs the DOM.
- `npm run typecheck`, `npm run lint`, `npm run build`
- `npm run e2e` — Playwright against a production build. In this container only Chromium is installed:
  `PW_PROJECTS=chromium,chromium-phone npm run e2e`.

## Layout

| Path | What |
| --- | --- |
| `src/lib/types.ts` | Shared types and the `files` table conventions (read this first) |
| `src/lib/schema.ts` | ProseMirror schema — the contract between Markdown and the editor |
| `src/lib/markdown/` | Markdown ⇄ editor doc, frontmatter, link rewriting (§3.3–3.4) |
| `src/lib/data/` | Names and paths (DATA-2–6), ULID, links, tree, settings/trash JSON |
| `src/lib/github/` | GitHub REST/GraphQL client |
| `src/lib/sync/` | Sync engine (§5) |
| `src/lib/workspace/` | Local page operations and the pages index |
| `src/lib/store/db.ts` | Dexie database (STORE-1) |
| `src/lib/search/` | MiniSearch + Intl.Segmenter |
| `src/lib/link/` | QR device linking crypto (LINK-1) |
| `src/editor/` | ProseMirror editor component and plugins |
| `src/app/`, `src/ui/` | App shell, screens, shared UI primitives |
| `src/strings/` | Every UI string (NFR-4): `zh-TW.ts` (reference) and `en.ts`; code imports `t` from `src/strings` |
| `test/fake-github/` | In-memory fake GitHub API used by unit and e2e tests (TEST-2) |
| `e2e/` | Playwright tests |

## Rules

- Tests never touch real GitHub (TEST-2). Use the fake GitHub.
- No UI string literals outside `src/strings/`. Add a string to `zh-TW.ts` and `en.ts` together (the type checker enforces the same keys).
- The token never appears in logs, URLs, errors or exports (SEC-2, STORE-7).
- Colours only through the CSS custom properties in `src/styles/tokens.css`.
- No runtime third-party scripts, fonts or network calls other than `api.github.com` (ARCH-3, ARCH-4).
- The editor ignores key events while `isComposing` (UI-17, IME input).

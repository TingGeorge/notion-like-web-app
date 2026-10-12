/**
 * Repository paths and page file names (DATA-2 to DATA-6).
 * All paths are repo paths without a leading slash, using `/` as the separator.
 */
import { ASSETS_DIR, SETTINGS_PATH, TRASH_DIR, TRASH_INDEX_PATH, type FileKind } from '../types'

export const UNTITLED = '未命名'
export const MAX_NAME_BYTES = 150

const FULL_WIDTH: Record<string, string> = {
  '/': '／',
  '\\': '＼',
  ':': '：',
  '*': '＊',
  '?': '？',
  '"': '＂',
  '<': '＜',
  '>': '＞',
  '|': '｜',
}

const encoder = new TextEncoder()

export function utf8Length(s: string): number {
  return encoder.encode(s).length
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path)
}

/** `工作/會議記錄.md` → `會議記錄`. */
export function pageNameOf(path: string): string {
  return basename(path).replace(/\.md$/i, '')
}

/** DATA-3: the folder holding a page's children. `工作.md` → `工作`. */
export function childDirOf(pagePath: string): string {
  return pagePath.replace(/\.md$/i, '')
}

/** DATA-3: the page that owns a folder. `工作/會議記錄.md` → `工作.md`; a root page → null. */
export function parentPagePathOf(pagePath: string): string | null {
  const dir = dirname(pagePath)
  return dir ? `${dir}.md` : null
}

/** DATA-2: `.`-folders anywhere, and `_assets/` at the root. Dot-files are treated the same way. */
export function isReservedPath(path: string): boolean {
  if (path.startsWith(ASSETS_DIR) || path === ASSETS_DIR.slice(0, -1)) return true
  return path.split('/').some((segment) => segment.startsWith('.'))
}

/** DATA-2: every `.md` file outside reserved folders is a page. */
export function isPagePath(path: string): boolean {
  return isMarkdownPath(path) && !isReservedPath(path)
}

/** Which kind of `files` row a repo path becomes, or null if the app ignores it. */
export function classifyPath(path: string): Exclude<FileKind, 'blob'> | null {
  if (path === SETTINGS_PATH || path === TRASH_INDEX_PATH) return 'meta'
  if (path.startsWith(TRASH_DIR)) return isMarkdownPath(path) ? 'trash' : null
  return isPagePath(path) ? 'page' : null
}

/** DATA-6 comparison key: NFC, case-insensitive. */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

let graphemes: Intl.Segmenter | null = null

function splitGraphemes(s: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    graphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(graphemes.segment(s), (seg) => seg.segment)
  }
  return Array.from(s)
}

/** Truncate at a character (grapheme) boundary so the UTF-8 length is at most `maxBytes`. */
export function truncateUtf8(s: string, maxBytes: number): string {
  if (utf8Length(s) <= maxBytes) return s
  let out = ''
  let bytes = 0
  for (const g of splitGraphemes(s)) {
    const n = utf8Length(g)
    if (bytes + n > maxBytes) break
    out += g
    bytes += n
  }
  return out
}

function trimSpacesAndDots(s: string): string {
  return s.replace(/^[\s.]+/u, '').replace(/[\s.]+$/u, '')
}

/**
 * DATA-4: the file name (without `.md`) for a title.
 * `atRoot` applies the `_assets` rule from DATA-2.
 */
export function titleToName(title: string, atRoot = false, maxBytes = MAX_NAME_BYTES): string {
  let name = title.normalize('NFC').replace(/[/\\:*?"<>|]/g, (c) => FULL_WIDTH[c])
  // Control characters: C0, DEL and C1.
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  name = trimSpacesAndDots(name)
  if (!name) name = UNTITLED
  name = trimSpacesAndDots(truncateUtf8(name, maxBytes))
  if (!name) name = UNTITLED
  if (atRoot && nameKey(name) === '_assets') name = '＿assets'
  return name
}

/**
 * DATA-6: make `name` unique among `taken` (names already used in the folder, compared with
 * `nameKey`). On a clash the name gets ` (2)`, ` (3)`, … while staying within 150 bytes.
 */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const keys = new Set(Array.from(taken, nameKey))
  if (!keys.has(nameKey(name))) return name
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`
    const base = trimSpacesAndDots(truncateUtf8(name, MAX_NAME_BYTES - utf8Length(suffix))) || UNTITLED
    const candidate = base + suffix
    if (!keys.has(nameKey(candidate))) return candidate
  }
}

/**
 * DATA-4 to DATA-6 together: the path for a page titled `title` inside folder `dir`.
 * `takenNames` are the names (without `.md`) of pages already in that folder, including virtual
 * pages (folders without a `.md`), excluding the page being renamed.
 * Returns the path and whether the exact title must go into the frontmatter (DATA-5).
 */
export function pagePathFor(
  title: string,
  dir: string,
  takenNames: Iterable<string>,
): { path: string; name: string; titleInFrontmatter: boolean } {
  const name = uniqueName(titleToName(title, dir === ''), takenNames)
  return { path: joinPath(dir, `${name}.md`), name, titleInFrontmatter: name !== title }
}

/** DATA-5: the title of a page from its frontmatter title or its file name. */
export function titleOf(path: string, frontmatterTitle: string | null | undefined): string {
  if (typeof frontmatterTitle === 'string' && frontmatterTitle.length > 0) return frontmatterTitle
  return pageNameOf(path)
}

/** Every ancestor folder of a path: `a/b/c.md` → [`a`, `a/b`]. */
export function ancestorDirs(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** True when `path` is `dir` itself or inside it. */
export function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`)
}

/**
 * DATA-22: where a trashed page lives. The page file goes to `.notes/trash/<entryId>/<name>.md`
 * and its child folder to `.notes/trash/<entryId>/<name>/…`.
 */
export function trashPathFor(entryId: string, originalPath: string): string {
  return `${TRASH_DIR}${entryId}/${basename(originalPath)}`
}

/** The trash entry id a trashed path belongs to, or null. */
export function trashEntryIdOf(path: string): string | null {
  if (!path.startsWith(TRASH_DIR)) return null
  const rest = path.slice(TRASH_DIR.length)
  const i = rest.indexOf('/')
  return i === -1 ? null : rest.slice(0, i)
}

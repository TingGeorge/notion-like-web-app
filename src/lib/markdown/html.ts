/**
 * The few HTML forms the editor understands (§3.4): toggles, colour spans, underline, the
 * callout icon comment (DATA-12) and an image with a width (DATA-19). Everything else in HTML is
 * kept raw (DATA-15).
 */
import { IMAGE_WIDTH_MAX, IMAGE_WIDTH_MIN, isNotionColor, type NotionColor } from '../schema'

/** Inline tags that are marks: `<u>`, colour spans, and the HTML forms of bold / italic / strike. */
export type InlineTagName = 'u' | 'span' | 'strong' | 'b' | 'em' | 'i' | 'del' | 's'

export type InlineTag =
  | { kind: 'open'; name: Exclude<InlineTagName, 'span'> }
  | { kind: 'span-open'; color: NotionColor | null; bg: NotionColor | null }
  | { kind: 'close'; name: InlineTagName }

const ATTR = /\s+(data-color|data-bg)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gy

/**
 * Recognise `<u>`, `<span data-color=".." data-bg="..">` (either or both), `<strong>`/`<b>`,
 * `<em>`/`<i>`, `<del>`/`<s>` and their closing tags. The serializer writes bold, italic and
 * strikethrough as HTML only where the `*`/`~` form cannot express the nesting.
 */
export function parseInlineTag(html: string): InlineTag | null {
  const simple = /^<(\/?)(u|strong|b|em|i|del|s|span)\s*>$/i.exec(html)
  if (simple) {
    const name = simple[2].toLowerCase() as InlineTagName
    if (simple[1]) return { kind: 'close', name }
    if (name !== 'span') return { kind: 'open', name }
    return null
  }
  const open = /^<span(?=[\s>])/i.exec(html)
  if (!open) return null
  let color: NotionColor | null = null
  let bg: NotionColor | null = null
  let pos = open[0].length
  ATTR.lastIndex = pos
  let m: RegExpExecArray | null
  while ((m = ATTR.exec(html))) {
    const value = m[2] ?? m[3] ?? m[4]
    if (!isNotionColor(value)) return null
    const name = m[1].toLowerCase()
    if (name === 'data-color') {
      if (color !== null) return null
      color = value
    } else {
      if (bg !== null) return null
      bg = value
    }
    pos = ATTR.lastIndex
  }
  if (!/^\s*>$/.test(html.slice(pos))) return null
  if (color === null && bg === null) return null
  return { kind: 'span-open', color, bg }
}

/** HTML text escaping for the toggle summary: `&`, `<`, `>` and line breaks. */
export function escapeHtmlText(text: string): string {
  return text.replace(/[&<>\n]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&#10;'))
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

/** Decode the character references the summary may contain; null if it has an unknown one. */
export function decodeHtmlText(text: string): string | null {
  let ok = true
  const out = text.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]*));/g, (all, hex, dec, name) => {
    if (name !== undefined) {
      const v = NAMED[name as string]
      if (v === undefined) ok = false
      return v ?? all
    }
    const code = hex !== undefined ? parseInt(hex as string, 16) : parseInt(dec as string, 10)
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd'
    return String.fromCodePoint(code)
  })
  return ok ? out : null
}

/**
 * Toggle opening as written by the serializer: `<details>\n<summary>Title</summary>`.
 * Also accepts `<details open>`, other whitespace, and both tags on one line.
 */
const DETAILS_OPEN = /^[ \t]*<details(?:\s+open(?:\s*=\s*(?:""|''|"open"|'open'|open))?)?\s*>\s*<summary\s*>([^<]*)<\/summary\s*>[ \t]*$/i
const DETAILS_CLOSE = /^[ \t]*<\/details\s*>[ \t]*$/i

/** The decoded summary if `html` is a toggle opening, else null. */
export function parseDetailsOpen(html: string): string | null {
  const m = DETAILS_OPEN.exec(html)
  if (!m) return null
  return decodeHtmlText(m[1])
}

/**
 * True for an HTML block that opens a `<details>` without closing it (used to pair nested
 * toggles; an invalid one makes the whole toggle raw).
 */
export function looksLikeDetailsOpen(html: string): boolean {
  return /^[ \t]*<details[\s>]/i.test(html) && !/<\/details\s*>/i.test(html)
}

export function isDetailsClose(html: string): boolean {
  return DETAILS_CLOSE.test(html)
}

const ICON = /^<!--\s*icon:\s*(.*?)\s*-->$/

/** DATA-12: `<!-- icon: 🧠 -->` → `🧠`. */
export function parseIconComment(html: string): string | null {
  const m = ICON.exec(html.trim())
  if (!m || m[1] === '' || /--|>|\n/.test(m[1])) return null
  return m[1]
}

/** DATA-19: an image with a display width, as `<img src="…" alt="…" width="320">`. */
export interface ImgTag {
  src: string
  alt: string
  title: string | null
  width: number
}

const IMG_ATTR = /\s+([a-zA-Z]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/y

/**
 * `<img>` with `src`, an optional `alt` and `title`, and a whole-pixel `width` within bounds, in
 * any order and quoting, and nothing else; else null (the HTML stays raw).
 */
export function parseImgTag(html: string): ImgTag | null {
  const open = /^[ \t]*<img(?=\s)/i.exec(html)
  if (!open) return null
  const values = new Map<string, string>()
  let pos = open[0].length
  for (;;) {
    IMG_ATTR.lastIndex = pos
    const m = IMG_ATTR.exec(html)
    if (!m) break
    const name = m[1].toLowerCase()
    const value = decodeHtmlText(m[2] ?? m[3] ?? m[4])
    if (!['src', 'alt', 'title', 'width'].includes(name) || values.has(name) || value === null) return null
    values.set(name, value)
    pos = IMG_ATTR.lastIndex
  }
  if (!/^\s*\/?>[ \t]*\n?$/.test(html.slice(pos))) return null
  const src = values.get('src')
  const width = values.get('width')
  if (!src || width === undefined || !/^[1-9]\d*$/.test(width)) return null
  const px = Number(width)
  if (px < IMAGE_WIDTH_MIN || px > IMAGE_WIDTH_MAX) return null
  return { src, alt: values.get('alt') ?? '', title: values.get('title') || null, width: px }
}

/** Attribute value escaping (double quotes). */
function escapeAttr(text: string): string {
  return text.replace(/[&"<>\n]/g, (c) => (c === '&' ? '&amp;' : c === '"' ? '&quot;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&#10;'))
}

/** The canonical form `parseImgTag` reads back. */
export function imgTag(img: ImgTag): string {
  const title = img.title ? ` title="${escapeAttr(img.title)}"` : ''
  return `<img src="${escapeAttr(img.src)}" alt="${escapeAttr(img.alt)}"${title} width="${img.width}">`
}

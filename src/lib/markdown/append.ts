/**
 * Markdown text helpers for the editor: appending blocks to another page's body (「移到頁面…」)
 * and reading pasted text.
 */
import type { RootContent } from 'mdast'
import { canonicalize } from './canonicalize'
import { isUnterminated, parseMdastPiece } from './mdast'
import { parseBody } from './parse'
import { serializeCanonical } from './serialize'

function slice(text: string, node: RootContent): string {
  return text.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0)
}

/** What closes a block that runs to the end of `text` (an unclosed fence, math or HTML block). */
function closingFor(text: string, node: RootContent): string | null {
  if (!isUnterminated(node, text, 0)) return null
  const source = slice(text, node).replace(/^[ \t]+/, '')
  if (node.type === 'code' || node.type === 'math') {
    const fence = /^(`{3,}|~{3,}|\${2,})/.exec(source)
    return fence ? fence[1] : null
  }
  const lower = source.toLowerCase()
  const kind1 = /^<(script|pre|style|textarea)/.exec(lower)
  if (kind1) return `</${kind1[1]}>`
  if (lower.startsWith('<!--')) return '-->'
  if (lower.startsWith('<?')) return '?>'
  if (lower.startsWith('<![cdata[')) return ']]>'
  return '>'
}

/** The marker of a list's first item: `-`, `*`, `+`, `.` or `)`. */
function listMarker(text: string, node: RootContent): string | null {
  if (node.type !== 'list') return null
  const m = /^[ \t]*(?:([-+*])|\d{1,9}([.)]))/.exec(slice(text, node))
  return m ? (m[1] ?? m[2]) : null
}

/** Whether `whole` reads as the top-level blocks of `head` followed by those of `tail`. */
function readsAsBoth(whole: string, head: string, tail: string, offset: number): boolean {
  const w = parseMdastPiece(whole).children
  const h = parseMdastPiece(head).children
  const t = parseMdastPiece(tail).children
  if (w.length !== h.length + t.length) return false
  return w.every((node, i) => {
    const expected = i < h.length ? h[i] : t[i - h.length]
    const shift = i < h.length ? 0 : offset
    return (
      node.type === expected.type &&
      (node.position?.start.offset ?? 0) === (expected.position?.start.offset ?? 0) + shift &&
      (node.position?.end.offset ?? 0) === (expected.position?.end.offset ?? 0) + shift
    )
  })
}

/**
 * Append blocks (`markdown`, as written by `serializeMarkdown`) to a page body so that they
 * stay the blocks they are and the body keeps its own (「移到頁面…」):
 * - a fence, math block or HTML block left open at the end of the body is closed first (it ran
 *   to the end of the page, so it reads the same), otherwise it would take in the new blocks;
 * - a list that would continue the body's last list (same marker) is written with another
 *   marker (`*` / `+`, `1)`), so it stays its own list in the Markdown (the editor shows two
 *   adjacent lists of one kind as one list, as it would after moving blocks in the page);
 * - after a list, the first line loses its indentation (it would continue the last item);
 * - if the blocks still do not read as separate blocks, an empty HTML comment separates them.
 * Returns the new body with one trailing newline.
 */
export function appendMarkdown(body: string, markdown: string): string {
  const base = body.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  let moved = markdown.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!moved) return base ? `${base}\n` : ''
  if (!base) return `${moved}\n`

  const baseNodes = parseMdastPiece(base).children
  const last = baseNodes[baseNodes.length - 1]
  let head = base
  if (last) {
    const close = closingFor(base, last)
    if (close) head = `${base}\n${close}`
  }
  const prevMarker = last ? listMarker(base, last) : null
  // An indented first line (a raw block) would continue the list's last item.
  if (last?.type === 'list') moved = moved.replace(/^[ \t]+/, '')
  if (prevMarker) {
    const movedNodes = parseMdastPiece(moved).children
    const first = movedNodes[0]
    if (first && listMarker(moved, first) === prevMarker) {
      moved = serializeCanonical(canonicalize(parseBody(moved)), { avoidListMarker: prevMarker }).replace(/\n+$/, '')
    }
  }
  const joined = `${head}\n\n${moved}`
  if (readsAsBoth(joined, head, moved, head.length + 2)) return `${joined}\n`
  return `${head}\n\n<!-- -->\n\n${moved}\n`
}

/**
 * Pasted text: `$…$` pairs that are prices rather than math are made literal (`\$`), so that
 * `$5 and $6` stays text instead of becoming a math block the editor keeps raw. A pair is math
 * (as in pandoc) only when its content does not start or end with whitespace and no digit
 * follows the closing `$`. Code is never touched.
 */
export function escapeProseDollars(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, '\n')
  for (let round = 0; round < 20 && text.includes('$'); round++) {
    const escapes: number[] = []
    const visit = (node: RootContent): void => {
      if (node.type === 'inlineMath') {
        const start = node.position?.start.offset ?? 0
        const end = node.position?.end.offset ?? 0
        const m = /^(\$+)([\s\S]*)\1$/.exec(text.slice(start, end))
        if (m && m[1].length === 1 && (/^\s|\s$/.test(m[2]) || /\d/.test(text.charAt(end)))) escapes.push(start, end - 1)
        return
      }
      if ('children' in node) for (const child of node.children) visit(child as RootContent)
    }
    for (const node of parseMdastPiece(text).children) visit(node)
    if (escapes.length === 0) break
    for (const at of escapes.sort((a, b) => b - a)) text = `${text.slice(0, at)}\\${text.slice(at)}`
  }
  return text
}

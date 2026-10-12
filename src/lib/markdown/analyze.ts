/**
 * `analyzePage`: everything the pages index and search need from a page file.
 *
 * It runs for every page in the repo (up to 5,000), and micromark needs several milliseconds
 * per kilobyte, so this is a single-pass line scanner instead of a full parse:
 *
 * - Links: every inline link/image destination (`](…)`) and every reference definition
 *   (`[x]: …`) anywhere in the body, read with CommonMark's destination rules (angle brackets,
 *   balanced parentheses, backslash escapes, character references). This is a superset of the
 *   links micromark finds — it also counts link syntax inside code — which is the safe side:
 *   the list is used to find pages whose links must be rewritten when a page moves (DATA-17),
 *   and `rewriteLinks` itself only touches real links.
 * - Headings: ATX and setext headings outside fenced code, inside quotes and lists too.
 * - Plain text: block text with the Markdown syntax removed (emphasis markers, link and image
 *   syntax, HTML tags, escapes, character references); an approximation meant for search.
 */
import { parseHref } from '../data/links'
import { readPageMeta, splitPageFile } from './frontmatter'
import type { PageAnalysis } from './index'

const EXCERPT_LENGTH = 200

export function analyze(text: string): PageAnalysis {
  const { frontmatter, body } = splitPageFile(text)
  const meta = readPageMeta(frontmatter)
  const src = body.replace(/\r\n?/g, '\n')
  const links = collectLinks(src)
  const { headings, blocks } = scanBlocks(src)
  const plainText = blocks.join('\n')
  return { meta, links, headings, plainText, excerpt: excerptOf(plainText) }
}

function excerptOf(plain: string): string {
  const oneLine = plain.replace(/\s+/g, ' ').trim()
  const chars = Array.from(oneLine.slice(0, EXCERPT_LENGTH * 2))
  return chars.length <= EXCERPT_LENGTH ? chars.join('') : chars.slice(0, EXCERPT_LENGTH).join('').trimEnd()
}

// ---------------------------------------------------------------------------------------------
// Links

const NAMED_REFS: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

/** Backslash escapes and (common) character references, as in a link destination. */
function decodeDestination(s: string): string {
  if (!/[\\&]/.test(s)) return s
  return s.replace(/\\([!-/:-@[-`{-~])|&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g, (all, esc, hex, dec, name) => {
    if (esc !== undefined) return esc as string
    if (name !== undefined) return NAMED_REFS[name as string] ?? all
    const code = hex !== undefined ? parseInt(hex as string, 16) : parseInt(dec as string, 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd'
  })
}

/** Read a link destination starting at `i` (after optional whitespace); null if there is none. */
function readDestination(src: string, i: number): string | null {
  // Whitespace, including at most one line ending (container prefixes are not stripped:
  // they only matter for multi-line destinations, which are rare).
  while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++
  if (src[i] === '\n') {
    i++
    while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '>')) i++
  }
  if (src[i] === '<') {
    let j = i + 1
    while (j < src.length && src[j] !== '>' && src[j] !== '\n' && src[j] !== '<') j += src[j] === '\\' ? 2 : 1
    return src[j] === '>' ? decodeDestination(src.slice(i + 1, j)) : null
  }
  let j = i
  let depth = 0
  while (j < src.length) {
    const c = src.charCodeAt(j)
    if (c <= 0x20 || c === 0x7f) break
    if (c === 0x5c /* \ */ && j + 1 < src.length) {
      j += 2
      continue
    }
    if (c === 0x28 /* ( */) depth++
    else if (c === 0x29 /* ) */) {
      if (depth === 0) break
      depth--
    }
    j++
  }
  return j > i ? decodeDestination(src.slice(i, j)) : null
}

const DEFINITION = /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)*\[(?:[^\]\\\n]|\\.){1,999}\]:/gm

function collectLinks(src: string): string[] {
  const found = new Set<string>()
  const add = (dest: string | null): void => {
    if (dest === null || !dest.startsWith('/') || dest.startsWith('//')) return
    const parsed = parseHref(dest)
    if (parsed) found.add(parsed.path)
  }
  let at = src.indexOf('](')
  while (at !== -1) {
    add(readDestination(src, at + 2))
    at = src.indexOf('](', at + 2)
  }
  if (src.includes(']:')) {
    DEFINITION.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = DEFINITION.exec(src))) add(readDestination(src, m.index + m[0].length))
  }
  return [...found]
}

// ---------------------------------------------------------------------------------------------
// Headings and plain text

/** Strip quote markers, list markers and task boxes at the start of a line. */
function stripContainers(line: string): string {
  let s = line
  for (;;) {
    const m = /^[ \t]{0,3}(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])(?:[ \t]+(?:\[[ xX]\](?=[ \t]|$)[ \t]*)?|$))/.exec(s)
    if (!m || m[0] === '') return s
    s = s.slice(m[0].length)
  }
}

/** Inline Markdown → plain text (approximate). */
export function stripInline(s: string): string {
  if (!/[\\`*_~[\]<>&$!]/.test(s)) return s
  const codes: string[] = []
  let out = s
    // Code spans first: their content is literal.
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_all, _f, content: string) => {
      const c = /^ [\s\S]* $/.test(content) && content.trim() !== '' ? content.slice(1, -1) : content
      codes.push(c)
      return `\uE000${codes.length - 1}\uE000`
    })
    .replace(/\\([!-/:-@[-`{-~])/g, (_all, c: string) => `\uE001${c.charCodeAt(0)}\uE001`)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\s*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\(<[^>]*>[^)]*\)/g, '$1')
    .replace(/^\[\^[^\]\s]+\]:\s*/, '')
    .replace(/\[\^[^\]\s]+\]/g, '')
    .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\s*\)/g, '$1')
    .replace(/\[([^\]]*)\]\(<[^>]*>[^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<((?:https?|mailto|ftp):[^>\s]+)>/gi, '$1')
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, '')
    .replace(/\*+|~~?/g, '')
    .replace(/(^|[^\p{L}\p{N}_])_+|_+(?=$|[^\p{L}\p{N}_])/gu, '$1')
    .replace(/\$\$?([^$\n]+)\$\$?/g, '$1')
  out = decodeDestination(out)
  out = out.replace(/\uE001(\d+)\uE001/g, (_all, n: string) => String.fromCharCode(Number(n)))
  return out.replace(/\uE000(\d+)\uE000/g, (_all, n: string) => codes[Number(n)])
}

function scanBlocks(src: string): { headings: string[]; blocks: string[] } {
  const headings: string[] = []
  const blocks: string[] = []
  const lines = src.split('\n')
  /** Lines of the paragraph being read (raw), or null. */
  let para: string[] | null = null
  /** Whether that paragraph is inside a quote or list (no setext heading there). */
  let paraNested = false
  let fence: { char: string; len: number } | null = null
  let code: string[] = []
  let htmlEnd: RegExp | null = null

  const flush = (): void => {
    if (para) {
      const t = stripInline(para.join('\n')).trim()
      if (t) blocks.push(t)
      para = null
    }
  }

  /** Inside a list: indented lines belong to its items, whatever their indentation. */
  let inList = false

  for (const line of lines) {
    if (/^[ \t]{0,3}(?:>[ \t]?)*[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(line)) inList = true
    else if (/^[^ \t>]/.test(line) && !para) inList = false
    let content = stripContainers(inList && !fence ? line.replace(/^[ \t]+/, '') : line)
    if (inList && !fence) content = content.replace(/^[ \t]+/, '')
    if (fence) {
      const close = /^[ \t]{0,3}(`{3,}|~{3,}|\${2,})[ \t]*$/.exec(inList ? content.replace(/^[ \t]+/, '') : content)
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
        if (code.length) blocks.push(code.join('\n'))
        fence = null
        code = []
      } else {
        code.push(content)
      }
      continue
    }
    if (htmlEnd) {
      const t = stripInline(content).trim()
      if (t) blocks.push(t)
      if (htmlEnd.test(content) || (htmlEnd.source === '^$' && content.trim() === '')) htmlEnd = null
      continue
    }
    const trimmed = content.trim()
    if (trimmed === '') {
      flush()
      continue
    }
    const open = /^[ \t]{0,3}(`{3,}|~{3,}|\${2,})/.exec(content)
    if (open && !(open[1][0] === '`' && content.slice(open.index + open[1].length).includes('`'))) {
      flush()
      fence = { char: open[1][0], len: open[1].length }
      continue
    }
    if (!para && /^[ \t]{0,3}\[(?!\^)(?:[^\]\\\n]|\\.)+\]:/.test(content)) continue // link reference definition
    const atx = /^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(content)
    if (atx) {
      flush()
      const t = stripInline(atx[2] ?? '').trim()
      headings.push(t)
      if (t) blocks.push(t)
      continue
    }
    if (para && !paraNested && /^[ \t]{0,3}(?:=+|-+)[ \t]*$/.test(content) && content === line) {
      // Setext underline: the paragraph so far is a heading.
      const t = stripInline((para as string[]).join('\n')).trim()
      para = null
      headings.push(t)
      if (t) blocks.push(t)
      continue
    }
    if (/^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(content)) {
      flush()
      continue
    }
    if (/^[ \t]{0,3}</.test(content) && !para) {
      const lower = trimmed.toLowerCase()
      const kind1 = /^<(script|pre|style|textarea)(?:[\s>]|$)/.exec(lower)
      const end = kind1
        ? new RegExp(`</${kind1[1]}>`, 'i')
        : lower.startsWith('<!--')
          ? /-->/
          : lower.startsWith('<?')
            ? /\?>/
            : lower.startsWith('<![cdata[')
              ? /\]\]>/
              : /^<![a-z]/.test(lower)
                ? />/
                : /^$/
      const t = stripInline(trimmed).trim()
      if (t) blocks.push(t)
      if (!(end.source !== '^$' && end.test(lower.slice(2)))) htmlEnd = end
      continue
    }
    if (/^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(trimmed) && trimmed.includes('-') && (trimmed.includes('|') || para)) {
      // Table delimiter row.
      if (para && (para as string[]).length > 0) {
        const head = (para as string[]).pop() as string
        flush()
        para = [head]
      }
      continue
    }
    if (trimmed.startsWith('|')) {
      flush()
      const cells = trimmed.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => stripInline(c.trim()))
      blocks.push(cells.join(' ').trim())
      continue
    }
    if (!para) {
      para = []
      paraNested = content !== line
    }
    para.push(content.replace(/^[ \t]+/, ''))
  }
  flush()
  if (fence && code.length) blocks.push(code.join('\n'))
  return { headings, blocks }
}

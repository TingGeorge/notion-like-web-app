/**
 * Markdown → mdast with source positions, shared by the converter, `analyzePage` and
 * `rewriteLinks`.
 *
 * Syntax: CommonMark + GFM (tables, task lists, strikethrough, footnotes) + math (`$x$`, `$$`).
 * Math and footnotes are parsed only so that they are recognised and kept raw (DATA-15).
 * GFM autolink literals (`www.x.com`, bare `https://…`, `a@b.c`) are switched off: they are
 * plain text to the editor, so a bare URL in a paragraph round-trips byte-for-byte (github.com
 * still links them when it renders the file).
 *
 * Performance: micromark gets quadratic on long documents with many containers (lists, quotes),
 * so long bodies are cut into top-level chunks at blank lines that cannot be inside any block
 * (see `chunkStarts`) and each chunk is parsed on its own. Documents that may contain link
 * reference or footnote definitions (which are document-global) are parsed in one piece.
 */
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Extension as MdastExtension, CompileContext, Token } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import type { Nodes, Root, RootContent } from 'mdast'

type MicromarkExtension = ReturnType<typeof gfm>

/** Offsets recorded while parsing (only when `track` is set): where a destination is written. */
export interface DestinationInfo {
  /** Start/end offset of the destination as written, including `<` `>` when present. */
  start: number
  end: number
  /** Offset of the `(` that starts a resource (`[x](…)`); -1 for definitions. */
  resourceStart: number
}

const DEST = Symbol('destination')

/** The destination info recorded on a link, image or definition node by a tracking parse. */
export function destinationOf(node: Nodes): DestinationInfo | undefined {
  return (node as unknown as { [DEST]?: DestinationInfo })[DEST]
}

const disableAutolinkLiterals: MicromarkExtension = {
  disable: { null: ['wwwAutolink', 'protocolAutolink', 'emailAutolink'] },
}

const micromarkExtensions: MicromarkExtension[] = [gfm(), math(), disableAutolinkLiterals]

// gfmFromMarkdown() also contains the autolink-literal transform, which links URLs found in
// text after parsing. Leave it out (it is the only one with transforms).
const gfmMdast = gfmFromMarkdown().filter((ext) => !ext.transforms || ext.transforms.length === 0)
const baseMdastExtensions: MdastExtension[] = [...gfmMdast, mathFromMarkdown()]

function setDestination(context: CompileContext, token: Token, kind: 'resource' | 'dest'): void {
  const node = context.stack[context.stack.length - 1] as unknown as { [DEST]?: DestinationInfo }
  if (kind === 'resource') {
    node[DEST] = { start: -1, end: -1, resourceStart: token.start.offset }
  } else {
    const info = node[DEST] ?? { start: -1, end: -1, resourceStart: -1 }
    info.start = token.start.offset
    info.end = token.end.offset
    node[DEST] = info
  }
}

const trackingExtension: MdastExtension = {
  enter: {
    resource(token) {
      setDestination(this, token, 'resource')
    },
    resourceDestination(token) {
      setDestination(this, token, 'dest')
    },
    definitionDestination(token) {
      setDestination(this, token, 'dest')
    },
  },
}

const plainOptions = { extensions: micromarkExtensions, mdastExtensions: baseMdastExtensions }
const trackingOptions = { extensions: micromarkExtensions, mdastExtensions: [...baseMdastExtensions, trackingExtension] }

/** Parse one piece of Markdown. Positions are relative to `text`. */
export function parseMdastPiece(text: string, track = false): Root {
  return fromMarkdown(text, track ? trackingOptions : plainOptions)
}

/** A top-level node and the offset of the chunk it was parsed in (add it to its positions). */
export interface TopNode {
  node: RootContent
  base: number
}

/** Target chunk size. Small enough that micromark's container handling stays cheap. */
const CHUNK_TARGET = 2048

/**
 * Parse a whole body into top-level nodes. Positions of each node are relative to its chunk;
 * `base + position.offset` is the offset in `text`.
 */
export function parseTopLevel(text: string, track = false, chunkTarget = CHUNK_TARGET): TopNode[] {
  const starts = text.length > chunkTarget && !/\]:/.test(text) ? chunkStarts(text) : []
  const out: TopNode[] = []
  let from = 0
  let index = 0
  /** The first candidate start at least `size` characters after `from`, or the end. */
  const endAfter = (size: number): number => {
    while (index < starts.length && starts[index] - from < size) index++
    return index < starts.length ? starts[index] : text.length
  }
  while (from < text.length) {
    let size = chunkTarget
    let to = endAfter(size)
    let nodes = parseMdastPiece(text.slice(from, to), track).children
    // A block that runs to the end of the chunk without being closed (fenced code, math, HTML
    // that ends on a marker) would continue in the full document: parse a larger chunk.
    // The size doubles so that the total work stays linear.
    while (to < text.length && nodes.length > 0 && isUnterminated(nodes[nodes.length - 1], text, from)) {
      size = Math.max(size, to - from) * 2
      to = endAfter(size)
      nodes = parseMdastPiece(text.slice(from, to), track).children
    }
    for (const node of nodes) out.push({ node, base: from })
    from = to
  }
  return out
}

/**
 * Candidate chunk starts: a line that follows a blank line, starts in column 0 with a character
 * that cannot continue a previous block (no indentation, no list marker). Fenced code, math and
 * HTML blocks of kinds 1–5 that span blank lines are caught after parsing (`isUnterminated`).
 */
function chunkStarts(text: string): number[] {
  const starts: number[] = []
  let prevBlank = false
  let pos = 0
  while (pos < text.length) {
    let end = text.indexOf('\n', pos)
    if (end === -1) end = text.length
    const c = text.charCodeAt(pos)
    const blank = /^[ \t]*$/.test(text.slice(pos, end))
    if (prevBlank && !blank && c !== 32 && c !== 9 && !LIST_START.test(text.slice(pos, Math.min(end, pos + 12)))) {
      starts.push(pos)
    }
    prevBlank = blank
    pos = end + 1
  }
  return starts
}

const LIST_START = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,}|\${2,})/

/**
 * Whether a block that ends where its text ends was cut short (an unclosed fence, math block or
 * HTML block that ends on a marker) and would take in whatever is written after it.
 */
export function isUnterminated(node: RootContent, text: string, base: number): boolean {
  if (!node.position) return false
  const source = text.slice(base + (node.position.start.offset ?? 0), base + (node.position.end.offset ?? 0))
  if (node.type === 'code' || node.type === 'math') {
    const open = FENCE_OPEN.exec(source)
    if (!open) return false // indented code
    const fence = open[1]
    const lastBreak = source.lastIndexOf('\n')
    if (lastBreak === -1) return true
    const last = source.slice(lastBreak + 1)
    const close = /^ {0,3}(`+|~+|\$+)[ \t]*$/.exec(last)
    return !(close && close[1][0] === fence[0] && close[1].length >= fence.length)
  }
  if (node.type === 'html') {
    const value = source.replace(/^[ \t]+/, '')
    const lower = value.toLowerCase()
    const kind1 = /^<(script|pre|style|textarea)(?:[\s>]|$)/.exec(lower)
    if (kind1) return !lower.includes(`</${kind1[1]}>`)
    if (lower.startsWith('<!--')) return lower.indexOf('-->', 2) === -1
    if (lower.startsWith('<?')) return !lower.slice(2).includes('?>')
    if (lower.startsWith('<![cdata[')) return !lower.includes(']]>')
    if (/^<![a-z]/.test(lower)) return !lower.includes('>')
  }
  return false
}

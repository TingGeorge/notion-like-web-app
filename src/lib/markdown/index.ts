/**
 * Markdown ⇄ editor document (SPEC §3.3–§3.4, DATA-8 to DATA-17).
 *
 * CONTRACT — implemented in this folder. Other modules import only from this file.
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { PageMeta } from '../types'
import { analyze } from './analyze'
import { canonicalize } from './canonicalize'
import { parseBody } from './parse'
import { rewrite } from './rewrite'
import { serializeCanonical } from './serialize'

export { emptyFrontmatter, joinPageFile, readPageId, readPageMeta, splitPageFile } from './frontmatter'
export { canonicalize } from './canonicalize'

/**
 * Parse a page body (no frontmatter) into an editor document using `schema` from `../schema`.
 * Never throws: anything the editor does not understand becomes a `raw` block holding the exact
 * source (DATA-15). An empty body gives a doc with one empty paragraph.
 * The result is always canonical (`canonicalize(parseMarkdown(md))` equals it).
 */
export function parseMarkdown(body: string): PMNode {
  return parseBody(body)
}

/**
 * Serialize an editor document to a page body. LF line endings, exactly one trailing newline,
 * or the empty string for a doc that is a single empty paragraph (DATA-10).
 * DATA-16: parse(serialize(doc)) equals canonicalize(doc) (see `canonicalize.ts` for the few
 * normalisations, e.g. `toggle.open` is reset), and serialize(parse(md)) === md for Markdown
 * written by this serializer.
 */
export function serializeMarkdown(doc: PMNode): string {
  return serializeCanonical(canonicalize(doc))
}

/**
 * DATA-8 frontmatter. Unknown keys are kept verbatim (their exact source lines) and in order.
 * Values the app writes: `id` (plain), `title` and `icon` and `cover` (double-quoted, JSON-style
 * escapes), `created` (plain ISO 8601).
 */
export interface Frontmatter {
  /** Keys in file order. */
  keys(): string[]
  has(key: string): boolean
  /** The parsed value of a key (YAML), or undefined. */
  get(key: string): unknown
  /** The value as a string if it is a scalar, else null. */
  getString(key: string): string | null
  /** Set a scalar value (keeps the key's position, appends new keys at the end). null deletes. */
  set(key: string, value: string | null): void
  delete(key: string): void
  /** The exact source text of one key (its line plus continuation lines), for key-by-key merges. */
  rawEntry(key: string): string | undefined
  /** Replace one key's exact source text (used by the frontmatter merge). undefined deletes. */
  setRawEntry(key: string, raw: string | undefined): void
  isEmpty(): boolean
  clone(): Frontmatter
}

export interface PageFile {
  frontmatter: Frontmatter
  body: string
  /** True when the file had a frontmatter block (even an empty one). */
  hadFrontmatter: boolean
}

/** Everything the index and search need from a page file, from a single parse. */
export interface PageAnalysis {
  meta: PageMeta
  /** Root-relative link targets (DATA-17), decoded, without the leading `/`, without `#fragment`. */
  links: string[]
  /** Text of the headings, in order. */
  headings: string[]
  /** The body as plain text (no Markdown syntax), blocks separated by newlines. */
  plainText: string
  /** The first ~200 characters of plain text, on one line. */
  excerpt: string
}

export function analyzePage(text: string): PageAnalysis {
  return analyze(text)
}

export interface LinkRef {
  /** The destination exactly as written, e.g. `/工作/專案%20A.md#x`. */
  href: string
  /** The link text (plain text) or image alt. */
  text: string
  /** True for a link that is alone in its paragraph (a `page_link` / `file` block). */
  alone: boolean
  image: boolean
}

/**
 * DATA-17: rewrite link and image destinations in a page body. `map` returns a new destination
 * (and, for links that are alone in a paragraph — page link blocks — optionally new link text),
 * or null to keep the link. Everything else stays byte-for-byte the same. Links inside `raw`
 * constructs (HTML, code) are never touched.
 */
export function rewriteLinks(body: string, map: (link: LinkRef) => { href: string; text?: string } | null): string {
  return rewrite(body, map)
}

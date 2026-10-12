/**
 * Full-text search (UI-9, NFR-1): MiniSearch with Chinese word segmentation.
 *
 * How Chinese is handled: `Intl.Segmenter('zh-TW')` cuts text and queries differently
 * (「京都風親子丼」 → 京都 / 風 / 親子 / 丼, but a query such as 「風親」 would be cut elsewhere), so
 * the index holds, for every run of CJK characters, the segmenter's words, every single character
 * and every pair of neighbouring characters. A query run of one character is looked up as that
 * character (a prefix match on all tokens, so 「會」 finds 會議記錄); a longer run is the AND of its
 * character pairs and is then verified as a real substring, so 「會議」 does not match a page that
 * only has 會 and 議 apart. Latin words match by prefix, and longer ones tolerate a typo.
 */
import MiniSearch, { type AsPlainObject, type Options, type Query } from 'minisearch'

export interface SearchDoc {
  key: string
  title: string
  path: string
  headings: string[]
  body: string
  /** ms since epoch. */
  updatedAt: number
}

export interface SearchOptions {
  titleOnly?: boolean
  sort?: 'relevance' | 'recent'
  /** Only pages edited after this time (ms since epoch). */
  since?: number | null
  limit?: number
}

export interface SearchResult {
  key: string
  title: string
  path: string
  updatedAt: number
  /** Where the best match is: title first, then headings, then body (UI-9 ranking). */
  matchedIn: 'title' | 'heading' | 'body'
  /** Short text around the match, with the match ranges to show in medium weight. */
  snippet: { text: string; highlights: [number, number][] }
  /** Ranges in the title to highlight. */
  titleHighlights: [number, number][]
  score: number
}

const FORMAT_VERSION = 1
/** Longer bodies are cut: the index, the stored text and the snippets all use the cut text. */
const MAX_BODY_CHARS = 100_000
const DEFAULT_LIMIT = 50
const SNIPPET_LENGTH = 70
const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\p{Script=Hangul}`
const CJK_CHAR = new RegExp(`[${CJK}]`, 'u')
const CJK_RUN = new RegExp(`[${CJK}]+`, 'gu')
const QUERY_PART = new RegExp(`[${CJK}]+|[^${CJK}\\s]+`, 'gu')
const WORD_CHAR = /[\p{L}\p{N}]/u

type Range = [number, number]
const TIER: Record<SearchResult['matchedIn'], number> = { title: 0, heading: 1, body: 2 }

let segmenter: Intl.Segmenter | null | undefined

function words(text: string): string[] {
  if (segmenter === undefined) {
    try {
      segmenter = new Intl.Segmenter('zh-TW', { granularity: 'word' })
    } catch {
      segmenter = null
    }
  }
  if (segmenter) {
    const out: string[] = []
    for (const seg of segmenter.segment(text)) if (seg.isWordLike) out.push(seg.segment)
    return out
  }
  return text.match(new RegExp(`[${CJK}]+|[\\p{L}\\p{N}]+`, 'gu')) ?? []
}

/**
 * Index-time tokenizer: Latin words and numbers, CJK words of 3+ characters (from the segmenter),
 * and, over each whole run of CJK characters (across the segmenter's word borders), every
 * single character and every pair of neighbouring characters.
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  for (const word of words(lower)) {
    if (!CJK_CHAR.test(word)) {
      out.push(word)
      continue
    }
    for (const part of word.match(QUERY_PART) ?? []) {
      if (!CJK_CHAR.test(part)) out.push(part)
      else if (Array.from(part).length > 2) out.push(part)
    }
  }
  for (const run of lower.match(CJK_RUN) ?? []) {
    const chars = Array.from(run)
    for (let i = 0; i < chars.length; i++) {
      out.push(chars[i])
      if (i + 1 < chars.length) out.push(chars[i] + chars[i + 1])
    }
  }
  return out
}

interface Stored {
  key: string
  title: string
  path: string
  headings: string
  body: string
  updatedAt: number
}

const MINI_OPTIONS: Options<Stored> = {
  idField: 'key',
  fields: ['title', 'headings', 'body'],
  storeFields: ['title', 'path', 'headings', 'body', 'updatedAt'],
  tokenize,
  processTerm: (term) => term.toLowerCase(),
  searchOptions: {
    // Query terms are built by `parseQuery`; each one is already a single term.
    tokenize: (s) => [s],
    prefix: true,
    fuzzy: (term) => (term.length >= 5 && !CJK_CHAR.test(term) ? 0.2 : false),
    boost: { title: 8, headings: 3, body: 1 },
    combineWith: 'AND',
  },
}

interface ParsedQuery {
  query: Query | null
  /** CJK runs that must appear verbatim in the page. */
  cjkRuns: string[]
}

function parseQuery(raw: string): ParsedQuery {
  const queries: Query[] = []
  const cjkRuns: string[] = []
  for (const part of raw.toLowerCase().match(QUERY_PART) ?? []) {
    if (!CJK_CHAR.test(part)) {
      const clean = part.replace(/[^\p{L}\p{N}_'-]+/gu, '')
      if (clean) queries.push(clean)
      continue
    }
    cjkRuns.push(part)
    const chars = Array.from(part)
    if (chars.length === 1) queries.push(part)
    else for (let i = 0; i + 1 < chars.length; i++) queries.push(chars[i] + chars[i + 1])
  }
  return { query: queries.length ? { combineWith: 'AND', queries } : null, cjkRuns }
}

function allIndexes(haystack: string, needle: string): number[] {
  const out: number[] = []
  if (!needle) return out
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) out.push(i)
  return out
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/** Ranges of `cjkRuns` (anywhere) and of Latin `terms` (at the start of a word) in `text`. */
function findRanges(text: string, cjkRuns: string[], terms: string[]): Range[] {
  const lower = text.toLowerCase()
  if (lower.length !== text.length) return []
  const ranges: Range[] = []
  for (const run of cjkRuns) for (const i of allIndexes(lower, run)) ranges.push([i, i + run.length])
  for (const term of terms) {
    for (const i of allIndexes(lower, term)) {
      if (i > 0 && WORD_CHAR.test(lower[i - 1]) && !CJK_CHAR.test(lower[i - 1])) continue
      ranges.push([i, i + term.length])
    }
  }
  return mergeRanges(ranges)
}

function makeSnippet(text: string, ranges: Range[]): SearchResult['snippet'] {
  // Same length as `text`, so the ranges stay valid.
  const flat = text.replace(/\s/g, ' ')
  if (flat.length <= SNIPPET_LENGTH + 10) return { text: flat.trim(), highlights: flat.trim() === flat ? ranges : [] }
  const first = ranges[0]?.[0] ?? 0
  let start = Math.max(0, Math.min(first - 20, flat.length - SNIPPET_LENGTH))
  // Do not begin in the middle of a Latin word.
  while (start > 0 && start < first && WORD_CHAR.test(flat[start - 1]) && WORD_CHAR.test(flat[start]) && !CJK_CHAR.test(flat[start])) start++
  const end = Math.min(flat.length, start + SNIPPET_LENGTH)
  const lead = start > 0 ? '…' : ''
  const tail = end < flat.length ? '…' : ''
  const highlights: Range[] = []
  for (const [a, b] of ranges) {
    const s = Math.max(a, start)
    const e = Math.min(b, end)
    if (s < e) highlights.push([s - start + lead.length, e - start + lead.length])
  }
  return { text: lead + flat.slice(start, end) + tail, highlights }
}

export class SearchIndex {
  private constructor(private mini: MiniSearch<Stored>) {}

  /** Create an empty index, or load one serialised with `toJSON`. A bad or old dump gives an empty index. */
  static create(json?: string | null): SearchIndex {
    if (json) {
      try {
        const data = JSON.parse(json) as { v?: number; mini?: AsPlainObject }
        if (data.v === FORMAT_VERSION && data.mini) return new SearchIndex(MiniSearch.loadJS(data.mini, MINI_OPTIONS))
      } catch {
        // fall through to an empty index
      }
    }
    return new SearchIndex(new MiniSearch<Stored>(MINI_OPTIONS))
  }

  /** Add or replace a page. */
  upsert(doc: SearchDoc): void {
    const stored: Stored = {
      key: doc.key,
      title: doc.title,
      path: doc.path,
      headings: doc.headings.join('\n'),
      body: doc.body.length > MAX_BODY_CHARS ? doc.body.slice(0, MAX_BODY_CHARS) : doc.body,
      updatedAt: doc.updatedAt,
    }
    if (this.mini.has(doc.key)) this.mini.discard(doc.key)
    this.mini.add(stored)
  }

  remove(key: string): void {
    if (this.mini.has(key)) this.mini.discard(key)
  }

  has(key: string): boolean {
    return this.mini.has(key)
  }

  get size(): number {
    return this.mini.documentCount
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const { query: tree, cjkRuns } = parseQuery(query)
    if (!tree) return []
    const since = options.since ?? null
    const hits = this.mini.search(tree, {
      fields: options.titleOnly ? ['title'] : undefined,
      filter: since === null ? undefined : (r) => (r.updatedAt as number) >= since,
    })
    interface Ranked {
      doc: Stored & { id: string; score: number; match: Record<string, string[]> }
      matchedIn: SearchResult['matchedIn']
      latin: string[]
      titleRanges: Range[]
      headings: string[]
      headingRanges: Range[][]
    }
    const ranked: Ranked[] = []
    for (const hit of hits) {
      const doc = hit as unknown as Ranked['doc']
      // A CJK run has to be there as written (it has no letter case), in some field.
      if (!cjkRuns.every((run) => doc.title.includes(run) || doc.headings.includes(run) || doc.body.includes(run))) continue
      // Latin terms that matched in the index (prefix and fuzzy matches expanded).
      const latin = Object.keys(doc.match).filter((term) => !CJK_CHAR.test(term))
      const titleRanges = findRanges(doc.title, cjkRuns, latin)
      const headings = doc.headings ? doc.headings.split('\n') : []
      const headingRanges = headings.map((h) => findRanges(h, cjkRuns, latin))
      const matchedIn: SearchResult['matchedIn'] =
        titleRanges.length > 0 ? 'title' : headingRanges.some((r) => r.length > 0) ? 'heading' : 'body'
      ranked.push({ doc, matchedIn, latin, titleRanges, headings, headingRanges })
    }
    if (options.sort === 'recent') ranked.sort((a, b) => b.doc.updatedAt - a.doc.updatedAt || b.doc.score - a.doc.score)
    else ranked.sort((a, b) => TIER[a.matchedIn] - TIER[b.matchedIn] || b.doc.score - a.doc.score)
    // Snippets are the expensive part: only for the results that are returned.
    return ranked.slice(0, options.limit ?? DEFAULT_LIMIT).map(({ doc, matchedIn, latin, titleRanges, headings, headingRanges }) => {
      const bodyRanges = findRanges(doc.body, cjkRuns, latin)
      const headingAt = headingRanges.findIndex((r) => r.length > 0)
      let snippet: SearchResult['snippet']
      if (bodyRanges.length > 0) snippet = makeSnippet(doc.body, bodyRanges)
      else if (headingAt !== -1) snippet = makeSnippet(headings[headingAt], headingRanges[headingAt])
      else snippet = makeSnippet(doc.body, [])
      return {
        key: doc.id,
        title: doc.title,
        path: doc.path,
        updatedAt: doc.updatedAt,
        matchedIn,
        snippet,
        titleHighlights: titleRanges,
        score: doc.score,
      }
    })
  }

  toJSON(): string {
    return JSON.stringify({ v: FORMAT_VERSION, mini: this.mini.toJSON() })
  }
}

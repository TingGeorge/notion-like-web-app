/**
 * DATA-8 frontmatter. Unknown keys are kept verbatim and in order: the block is split into
 * entries (a top-level `key:` line plus its continuation lines) and only entries the app sets
 * are ever rewritten.
 */
import { parseDocument, isScalar, isMap } from 'yaml'
import type { PageMeta } from '../types'
import type { Frontmatter, PageFile } from './index'

interface Entry {
  /** Top-level key, or '' for trailing comment/blank lines after the last key. */
  key: string
  /** Comment and blank lines just above the key line; kept when the entry is rewritten. */
  lead: string[]
  /** The key line plus its continuation lines. */
  raw: string
}

/** Values written in double quotes with JSON-style escapes (valid YAML). */
const QUOTED_KEYS = new Set(['title', 'icon', 'cover'])

/** The top-level key a line starts, or null for continuation lines (indented, comments, list items). */
function parseKey(line: string): string | null {
  if (!line || /^[\s#]/.test(line) || /^-(\s|$)/.test(line)) return null
  let m = /^"((?:[^"\\]|\\.)*)"\s*:(?:\s|$)/.exec(line)
  if (m) return m[1].replace(/\\(.)/g, '$1')
  m = /^'((?:[^']|'')*)'\s*:(?:\s|$)/.exec(line)
  if (m) return m[1].replace(/''/g, "'")
  m = /^([^:#\s][^:#]*?)\s*:(?:\s|$)/.exec(line)
  return m ? m[1] : null
}

function formatValue(key: string, value: string): string {
  if (QUOTED_KEYS.has(key)) return JSON.stringify(value)
  // Plain scalars the app writes (ULID, ISO 8601) need no quotes; anything else is quoted.
  if (/^[0-9A-Za-z][0-9A-Za-z_.+:-]*$/.test(value) && !/:\s/.test(value) && !/^(true|false|null|yes|no|on|off|~)$/i.test(value)) {
    return value
  }
  return JSON.stringify(value)
}

function formatKey(key: string): string {
  return /^[A-Za-z_][\w-]*$/.test(key) ? key : JSON.stringify(key)
}

class FrontmatterImpl implements Frontmatter {
  private entries: Entry[]
  private cache = new Map<string, unknown>()

  constructor(entries: Entry[]) {
    this.entries = entries
  }

  static parse(source: string): FrontmatterImpl {
    const lines = source === '' ? [] : source.split('\n')
    const entries: Entry[] = []
    let current: Entry | null = null
    // Comment and blank lines at column 0 belong to the next key; indented lines continue the current one.
    let pending: string[] = []
    for (const line of lines) {
      const key = parseKey(line)
      if (key !== null && !entries.some((e) => e.key === key)) {
        current = { key, lead: pending, raw: line }
        pending = []
        entries.push(current)
      } else if (/^(#|\s*$)/.test(line)) {
        pending.push(line)
      } else if (current) {
        current.raw += pending.map((l) => `\n${l}`).join('') + `\n${line}`
        pending = []
      } else {
        pending.push(line)
      }
    }
    if (pending.length > 0) entries.push({ key: '', lead: pending, raw: '' })
    return new FrontmatterImpl(entries)
  }

  keys(): string[] {
    return this.entries.filter((e) => e.key !== '').map((e) => e.key)
  }

  has(key: string): boolean {
    return key !== '' && this.entries.some((e) => e.key === key)
  }

  get(key: string): unknown {
    if (this.cache.has(key)) return this.cache.get(key)
    const entry = this.entries.find((e) => e.key === key && key !== '')
    let value: unknown
    if (entry) {
      try {
        const doc = parseDocument(entry.raw, { prettyErrors: false })
        if (doc.errors.length === 0 && isMap(doc.contents)) {
          const node = doc.contents.items[0]?.value
          if (isScalar(node)) {
            // Keep the source text of plain numbers/booleans (e.g. `title: 1.0`).
            value = typeof node.value === 'string' || node.value === null ? node.value : (node.source ?? node.value)
          } else {
            value = node ? (node as { toJSON(): unknown }).toJSON() : null
          }
        }
      } catch {
        value = undefined
      }
    }
    this.cache.set(key, value)
    return value
  }

  getString(key: string): string | null {
    const v = this.get(key)
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    return null
  }

  set(key: string, value: string | null): void {
    if (value === null) {
      this.delete(key)
      return
    }
    this.setRawEntry(key, `${formatKey(key)}: ${formatValue(key, value)}`)
  }

  delete(key: string): void {
    this.setRawEntry(key, undefined)
  }

  rawEntry(key: string): string | undefined {
    return this.entries.find((e) => e.key === key && key !== '')?.raw
  }

  setRawEntry(key: string, raw: string | undefined): void {
    this.cache.delete(key)
    const i = this.entries.findIndex((e) => e.key === key && key !== '')
    if (raw === undefined) {
      if (i !== -1) this.entries.splice(i, 1)
    } else if (i !== -1) {
      this.entries[i] = { ...this.entries[i], raw }
    } else {
      // New keys go before any trailing comments.
      const tail = this.entries.length > 0 && this.entries[this.entries.length - 1].key === '' ? this.entries.length - 1 : this.entries.length
      this.entries.splice(tail, 0, { key, lead: [], raw })
    }
  }

  /** True when there is nothing but blank lines (comments and any other text are content). */
  isEmpty(): boolean {
    return this.entries.every((e) => e.raw.trim() === '' && e.lead.every((l) => l.trim() === ''))
  }

  clone(): Frontmatter {
    return new FrontmatterImpl(this.entries.map((e) => ({ ...e, lead: [...e.lead] })))
  }

  toString(): string {
    return this.entries.flatMap((e) => (e.raw === '' ? e.lead : [...e.lead, e.raw])).join('\n')
  }
}

export function emptyFrontmatter(): Frontmatter {
  return new FrontmatterImpl([])
}

export function parseFrontmatterSource(source: string): Frontmatter {
  return FrontmatterImpl.parse(source)
}

/** Split a page file into frontmatter and body (DATA-8). CRLF is read as LF. Never throws. */
export function splitPageFile(input: string): PageFile {
  const text = input.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  if (text.startsWith('---\n')) {
    const rest = text.slice(4)
    const close = /^(?:---|\.\.\.)[ \t]*$/m.exec(rest)
    if (close) {
      const source = rest.slice(0, close.index).replace(/\n$/, '')
      let body = rest.slice(close.index + close[0].length)
      if (body.startsWith('\n')) body = body.slice(1)
      return { frontmatter: FrontmatterImpl.parse(source), body, hadFrontmatter: true }
    }
  }
  return { frontmatter: new FrontmatterImpl([]), body: text, hadFrontmatter: false }
}

/** DATA-10: LF, exactly one trailing newline; an empty page is ''. */
export function joinPageFile(frontmatter: Frontmatter, body: string): string {
  const normalizedBody = body.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const bodyPart = normalizedBody === '' ? '' : `${normalizedBody}\n`
  if (frontmatter.isEmpty()) return bodyPart
  return `---\n${frontmatter.toString().replace(/\n+$/, '')}\n---\n${bodyPart}`
}

/** The app's keys from a frontmatter (DATA-8). Invalid values read as null. */
export function readPageMeta(frontmatter: Frontmatter): PageMeta {
  const str = (key: string) => {
    const v = frontmatter.getString(key)
    return v !== null && v.trim() !== '' ? v : null
  }
  return {
    id: str('id'),
    title: str('title'),
    icon: str('icon'),
    cover: str('cover'),
    created: str('created'),
  }
}

/** The page id from a page file, without parsing the body. */
export function readPageId(text: string): string | null {
  const { frontmatter, hadFrontmatter } = splitPageFile(text)
  if (!hadFrontmatter) return null
  return readPageMeta(frontmatter).id
}

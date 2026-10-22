/**
 * The editor document schema (SPEC §3.4, DATA-11 to DATA-15).
 *
 * This file is the contract between the Markdown converter (`src/lib/markdown`) and the editor
 * (`src/editor`). Every node and mark here has exactly one Markdown form.
 *
 * Groups:
 * - `block`:  allowed at the top level of a page.
 * - `nested`: allowed inside list items, toggles, quotes and callouts. Everything in `block`
 *             except `callout` and `raw` (DATA-13: callouts are top-level only; unknown Markdown
 *             is kept as one top-level block).
 *
 * Marks are declared in the fixed outer-to-inner order of DATA-14. ProseMirror keeps mark sets
 * sorted by this order, so the serializer can nest them in this order.
 */
import { Schema, type DOMOutputSpec, type MarkSpec, type NodeSpec } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

export const NOTION_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
export type NotionColor = (typeof NOTION_COLORS)[number]

/** DATA-19: an image's display width in CSS pixels, kept within these bounds. */
export const IMAGE_WIDTH_MIN = 40
export const IMAGE_WIDTH_MAX = 4000

/** A stored image width: a whole number of pixels within bounds, or null (natural width, at most the page width). */
export function imageWidth(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(IMAGE_WIDTH_MAX, Math.max(IMAGE_WIDTH_MIN, Math.round(n)))
}

export function isNotionColor(value: unknown): value is NotionColor {
  return typeof value === 'string' && (NOTION_COLORS as readonly string[]).includes(value)
}

/** DATA-12: GitHub alert types, and the icon that maps to each one. */
export const CALLOUT_KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

export const CALLOUT_DEFAULT_ICON: Record<CalloutKind, string> = {
  NOTE: 'ℹ️',
  TIP: '💡',
  IMPORTANT: '❗',
  WARNING: '⚠️',
  CAUTION: '🛑',
}

/** DATA-12: which alert type an icon chosen by the user maps to. */
export function calloutKindForIcon(icon: string): { kind: CalloutKind; icon: string | null } {
  for (const kind of CALLOUT_KINDS) {
    if (CALLOUT_DEFAULT_ICON[kind] === icon) return { kind, icon: null }
  }
  // ⚠ without the variation selector is the same icon.
  if (icon === '⚠') return { kind: 'WARNING', icon: null }
  if (icon === 'ℹ') return { kind: 'NOTE', icon: null }
  return { kind: 'NOTE', icon }
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    content: 'inline*',
    group: 'block nested',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },

  /** Heading 1–3. Inline content only, no line breaks (DATA-14). */
  heading: {
    attrs: { level: { default: 1, validate: 'number' } },
    content: 'text*',
    group: 'block nested',
    defining: true,
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
      { tag: 'h4', attrs: { level: 3 } },
      { tag: 'h5', attrs: { level: 3 } },
      { tag: 'h6', attrs: { level: 3 } },
    ],
    toDOM: (node) => [`h${node.attrs.level as number}`, 0],
  },

  bullet_list: {
    content: 'list_item+',
    group: 'block nested',
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', 0],
  },

  ordered_list: {
    attrs: { start: { default: 1, validate: 'number' } },
    content: 'list_item+',
    group: 'block nested',
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (dom) => {
          const start = (dom as HTMLElement).getAttribute('start')
          return { start: start ? Number(start) || 1 : 1 }
        },
      },
    ],
    toDOM: (node) => (node.attrs.start === 1 ? ['ol', 0] : ['ol', { start: node.attrs.start as number }, 0]),
  },

  /**
   * A bulleted or numbered item, or a to-do when `checked` is a boolean (`- [ ] x` / `- [x] x`).
   * The first child is the item's own text; the rest are its children (DATA-13).
   */
  list_item: {
    attrs: { checked: { default: null } },
    content: 'paragraph nested*',
    defining: true,
    parseDOM: [
      {
        tag: 'li',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          const data = el.getAttribute('data-checked')
          if (data === 'true') return { checked: true }
          if (data === 'false') return { checked: false }
          const box = el.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]')
          if (box) return { checked: (box as HTMLInputElement).checked }
          return { checked: null }
        },
      },
    ],
    toDOM: (node) =>
      node.attrs.checked === null
        ? ['li', 0]
        : ['li', { 'data-checked': String(node.attrs.checked), class: 'todo' }, 0],
  },

  /**
   * Toggle: `<details>` / `<summary>Title</summary>` + children (§3.4).
   * `open` is UI state only; it is never written to Markdown.
   */
  toggle: {
    attrs: { open: { default: false } },
    content: 'toggle_summary nested*',
    group: 'block nested',
    defining: true,
    parseDOM: [{ tag: 'details', getAttrs: (dom) => ({ open: (dom as HTMLElement).hasAttribute('open') }) }],
    toDOM: (node) => ['details', node.attrs.open ? { open: '' } : {}, 0],
  },

  /** The toggle's title. Plain text: it is written inside HTML, where Markdown is not parsed. */
  toggle_summary: {
    content: 'text*',
    marks: '',
    defining: true,
    parseDOM: [{ tag: 'summary' }],
    toDOM: () => ['summary', 0],
  },

  blockquote: {
    content: 'nested+',
    group: 'block nested',
    defining: true,
    parseDOM: [{ tag: 'blockquote:not([data-callout])' }],
    toDOM: () => ['blockquote', 0],
  },

  /**
   * Callout: a GitHub alert (DATA-12). `icon` is null when the icon is the default for `kind`;
   * otherwise it is written as `<!-- icon: 🧠 -->`.
   */
  callout: {
    attrs: { kind: { default: 'NOTE' }, icon: { default: null } },
    content: 'nested+',
    group: 'block',
    defining: true,
    parseDOM: [
      {
        tag: '[data-callout]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          const kind = (el.getAttribute('data-callout') ?? 'NOTE').toUpperCase()
          return {
            kind: (CALLOUT_KINDS as readonly string[]).includes(kind) ? kind : 'NOTE',
            icon: el.getAttribute('data-icon') || null,
          }
        },
      },
    ],
    toDOM: (node) => [
      'div',
      {
        'data-callout': node.attrs.kind as string,
        ...(node.attrs.icon ? { 'data-icon': node.attrs.icon as string } : {}),
        class: 'callout',
      },
      0,
    ],
  },

  horizontal_rule: {
    group: 'block nested',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },

  /** Fenced code block with a language (§3.4). Plain text only (DATA-14). */
  code_block: {
    attrs: { language: { default: '' } },
    content: 'text*',
    marks: '',
    group: 'block nested',
    code: true,
    defining: true,
    parseDOM: [
      {
        tag: 'pre:not([data-raw])',
        preserveWhitespace: 'full',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          const fromData = el.getAttribute('data-language')
          if (fromData !== null) return { language: fromData }
          const code = el.querySelector('code')
          const cls = code?.className.match(/language-([\w+#.-]+)/)
          return { language: cls ? cls[1] : '' }
        },
      },
    ],
    toDOM: (node) => [
      'pre',
      node.attrs.language ? { 'data-language': node.attrs.language as string } : {},
      ['code', 0],
    ],
  },

  /**
   * Image alone in a paragraph: `![caption](/_assets/…)`, or with a display width (DATA-19)
   * `<img src="/_assets/…" alt="caption" width="320">` alone in a block.
   */
  image: {
    attrs: { src: {}, alt: { default: '' }, title: { default: null }, width: { default: null } },
    group: 'block nested',
    atom: true,
    draggable: true,
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            src: el.getAttribute('src'),
            alt: el.getAttribute('alt') ?? '',
            title: el.getAttribute('title'),
            width: imageWidth(el.getAttribute('width')),
          }
        },
      },
    ],
    toDOM: (node): DOMOutputSpec => [
      'img',
      {
        src: node.attrs.src as string,
        alt: node.attrs.alt as string,
        ...(node.attrs.title ? { title: node.attrs.title as string } : {}),
        ...(node.attrs.width ? { width: String(node.attrs.width as number) } : {}),
      },
    ],
  },

  /** File alone in a paragraph: `[file name.pdf](/_assets/…)`. */
  file: {
    attrs: { href: {}, name: { default: '' } },
    group: 'block nested',
    atom: true,
    draggable: true,
    parseDOM: [
      {
        tag: 'a[data-file]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return { href: el.getAttribute('data-file'), name: el.textContent ?? '' }
        },
      },
    ],
    toDOM: (node) => ['a', { 'data-file': node.attrs.href as string, class: 'file-block' }, node.attrs.name as string],
  },

  /** Link to page alone in a paragraph: `[Title](/path/Title.md)`. */
  page_link: {
    attrs: { href: {}, title: { default: '' } },
    group: 'block nested',
    atom: true,
    draggable: true,
    parseDOM: [
      {
        tag: 'a[data-page-link]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return { href: el.getAttribute('data-page-link'), title: el.textContent ?? '' }
        },
      },
    ],
    toDOM: (node) => [
      'a',
      { 'data-page-link': node.attrs.href as string, class: 'page-link-block' },
      node.attrs.title as string,
    ],
  },

  /**
   * Markdown the editor does not understand, kept byte-for-byte (DATA-15): raw HTML blocks,
   * footnotes, math, other HTML comments, and any top-level block that contains them.
   * Shown and edited as Markdown source.
   */
  raw: {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [{ tag: 'pre[data-raw]', preserveWhitespace: 'full' }],
    toDOM: () => ['pre', { 'data-raw': '' }, ['code', 0]],
  },

  text: { group: 'inline' },

  /** Line break inside a block: backslash at the end of the line (§3.4). */
  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  // DATA-14: table cells hold inline content only, with no line breaks.
  ...tableNodes({
    tableGroup: 'block nested',
    cellContent: 'text*',
    cellAttributes: {
      /** GFM column alignment, copied to every cell of the column. */
      align: {
        default: null,
        getFromDOM: (dom) => (dom as HTMLElement).style.textAlign || dom.getAttribute('align') || null,
        setDOMAttr: (value, attrs) => {
          if (value) attrs.style = `${(attrs.style as string | undefined) ?? ''}text-align: ${value as string};`
        },
      },
    },
  }),
}

const marks: Record<string, MarkSpec> = {
  /** `<span data-bg="yellow">x</span>` (DATA-11). Outermost. */
  bg: {
    attrs: { color: { validate: 'string' } },
    parseDOM: [
      {
        tag: 'span[data-bg]',
        getAttrs: (dom) => {
          const color = (dom as HTMLElement).getAttribute('data-bg')
          return isNotionColor(color) ? { color } : false
        },
      },
    ],
    toDOM: (mark) => ['span', { 'data-bg': mark.attrs.color as string }, 0],
  },

  /** `<span data-color="red">x</span>` (DATA-11). */
  color: {
    attrs: { color: { validate: 'string' } },
    parseDOM: [
      {
        tag: 'span[data-color]',
        getAttrs: (dom) => {
          const color = (dom as HTMLElement).getAttribute('data-color')
          return isNotionColor(color) ? { color } : false
        },
      },
    ],
    toDOM: (mark) => ['span', { 'data-color': mark.attrs.color as string }, 0],
  },

  link: {
    attrs: { href: { validate: 'string' }, title: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]:not([data-file]):not([data-page-link])',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return { href: el.getAttribute('href'), title: el.getAttribute('title') }
        },
      },
    ],
    toDOM: (mark) => [
      'a',
      { href: mark.attrs.href as string, ...(mark.attrs.title ? { title: mark.attrs.title as string } : {}) },
      0,
    ],
  },

  bold: {
    parseDOM: [
      { tag: 'strong' },
      // Google Docs wraps everything in <b style="font-weight:normal">.
      { tag: 'b', getAttrs: (dom) => (dom as HTMLElement).style.fontWeight !== 'normal' && null },
      {
        style: 'font-weight',
        getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null,
      },
    ],
    toDOM: () => ['strong', 0],
  },

  italic: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },

  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0],
  },

  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },

  /** Inline code. Innermost (DATA-14). */
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
}

export const schema = new Schema({ nodes, marks })

export type NodeName = keyof typeof nodes
export type MarkName = keyof typeof marks

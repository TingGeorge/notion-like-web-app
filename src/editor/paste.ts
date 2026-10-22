/**
 * Paste and drop (UI-18):
 * - images and files are uploaded and become image / file blocks;
 * - Markdown text is parsed into blocks (`parseMarkdown`); if that fails it falls back to paragraphs;
 * - HTML is sanitised with DOMPurify before ProseMirror parses it (SEC-4);
 * - plain text becomes paragraphs;
 * - a URL pasted over selected text makes a link;
 * - callouts pasted inside a list, toggle or quote become quotes (DATA-13).
 */
import DOMPurify from 'dompurify'
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorProps, EditorView } from 'prosemirror-view'
import { escapeProseDollars, parseMarkdown } from '../lib/markdown'
import { schema } from '../lib/schema'
import { paragraphsFromText } from './commands'
import type { EditorContext } from './context'
import { isSingleUrl } from './links'
import { insertFiles } from './upload'

const N = schema.nodes

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'code', 'pre', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'span', 'div', 'details', 'summary', 'input', 'sub', 'sup', 'kbd',
]
const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'width', 'colspan', 'rowspan', 'start', 'checked', 'type', 'open', 'style', 'align',
  'data-color', 'data-bg', 'data-callout', 'data-icon', 'data-checked', 'data-file', 'data-page-link',
  'data-language', 'data-raw', 'data-pm-slice', 'data-pm-slice-id',
]

/** Pasted images may only point at https: (data: and blob: URLs from another page are useless here). */
export function dropNonHttpsImageSrc(node: { nodeName: string }, data: { attrName: string; attrValue: string; keepAttr: boolean }) {
  if (data.attrName === 'src' && node.nodeName === 'IMG' && !/^https:\/\//i.test(data.attrValue)) data.keepAttr = false
}

export const SANITIZE_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: true,
}

let hooked = false
export function sanitizePastedHTML(html: string): string {
  if (!hooked) {
    hooked = true
    DOMPurify.addHook('uponSanitizeAttribute', dropNonHttpsImageSrc)
  }
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}

/** True for text that is probably Markdown source rather than prose. */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/)
  const block = /^(#{1,6}\s+\S|\s*[-*+]\s+\S|\s*\d+[.)]\s+\S|>\s?\S|```|~~~|\s*[-*_]{3,}\s*$|\|.+\|\s*$|\s*- \[[ xX]\]\s|<details[\s>]|<summary>|<img\s[^>]*\bwidth=|\$\$)/
  if (lines.some((l) => block.test(l))) return true
  // Inline syntax, including what this app writes: `<u>`, colour spans, character references
  // (`&#x20;`) and backslash escapes.
  return /\*\*[^*\n]+\*\*|!?\[(?:[^\]\n\\]|\\.)*\]\([^)\n]*\)|`[^`\n]+`|~~[^~\n]+~~|<u>|<span data-(?:color|bg)=|&#x[0-9A-Fa-f]+;|\\[!-/:-@[-`{-~]/.test(
    text,
  )
}

/** True when the HTML carries structure of its own (so it should win over the plain text). */
export function htmlHasSemantics(html: string): boolean {
  return /<(h[1-6]|ul|ol|li|table|blockquote|pre|strong|b|em|i|a|img|u|s|del)[\s>]/i.test(html)
}

/** DATA-13: callouts and raw blocks exist only at the top level. */
export function convertForContext(fragment: Fragment, nested: boolean): Fragment {
  if (!nested) return fragment
  const out: PMNode[] = []
  fragment.forEach((n) => {
    if (n.type === N.callout) out.push(N.blockquote.create(null, n.content))
    else if (n.type === N.raw) out.push(N.code_block.create({ language: '' }, n.content))
    else out.push(n)
  })
  return Fragment.fromArray(out)
}

function isNested($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const t = $pos.node(d).type
    if (t === N.list_item || t === N.toggle || t === N.blockquote || t === N.callout) return true
  }
  return false
}

/**
 * The inline content one pasted line of Markdown stands for, when it is pasted into existing
 * text: a paragraph's or heading's text, a list item's or quote's text, a page link or file as
 * a linked name, Markdown the editor keeps raw as its source text. Null for real blocks
 * (images, tables, code, dividers, toggles).
 */
function inlineContent(doc: PMNode): Fragment | null {
  if (doc.childCount !== 1) return null
  let node = doc.firstChild!
  // A one-item list, a quote or callout around one paragraph: their text.
  for (;;) {
    const wrapper = node.type === N.bullet_list || node.type === N.ordered_list || node.type === N.blockquote || node.type === N.callout
    if (!wrapper || node.childCount !== 1) break
    node = node.firstChild!
    if (node.type === N.list_item) {
      if (node.childCount !== 1) return null
      node = node.firstChild!
    }
  }
  if (node.type === N.paragraph || node.type === N.heading) return node.content.size > 0 ? node.content : null
  if (node.type === N.page_link || node.type === N.file) {
    const href = node.attrs.href as string
    const label = ((node.type === N.file ? node.attrs.name : node.attrs.title) as string) || href
    return Fragment.from(schema.text(label, [schema.marks.link.create({ href })]))
  }
  if (node.type === N.raw) return Fragment.from(schema.text(node.textContent))
  return null
}

/**
 * Slice for pasted text: Markdown when it looks like it, else paragraphs. Never throws.
 * `$context` is where it goes: one line pasted into existing text is inserted as inline content
 * (a pasted `[頁面](/a.md)` becomes a link in the sentence, not a block that splits it).
 * Prices like `$5 and $6` stay text (`escapeProseDollars`).
 */
export function sliceFromText(text: string, plain = false, $context?: ResolvedPos): Slice {
  if (!plain && looksLikeMarkdown(text)) {
    try {
      const doc = parseMarkdown(escapeProseDollars(text))
      const oneLine = !/\n/.test(text.replace(/\r?\n$/, ''))
      const inText = !!$context && $context.parent.isTextblock && $context.parent.content.size > 0 && !$context.parent.type.spec.code
      const inline = oneLine && inText ? inlineContent(doc) : null
      if (inline) return new Slice(Fragment.from(N.paragraph.create(null, inline)), 1, 1)
      const only = doc.childCount === 1 && doc.firstChild!.type === N.paragraph
      return new Slice(doc.content, only ? 1 : 0, only ? 1 : 0)
    } catch {
      // fall through to plain paragraphs
    }
  }
  const paras = paragraphsFromText(text, plain)
  return new Slice(paras, 1, 1)
}

export function pasteProps(ctx: EditorContext): Partial<EditorProps> {
  return {
    transformPastedHTML: (html) => sanitizePastedHTML(html),
    clipboardTextParser: (text, $context, plain) => sliceFromText(text, plain, $context),
    transformPasted(slice, view) {
      return new Slice(convertForContext(slice.content, isNested(view.state.selection.$from)), slice.openStart, slice.openEnd)
    },
    handlePaste(view: EditorView, event: ClipboardEvent) {
      const data = event.clipboardData
      if (!data || !view.editable) return false
      const files = Array.from(data.files ?? [])
      const html = data.getData('text/html')
      const text = data.getData('text/plain')
      if (files.length && !/<table[\s>]/i.test(html)) {
        void insertFiles(view, files, ctx)
        return true
      }
      const sel = view.state.selection
      // A URL pasted over selected text links it.
      if (text && isSingleUrl(text) && !sel.empty && sel instanceof TextSelection && sel.$from.sameParent(sel.$to) && sel.$from.parent.inlineContent) {
        view.dispatch(view.state.tr.addMark(sel.from, sel.to, schema.marks.link.create({ href: text.trim() })))
        return true
      }
      // HTML without structure (code editors) next to Markdown text: trust the text.
      if (html && text && !htmlHasSemantics(html) && looksLikeMarkdown(text) && !sel.$from.parent.type.spec.code) {
        const slice = sliceFromText(text, false, sel.$from)
        const converted = new Slice(convertForContext(slice.content, isNested(sel.$from)), slice.openStart, slice.openEnd)
        view.dispatch(view.state.tr.replaceSelection(converted).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
        return true
      }
      return false
    },
    handleDrop(view: EditorView, event: DragEvent) {
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.length || !view.editable) return false
      event.preventDefault()
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
      void insertFiles(view, files, ctx, at?.pos)
      return true
    },
  }
}

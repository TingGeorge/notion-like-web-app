/**
 * The `/` menu (UI-7): items, filtering, and the plugin that tracks the open menu.
 *
 * Filtering is by Chinese name or English alias, case- and width-insensitive (NFKC folds
 * full-width letters to ASCII). The menu closes on a space, on Esc, when the caret leaves the
 * `/query`, or when the query has no match after 3 more characters.
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { t } from '../strings/zh-TW'
import { isComposingEvent } from './shortcuts'

export type InsertItemId =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'number'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'code'
  | 'table'
  | 'image'
  | 'file'
  | 'link'
  | 'page'

export interface SlashItem {
  id: InsertItemId
  label: string
  aliases: string[]
  /** Markdown shortcut shown on the right. */
  hint?: string
  section: 'basic' | 'media'
}

const b = t.editor.blocks

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', label: b.text, aliases: ['text', 'paragraph', 'plain'], section: 'basic' },
  { id: 'h1', label: b.h1, aliases: ['h1', 'heading1', 'heading 1'], hint: '#', section: 'basic' },
  { id: 'h2', label: b.h2, aliases: ['h2', 'heading2', 'heading 2'], hint: '##', section: 'basic' },
  { id: 'h3', label: b.h3, aliases: ['h3', 'heading3', 'heading 3'], hint: '###', section: 'basic' },
  { id: 'bullet', label: b.bullet, aliases: ['bullet', 'ul', 'list'], hint: '-', section: 'basic' },
  { id: 'number', label: b.number, aliases: ['number', 'ol', 'numbered'], hint: '1.', section: 'basic' },
  { id: 'todo', label: b.todo, aliases: ['todo', 'task', 'checkbox'], hint: '[]', section: 'basic' },
  { id: 'toggle', label: b.toggle, aliases: ['toggle'], hint: '>', section: 'basic' },
  { id: 'quote', label: b.quote, aliases: ['quote', 'blockquote'], hint: '"', section: 'basic' },
  { id: 'callout', label: b.callout, aliases: ['callout'], section: 'basic' },
  { id: 'divider', label: b.divider, aliases: ['divider', 'hr', 'line'], hint: '---', section: 'basic' },
  { id: 'code', label: b.code, aliases: ['code'], hint: '```', section: 'basic' },
  { id: 'table', label: b.table, aliases: ['table'], section: 'basic' },
  { id: 'image', label: b.image, aliases: ['image', 'img', 'photo'], section: 'media' },
  { id: 'file', label: b.file, aliases: ['file', 'attachment'], section: 'media' },
  { id: 'link', label: b.link, aliases: ['link'], section: 'media' },
  { id: 'page', label: b.page, aliases: ['page'], section: 'media' },
]

/** Fold width and case: `Ｈ１` and `h1` are the same query. */
export function normalizeQuery(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim()
}

function matches(item: SlashItem, q: string): boolean {
  if (!q) return true
  if (normalizeQuery(item.label).includes(q)) return true
  return item.aliases.some((a) => normalizeQuery(a).startsWith(q))
}

export function filterSlashItems(query: string, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const q = normalizeQuery(query)
  return items.filter((i) => matches(i, q))
}

/** UI-7: close when no item matched for the last 3 characters typed. */
export function shouldCloseSlash(query: string): boolean {
  const q = normalizeQuery(query)
  if (/\s/.test(query)) return true
  let longest = 0
  for (let n = q.length; n > 0; n--) {
    if (SLASH_ITEMS.some((i) => matches(i, q.slice(0, n)))) {
      longest = n
      break
    }
  }
  return q.length - longest >= 3
}

export function isSlashChar(ch: string): boolean {
  return ch === '/' || ch === '／'
}

export interface SlashState {
  /** Position of the `/`. */
  from: number
  query: string
  selected: number
}

export const slashKey = new PluginKey<SlashState | null>('gn-slash')

interface SlashMeta {
  open?: number
  close?: true
  selected?: number
}

/** The menu may open in text blocks that can be turned into something (not code or table cells). */
function canOpenAt(view: EditorView, pos: number): boolean {
  const $pos = view.state.doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock || parent.type.spec.code) return false
  const name = parent.type.name
  if (name === 'table_cell' || name === 'table_header') return false
  const before = $pos.parentOffset > 0 ? parent.textBetween($pos.parentOffset - 1, $pos.parentOffset) : ''
  return !isSlashChar(before)
}

export function openSlash(view: EditorView, from: number) {
  view.dispatch(view.state.tr.setMeta(slashKey, { open: from } satisfies SlashMeta))
}

export function setSlashSelected(view: EditorView, selected: number) {
  view.dispatch(view.state.tr.setMeta(slashKey, { selected } satisfies SlashMeta))
}

export function closeSlash(view: EditorView) {
  if (slashKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(slashKey, { close: true } satisfies SlashMeta))
}

/** Insert a `/` at the caret and open the menu (the `+` handle and the mobile bar). */
export function insertSlashAtSelection(view: EditorView) {
  const { from, to } = view.state.selection
  const tr = view.state.tr.insertText('/', from, to)
  tr.setMeta(slashKey, { open: from } satisfies SlashMeta)
  view.dispatch(tr)
  view.focus()
}

export function slashPlugin(onChoose: (view: EditorView, item: SlashItem, state: SlashState) => void): Plugin<SlashState | null> {
  return new Plugin<SlashState | null>({
    key: slashKey,
    state: {
      init: () => null,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(slashKey) as SlashMeta | undefined
        if (meta?.close) return null
        let from: number
        let selected = prev?.selected ?? 0
        if (meta?.open !== undefined) {
          from = meta.open
          selected = 0
        } else if (prev) {
          from = tr.mapping.map(prev.from, -1)
        } else return null
        const sel = state.selection
        if (!(sel instanceof TextSelection) || !sel.empty) return null
        const $head = sel.$head
        if (!$head.parent.isTextblock || from < $head.start() || from >= $head.pos) return null
        const text = state.doc.textBetween(from, $head.pos)
        if (!isSlashChar(text[0])) return null
        const query = text.slice(1)
        if (shouldCloseSlash(query)) return null
        if (meta?.selected !== undefined) selected = meta.selected
        else if (prev && query !== prev.query) selected = 0
        const count = filterSlashItems(query).length
        if (count > 0) selected = Math.max(0, Math.min(selected, count - 1))
        return { from, query, selected }
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (!isSlashChar(text) || from !== to || view.composing) return false
        if (!canOpenAt(view, from)) return false
        const tr = view.state.tr.insertText(text, from, to)
        tr.setMeta(slashKey, { open: from } satisfies SlashMeta)
        view.dispatch(tr)
        return true
      },
      handleKeyDown(view, event) {
        const st = slashKey.getState(view.state)
        if (!st) return false
        if (isComposingEvent(view, event)) return false
        const items = filterSlashItems(st.query)
        const select = (n: number) =>
          view.dispatch(view.state.tr.setMeta(slashKey, { selected: n } satisfies SlashMeta))
        switch (event.key) {
          case 'ArrowDown':
            if (items.length) select((st.selected + 1) % items.length)
            return true
          case 'ArrowUp':
            if (items.length) select((st.selected - 1 + items.length) % items.length)
            return true
          case 'Enter':
          case 'Tab':
            if (event.shiftKey || event.metaKey || event.ctrlKey) return false
            if (items.length === 0) {
              closeSlash(view)
              return event.key === 'Tab'
            }
            event.preventDefault()
            onChoose(view, items[st.selected], st)
            return true
          case 'Escape':
            closeSlash(view)
            return true
        }
        return false
      },
      handleDOMEvents: {
        // A `/` typed through an IME arrives with compositionend (UI-17).
        compositionend(view, event) {
          const data = (event as CompositionEvent).data
          if (!data || !isSlashChar(data[data.length - 1])) return false
          setTimeout(() => {
            const sel = view.state.selection
            if (!sel.empty) return
            const pos = sel.head
            const $pos = view.state.doc.resolve(pos)
            if ($pos.parentOffset === 0) return
            const ch = $pos.parent.textBetween($pos.parentOffset - 1, $pos.parentOffset)
            if (isSlashChar(ch) && canOpenAt(view, pos - 1)) openSlash(view, pos - 1)
          }, 0)
          return false
        },
      },
    },
  })
}

/** Builders and helpers for the editor's unit tests. Not imported by the app. */
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection, type Plugin, type Transaction } from 'prosemirror-state'
import { schema } from '../lib/schema'

type J = Record<string, unknown>

export const text = (t: string, marks: J[] = []): J => (marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t })
export const p = (...c: (string | J)[]): J => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? text(x) : x)).filter((x) => x.text !== '') })
export const h = (level: number, t: string): J => ({ type: 'heading', attrs: { level }, content: t ? [text(t)] : [] })
export const li = (checked: boolean | null, ...c: (string | J)[]): J => ({
  type: 'list_item',
  attrs: { checked },
  content: [typeof c[0] === 'string' ? p(c[0]) : (c[0] as J), ...c.slice(1).map((x) => x as J)],
})
export const ul = (...items: J[]): J => ({ type: 'bullet_list', content: items })
export const ol = (...items: J[]): J => ({ type: 'ordered_list', attrs: { start: 1 }, content: items })
export const toggle = (open: boolean, summary: string, ...children: J[]): J => ({
  type: 'toggle',
  attrs: { open },
  content: [{ type: 'toggle_summary', content: summary ? [text(summary)] : [] }, ...children],
})
export const quote = (...c: J[]): J => ({ type: 'blockquote', content: c })
export const callout = (...c: J[]): J => ({ type: 'callout', attrs: { kind: 'NOTE', icon: null }, content: c })
export const code = (t: string, language = ''): J => ({ type: 'code_block', attrs: { language }, content: t ? [text(t)] : [] })
export const hr = (): J => ({ type: 'horizontal_rule' })
export const docOf = (...c: J[]): PMNode => schema.nodeFromJSON({ type: 'doc', content: c })

/** Position of `needle` in the doc's text, or throws. */
export function posOf(doc: PMNode, needle: string, at: 'start' | 'end' = 'start'): number {
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle) + (at === 'end' ? needle.length : 0)
    return true
  })
  if (found === null) throw new Error(`text not found: ${needle}`)
  return found
}

/** State with the caret in `needle` (`at` start or end) or the text selected (`select`). */
export function stateAt(doc: PMNode, needle: string, at: 'start' | 'end' | 'select' = 'end', plugins: Plugin[] = []): EditorState {
  const state = EditorState.create({ doc, plugins })
  const from = posOf(doc, needle, at === 'end' ? 'end' : 'start')
  const sel = at === 'select' ? TextSelection.create(doc, from, from + needle.length) : TextSelection.create(doc, from)
  return state.apply(state.tr.setSelection(sel))
}

/** Apply a command and return the resulting state (or null if it did not dispatch). */
export function run(
  state: EditorState,
  cmd: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean,
): EditorState | null {
  let next: EditorState | null = null
  const ok = cmd(state, (tr) => {
    next = state.apply(tr)
  })
  return ok ? next : null
}

/** Compact description of a doc for assertions: `h1:一`, `ul[a|b]`, `x todo`. */
export function outline(node: PMNode): string[] {
  const out: string[] = []
  node.forEach((child) => out.push(describe(child)))
  return out
}

function describe(node: PMNode): string {
  const kids: string[] = []
  node.forEach((c) => kids.push(describe(c)))
  switch (node.type.name) {
    case 'paragraph':
      return `p:${node.textContent}`
    case 'heading':
      return `h${node.attrs.level as number}:${node.textContent}`
    case 'bullet_list':
      return `ul[${kids.join('|')}]`
    case 'ordered_list':
      return `ol[${kids.join('|')}]`
    case 'list_item': {
      const c = node.attrs.checked as boolean | null
      const parts = kids.map((k, i) => (i === 0 && k.startsWith('p:') ? k.slice(2) : k))
      return `${c === null ? '' : c ? '[x] ' : '[ ] '}${parts.join('/')}`
    }
    case 'toggle':
      return `toggle(${node.attrs.open ? 'open' : 'closed'})[${kids.join('|')}]`
    case 'toggle_summary':
      return `summary:${node.textContent}`
    case 'blockquote':
      return `quote[${kids.join('|')}]`
    case 'callout':
      return `callout[${kids.join('|')}]`
    case 'code_block':
      return `code(${node.attrs.language as string}):${node.textContent}`
    case 'horizontal_rule':
      return 'hr'
    default:
      return node.type.name
  }
}

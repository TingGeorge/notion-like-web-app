import { toggleMark } from 'prosemirror-commands'
import type { EditorState } from 'prosemirror-state'
import type { MarkType } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { schema } from '../../lib/schema'
import { applyColor, turnIntoAtSelection, type BlockKind } from '../blocks'
import type { EditorContext } from '../context'

export function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}

export function toggleMarkByName(view: EditorView, name: 'bold' | 'italic' | 'underline' | 'strike' | 'code') {
  toggleMark(schema.marks[name])(view.state, view.dispatch)
  view.focus()
}

/** Apply a colour (`color:<name>` / `bg:<name>`) to the selection and remember it (UI-8). */
export function pickColor(view: EditorView, ctx: EditorContext, spec: string) {
  applyColor(view.state, view.dispatch, spec)
  if (!spec.endsWith(':default')) ctx.services().setLastColor(spec)
  view.focus()
}

export function turnInto(view: EditorView, kind: BlockKind) {
  turnIntoAtSelection(view.state, view.dispatch, kind)
  view.focus()
}

/** The link mark covering the selection, if any. */
export function linkAtSelection(state: EditorState): { href: string; from: number; to: number } | null {
  const type = schema.marks.link
  const { $from, $to, empty } = state.selection
  if (empty) {
    const mark = type.isInSet($from.marks())
    if (!mark) return null
    return { href: mark.attrs.href as string, from: $from.start(), to: $from.end() }
  }
  let found: string | null = null
  state.doc.nodesBetween($from.pos, $to.pos, (node) => {
    if (found !== null || !node.isText) return
    const mark = type.isInSet(node.marks)
    if (mark) found = mark.attrs.href as string
  })
  return found === null ? null : { href: found, from: $from.pos, to: $to.pos }
}

export function lastColorParts(spec: string | null): { type: 'color' | 'bg'; name: string } | null {
  if (!spec) return null
  const m = /^(color|bg):(\w+)$/.exec(spec)
  return m ? { type: m[1] as 'color' | 'bg', name: m[2] } : null
}

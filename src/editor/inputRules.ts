/**
 * Markdown shortcuts (SPEC §7.1 table). `prosemirror-inputrules` skips every rule while
 * `view.composing` is true and re-runs them on `compositionend`, which is exactly what UI-17 asks
 * for (注音 / 倉頡 users type through composition).
 */
import { InputRule, inputRules } from 'prosemirror-inputrules'
import { Selection, type EditorState, type Transaction } from 'prosemirror-state'
import type { Plugin } from 'prosemirror-state'
import type { MarkType, Node as PMNode } from 'prosemirror-model'
import { schema } from '../lib/schema'
import { blockAtSelection, insertBlocksTr, turnIntoTr, type BlockKind } from './blocks'

const N = schema.nodes

/** Append the steps of `extra` (made on the state after `tr`) to `tr`. */
function mergeInto(tr: Transaction, extra: Transaction): Transaction {
  extra.steps.forEach((s) => tr.step(s))
  tr.setSelection(Selection.fromJSON(tr.doc, extra.selection.toJSON()))
  return tr
}

/** Remove the trigger text then run `then` on the resulting state; null cancels the rule. */
function afterDeleting(
  state: EditorState,
  start: number,
  end: number,
  then: (s: EditorState) => Transaction | null,
): Transaction | null {
  const tr = state.tr.delete(start, end)
  const next = state.apply(tr)
  const extra = then(next)
  return extra ? mergeInto(tr, extra) : null
}

function blockRule(re: RegExp, kind: BlockKind): InputRule {
  return new InputRule(re, (state, _match, start, end) => {
    const $from = state.doc.resolve(start)
    if ($from.parent.type !== N.paragraph || $from.start() !== start) return null
    return afterDeleting(state, start, end, (next) => {
      const ref = blockAtSelection(next)
      return ref ? turnIntoTr(next, ref, kind) : null
    })
  })
}

function insertRule(re: RegExp, make: () => PMNode): InputRule {
  return new InputRule(re, (state, _match, start, end) => {
    const $from = state.doc.resolve(start)
    if ($from.parent.type !== N.paragraph || $from.start() !== start) return null
    return afterDeleting(state, start, end, (next) => insertBlocksTr(next, [make()]))
  })
}

function markRule(re: RegExp, type: MarkType): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const prefix = match[1] ?? ''
    const inner = match[2]
    if (!inner) return null
    const $from = state.doc.resolve(start)
    if (!$from.parent.type.allowsMarkType(type)) return null
    const markStart = start + prefix.length
    const tr = state.tr.replaceWith(markStart, end, schema.text(inner, [type.create()]))
    tr.removeStoredMark(type)
    return tr
  })
}

export const BLOCK_RULES: { re: RegExp; kind: BlockKind }[] = [
  { re: /^#\s$/, kind: 'h1' },
  { re: /^##\s$/, kind: 'h2' },
  { re: /^###\s$/, kind: 'h3' },
  { re: /^[-*+]\s$/, kind: 'bullet' },
  { re: /^\d+[.)]\s$/, kind: 'number' },
  { re: /^\[\s?\]\s$/, kind: 'todo' },
  { re: /^>\s$/, kind: 'toggle' },
  { re: /^["“”]\s$/, kind: 'quote' },
]

export function buildInputRules(): Plugin {
  const m = schema.marks
  const rules: InputRule[] = [
    ...BLOCK_RULES.map((r) => blockRule(r.re, r.kind)),
    insertRule(/^```$/, () => N.code_block.create({ language: '' })),
    insertRule(/^---$/, () => N.horizontal_rule.create()),
    markRule(/(^|[^*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, m.bold),
    markRule(/(^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, m.italic),
    markRule(/(^|[^~])~~?([^~\s](?:[^~]*[^~\s])?)~~?$/, m.strike),
    markRule(/(^|[^`])`([^`]+)`$/, m.code),
  ]
  return inputRules({ rules })
}

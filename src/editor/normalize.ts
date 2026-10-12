import { ReplaceStep } from 'prosemirror-transform'
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../lib/schema'
import { joinAdjacentLists, needsTrailingParagraph } from './blocks'

/** True when the transaction only typed or deleted text inside one text block. */
function isSimpleTextEdit(tr: Transaction): boolean {
  return tr.steps.every((step, i) => {
    if (!(step instanceof ReplaceStep)) return false
    const slice = step.slice
    if (slice.openStart || slice.openEnd) return false
    let textOnly = true
    slice.content.forEach((n) => {
      if (!n.isInline) textOnly = false
    })
    if (!textOnly) return false
    const doc = tr.docs[i]
    const $from = doc.resolve(step.from)
    return $from.parent.isTextblock && $from.sameParent(doc.resolve(step.to))
  })
}

/** The page always ends with a paragraph, so the caret can get below a table, image or code block. */
export function withTrailingParagraph(doc: PMNode): PMNode {
  if (!needsTrailingParagraph(doc.lastChild)) return doc
  return schema.topNodeType.create(doc.attrs, doc.content.addToEnd(schema.nodes.paragraph.create()))
}

export const normalizeKey = new PluginKey('gn-normalize')

/**
 * Keeps the document in the shape Markdown can express (DATA-16): adjacent lists of one kind are
 * joined, and a paragraph follows a trailing atom/table/code block.
 */
export function normalizePlugin(): Plugin {
  return new Plugin({
    key: normalizeKey,
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged)) return null
      if (trs.every((t) => !t.docChanged || isSimpleTextEdit(t))) return null
      const tr = state.tr
      joinAdjacentLists(tr)
      if (needsTrailingParagraph(tr.doc.lastChild)) tr.insert(tr.doc.content.size, schema.nodes.paragraph.create())
      if (!tr.docChanged) return null
      if (trs.some((t) => t.getMeta('addToHistory') === false)) tr.setMeta('addToHistory', false)
      if (trs.some((t) => t.getMeta('gn-ui-only'))) tr.setMeta('gn-ui-only', true)
      return tr
    },
  })
}

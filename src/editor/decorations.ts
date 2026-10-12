/**
 * View-only decorations: empty-block hints (D11), the selection highlight kept while a toolbar
 * menu has focus, and the 「空的 toggle」 prompt.
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { schema } from '../lib/schema'
import { t } from '../strings'
import type { EditorContext } from './context'

const N = schema.nodes

export const focusKey = new PluginKey<boolean>('gn-focus')

export function decorationsPlugin(getPlaceholder: () => string | undefined, ctx: EditorContext): Plugin {
  return new Plugin({
    key: focusKey,
    state: {
      init: () => false,
      apply(tr, prev) {
        const meta = tr.getMeta(focusKey) as boolean | undefined
        return meta === undefined ? prev : meta
      },
    },
    props: {
      handleDOMEvents: {
        focus(view) {
          setTimeout(() => view.dispatch(view.state.tr.setMeta(focusKey, true)), 0)
          return false
        },
        blur(view) {
          setTimeout(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(focusKey, false))
          }, 0)
          return false
        },
      },
      decorations(state) {
        const focused = focusKey.getState(state) ?? false
        const decos: Decoration[] = []
        const { selection, doc } = state
        const placeholder = getPlaceholder()
        const onlyEmptyParagraph = doc.childCount === 1 && doc.firstChild!.type === N.paragraph && doc.firstChild!.content.size === 0

        doc.descendants((node, pos, parent) => {
          if (node.type === N.toggle) {
            if (node.attrs.open && node.childCount === 1) {
              decos.push(
                Decoration.widget(
                  pos + node.nodeSize - 1,
                  (view, getPos) => {
                    const b = document.createElement('div')
                    b.className = 'toggle-empty'
                    b.contentEditable = 'false'
                    b.setAttribute('role', 'button')
                    b.textContent = t.editor.toggleEmpty
                    b.addEventListener('mousedown', (e) => e.preventDefault())
                    b.addEventListener('click', () => {
                      const at = getPos()
                      if (at === undefined) return
                      const tr = view.state.tr.insert(at, N.paragraph.create())
                      tr.setSelection(TextSelection.create(tr.doc, at + 1))
                      view.dispatch(tr.scrollIntoView())
                      view.focus()
                    })
                    return b
                  },
                  { side: 1, key: `toggle-empty-${pos}`, ignoreSelection: true },
                ),
              )
            }
            return true
          }
          if (!node.isTextblock || node.content.size > 0) return true
          const isHere = selection.$from.parent === node && selection.empty
          let text: string | null = null
          if (node.type === N.heading) text = t.editor.emptyHeading(node.attrs.level as number)
          else if (node.type === N.toggle_summary) text = t.editor.toggleTitle
          else if (node.type === N.paragraph) {
            if (parent?.type === N.list_item) {
              const checked = (doc.resolve(pos).parent.attrs as { checked: boolean | null }).checked
              text = checked === null ? t.editor.emptyListItem : t.editor.emptyTodo
            } else if (parent?.type === N.blockquote) text = t.editor.emptyQuote
            else if (onlyEmptyParagraph && placeholder) text = placeholder
            else if (isHere && focused) text = t.editor.slashHint
          }
          if (text) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-empty', 'data-placeholder': text }))
          return false
        })

        const ui = ctx.ui.getSnapshot()
        if (ui.blockMenu) {
          const n = doc.nodeAt(ui.blockMenu.pos)
          if (n) decos.push(Decoration.node(ui.blockMenu.pos, ui.blockMenu.pos + n.nodeSize, { class: 'gn-block-selected' }))
        }
        if (!selection.empty && (ui.toolbarMenu || ui.mobileSheet)) {
          decos.push(Decoration.inline(selection.from, selection.to, { class: 'gn-keep-selection' }))
        }
        return DecorationSet.create(doc, decos)
      },
    },
  })
}

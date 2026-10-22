/**
 * The block editor (see `types.ts` for the contract). ProseMirror owns the document; React owns
 * the floating UI around it (menus, toolbars, the block handle).
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState } from 'react'
import { baseKeymap } from 'prosemirror-commands'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, Plugin, Selection, type Transaction } from 'prosemirror-state'
import { tableEditing } from 'prosemirror-tables'
import { EditorView } from 'prosemirror-view'
import { schema } from '../lib/schema'
import { t } from '../strings'
import { cx } from '../ui/primitives'
import { AssetCache, UIStore, type EditorContext } from './context'
import { decorationsPlugin } from './decorations'
import { replaceDocTr, setContentTr } from './docOps'
import { buildInputRules } from './inputRules'
import { runInsertItem } from './insert'
import { openLink } from './links'
import { createNodeViews, pageLinkViews } from './nodeViews'
import { isSimpleTextEdit, normalizePlugin, withTrailingParagraph } from './normalize'
import { pasteProps } from './paste'
import { shortcutsPlugin } from './shortcuts'
import { slashPlugin } from './slash'
import type { EditorHandle, EditorProps } from './types'
import { uploadPlugin } from './upload'
import { BlockHandle } from './ui/BlockHandle'
import { BlockMenu } from './ui/BlockMenu'
import { CropDialog } from './ui/CropDialog'
import { EmojiPicker } from './ui/EmojiPicker'
import { FormatToolbar } from './ui/FormatToolbar'
import { LinkPopover } from './ui/LinkPopover'
import { MobileBar } from './ui/MobileBar'
import { EditorUIContext } from './ui/shared'
import { SlashMenu } from './ui/SlashMenu'
import { TableBar } from './ui/TableBar'
import './editor.css'

/** UI-5: a click on a link opens it (pages inside the app, everything else in a new tab). */
function linkClickPlugin(ctx: EditorContext): Plugin {
  const anchorOf = (view: EditorView, target: EventTarget | null) => {
    const a = target instanceof Element ? target.closest('a[href]') : null
    return a && view.dom.contains(a) ? (a as HTMLAnchorElement) : null
  }
  return new Plugin({
    props: {
      handleClick(view, _pos, event) {
        const a = anchorOf(view, event.target)
        if (!a || event.altKey) return false
        event.preventDefault()
        openLink(ctx, a.getAttribute('href') ?? '', a.textContent ?? '')
        return true
      },
      handleDOMEvents: {
        // Never let the browser navigate from inside the editor.
        click(view, event) {
          if (anchorOf(view, event.target)) event.preventDefault()
          return false
        },
        auxclick(view, event) {
          if (anchorOf(view, event.target)) event.preventDefault()
          return false
        },
        // A click below the last block puts the caret there, adding a paragraph if needed (as in Notion).
        mousedown(view, event) {
          if (event.target !== view.dom || !view.editable || event.button !== 0) return false
          const last = view.dom.lastElementChild
          const bottom = last ? last.getBoundingClientRect().bottom : view.dom.getBoundingClientRect().top
          if (event.clientY <= bottom + 2) return false
          event.preventDefault()
          const { doc } = view.state
          const tr = view.state.tr
          const lastNode = doc.lastChild
          if (!(lastNode && lastNode.type === schema.nodes.paragraph && lastNode.content.size === 0)) {
            tr.insert(doc.content.size, schema.nodes.paragraph.create())
            // An empty paragraph is not written to Markdown: no change to report (a click must
            // not rewrite a page whose Markdown is not in the app's style, DATA-16).
            tr.setMeta('gn-ui-only', true)
            tr.setMeta('addToHistory', false)
          }
          tr.setSelection(Selection.atEnd(tr.doc))
          view.dispatch(tr.scrollIntoView())
          view.focus()
          return true
        },
      },
    },
  })
}

/**
 * Where the image at `pos` is after `tr`, or -1 if it is gone. A change to the image's own
 * attributes (a caption, a width) replaces the node, so it is followed to the image this
 * transaction put in its place with the same `src`; an image that merely moved up into its place
 * (a copy of the same picture right after it) is not it.
 */
function mapImage(tr: Transaction, doc: PMNode, pos: number): number {
  if (pos < 0) return -1
  const after = tr.mapping.mapResult(pos)
  if (!after.deleted) return after.pos
  const src = tr.before.nodeAt(pos)?.attrs.src as string | undefined
  const at = tr.mapping.map(pos, -1)
  if (!tr.mapping.invert().mapResult(at, 1).deleted) return -1
  const node = at < doc.content.size ? doc.nodeAt(at) : null
  return node?.type === schema.nodes.image && node.attrs.src === src ? at : -1
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const { editable, mobile, className } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const latest = useRef(props)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [view, setView] = useState<EditorView | null>(null)
  const [, force] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    latest.current = props
  })

  const ctx = useMemo<EditorContext>(
    () => ({
      services: () => latest.current.services,
      onExitTop: () => {
        const fn = latest.current.onExitTop
        if (!fn) return false
        fn()
        return true
      },
      ui: new UIStore(),
      hover: { pos: null },
      view: () => viewRef.current,
      assets: new AssetCache((href) => latest.current.services.resolveAsset(href)),
    }),
    [],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let pendingChange = false
    let composeTimer: number | undefined

    const plugins: Plugin[] = [
      slashPlugin((v, item, st) => runInsertItem(v, item.id, ctx, { from: st.from, to: v.state.selection.head })),
      shortcutsPlugin(ctx),
      buildInputRules(),
      history(),
      keymap(baseKeymap),
      dropCursor({ color: 'var(--accent-default)', width: 2 }),
      gapCursor(),
      tableEditing(),
      normalizePlugin(),
      decorationsPlugin(() => latest.current.placeholder, ctx),
      uploadPlugin(),
      linkClickPlugin(ctx),
    ]
    const state = EditorState.create({ doc: withTrailingParagraph(latest.current.doc), plugins })
    const v: EditorView = new EditorView(host, {
      state,
      nodeViews: createNodeViews(ctx),
      editable: () => latest.current.editable,
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': t.editor.editorLabel,
        class: 'gn-prose',
      },
      markViews: {
        link: (mark) => {
          const a = document.createElement('a')
          const href = mark.attrs.href as string
          a.href = href
          if (!href.startsWith('/')) {
            a.target = '_blank'
            a.rel = 'noopener noreferrer'
          }
          if (mark.attrs.title) a.title = mark.attrs.title as string
          return { dom: a }
        },
      },
      ...pasteProps(ctx),
      handleDOMEvents: {
        compositionend: () => {
          // UI-17: report edits made during composition once it has settled.
          window.clearTimeout(composeTimer)
          composeTimer = window.setTimeout(() => {
            if (pendingChange && !v.composing) {
              pendingChange = false
              latest.current.onChange(v.state.doc)
            }
          }, 60)
          return false
        },
      },
      dispatchTransaction(tr) {
        const next = v.state.apply(tr)
        v.updateState(next)
        if (tr.docChanged) {
          // The block handle hides while text is typed and returns on the next mouse move.
          if (ctx.hover.pos !== null) ctx.hover.pos = isSimpleTextEdit(tr) ? null : tr.mapping.map(ctx.hover.pos)
          // DATA-19: the image being cropped moves with the document (the dialog closes if it goes).
          const crop = ctx.ui.getSnapshot().crop
          if (crop) crop.pos = mapImage(tr, next.doc, crop.pos)
          if (!tr.getMeta('gn-ui-only') && !tr.getMeta('gn-silent')) {
            if (v.composing) pendingChange = true
            else latest.current.onChange(next.doc)
          }
        }
        force()
      },
    })
    viewRef.current = v
    setView(v)
    const unsub = ctx.ui.subscribe(() => {
      if (!v.isDestroyed) v.dispatch(v.state.tr.setMeta('gn-refresh', true))
    })
    const timer = window.setInterval(() => pageLinkViews.forEach((p) => p.refresh()), 3000)
    const onFocus = () => pageLinkViews.forEach((p) => p.refresh())
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(composeTimer)
      window.removeEventListener('focus', onFocus)
      unsub()
      v.destroy()
      viewRef.current = null
      setView(null)
      ctx.assets.dispose()
      ctx.ui.reset()
    }
  }, [ctx])

  // `editable` and `placeholder` are read lazily by the view; nudge it when they change.
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    v.setProps({ editable: () => latest.current.editable })
    v.dispatch(v.state.tr.setMeta('gn-refresh', true))
  }, [editable, props.placeholder])

  useImperativeHandle(
    ref,
    () => ({
      get view() {
        return viewRef.current
      },
      focus(where = 'end') {
        const v = viewRef.current
        if (!v) return
        const sel = where === 'start' ? Selection.atStart(v.state.doc) : Selection.atEnd(v.state.doc)
        v.dispatch(v.state.tr.setSelection(sel).scrollIntoView())
        v.focus()
      },
      replaceDoc(doc) {
        const v = viewRef.current
        if (!v) return
        const tr = replaceDocTr(v.state, doc)
        if (tr) v.dispatch(tr)
      },
      getDoc() {
        return viewRef.current?.state.doc ?? latest.current.doc
      },
      setContent(doc) {
        const v = viewRef.current
        if (!v) return
        v.dispatch(setContentTr(v.state, doc))
      },
    }),
    [],
  )

  const uiValue = useMemo(() => (view ? { view, ctx, mobile: !!mobile } : null), [view, ctx, mobile])

  return (
    <div
      ref={setRoot}
      className={cx('gn-editor', mobile && 'is-mobile', !editable && 'is-readonly', className)}
      data-schema={schema.nodes.doc.name}
    >
      <div ref={hostRef} className="gn-editor-host" />
      {uiValue && root && editable && (
        <EditorUIContext.Provider value={uiValue}>
          <BlockHandle root={root} />
          <SlashMenu />
          <FormatToolbar />
          <LinkPopover />
          <EmojiPicker />
          <BlockMenu />
          <TableBar />
          <CropDialog />
          {mobile && <MobileBar />}
        </EditorUIContext.Provider>
      )}
    </div>
  )
})

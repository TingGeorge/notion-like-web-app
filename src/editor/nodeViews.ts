/**
 * Node views: the DOM the editor shows for blocks that need more than their `toDOM`. All of them
 * are plain DOM (no React) so typing stays fast. Anything interactive that is not text is
 * `contenteditable="false"` and stops its events from reaching ProseMirror.
 */
import { NodeSelection, TextSelection, type Transaction } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view'
import { addColumnAfter, addRowAfter } from 'prosemirror-tables'
import { CALLOUT_DEFAULT_ICON, type CalloutKind } from '../lib/schema'
import { t } from '../strings'
import type { EditorContext } from './context'
import { setToggleOpen } from './commands'
import { icons } from './icons'
import { downloadAsset } from './links'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

const NOT_EDITABLE = { contenteditable: 'false' }

/** Mutations outside the editable content (our own buttons, labels, attributes) are not edits. */
function ignoreOutside(contentDOM: HTMLElement | null | undefined) {
  return (m: ViewMutationRecord): boolean => {
    if (!contentDOM) return true
    if (m.type === 'selection') return !contentDOM.contains(m.target as Node)
    return !contentDOM.contains(m.target as Node) || (m.target === contentDOM && m.type === 'attributes')
  }
}

abstract class BaseView implements NodeView {
  abstract dom: HTMLElement
  contentDOM?: HTMLElement
  constructor(
    public node: PMNode,
    public view: EditorView,
    public getPos: () => number | undefined,
    public ctx: EditorContext,
  ) {}
  ignoreMutation(m: ViewMutationRecord): boolean {
    return ignoreOutside(this.contentDOM)(m)
  }
  protected dispatchAttrs(attrs: Record<string, unknown>, extra?: (tr: Transaction) => void) {
    const pos = this.getPos()
    if (pos === undefined) return
    const node = this.view.state.doc.nodeAt(pos)
    if (!node) return
    const tr = this.view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs })
    extra?.(tr)
    this.view.dispatch(tr)
  }
}

// --- list item (to-do checkbox) --------------------------------------------------------------

class ListItemView extends BaseView {
  dom = el('li')
  box: HTMLElement | null = null
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    this.contentDOM = el('div', 'li-body')
    if (node.attrs.checked !== null) {
      this.dom.className = 'todo'
      this.box = el('span', 'todo-box', {
        ...NOT_EDITABLE,
        role: 'checkbox',
        'aria-label': t.editor.blocks.todo,
      })
      this.box.innerHTML = icons.check(12)
      this.box.addEventListener('mousedown', (e) => e.preventDefault())
      this.box.addEventListener('click', (e) => {
        e.preventDefault()
        if (!this.view.editable) return
        this.dispatchAttrs({ checked: !this.node.attrs.checked })
      })
      this.dom.append(this.box)
    }
    this.dom.append(this.contentDOM)
    this.sync()
  }
  sync() {
    const checked = this.node.attrs.checked as boolean | null
    if (checked === null) return
    this.dom.setAttribute('data-checked', String(checked))
    this.box?.setAttribute('aria-checked', String(checked))
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    if ((node.attrs.checked === null) !== (this.node.attrs.checked === null)) return false
    this.node = node
    this.sync()
    return true
  }
  stopEvent(e: Event): boolean {
    return !!this.box && e.target instanceof Node && this.box.contains(e.target)
  }
}

// --- numbered list (start number for the CSS counter) -------------------------------------------

class OrderedListView extends BaseView {
  dom = el('ol')
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    this.contentDOM = this.dom
    this.sync()
  }
  sync() {
    this.dom.style.setProperty('--start', String(this.node.attrs.start as number))
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.sync()
    return true
  }
  ignoreMutation(m: ViewMutationRecord): boolean {
    return m.type === 'attributes' && m.target === this.dom
  }
}

// --- toggle ----------------------------------------------------------------------------------

class ToggleView extends BaseView {
  dom = el('div', 'toggle')
  arrow = el('button', 'toggle-arrow', { ...NOT_EDITABLE, type: 'button', tabindex: '-1' })
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    this.contentDOM = el('div', 'toggle-body')
    this.arrow.innerHTML = icons.triangle(10)
    this.arrow.addEventListener('mousedown', (e) => e.preventDefault())
    this.arrow.addEventListener('click', (e) => {
      e.preventDefault()
      const pos = this.getPos()
      if (pos === undefined) return
      const current = this.view.state.doc.nodeAt(pos)
      if (!current) return
      // UI state only: not undoable, not saved (the Markdown has no `open`).
      this.view.dispatch(setToggleOpen(this.view.state.tr, pos, !current.attrs.open))
    })
    this.dom.append(this.arrow, this.contentDOM)
    this.sync()
  }
  sync() {
    const open = !!this.node.attrs.open
    this.dom.toggleAttribute('data-open', open)
    this.arrow.setAttribute('aria-expanded', String(open))
    this.arrow.setAttribute('aria-label', open ? t.editor.toggleCollapse : t.editor.toggleExpand)
    this.arrow.title = open ? t.editor.toggleCollapse : t.editor.toggleExpand
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.sync()
    return true
  }
  stopEvent(e: Event): boolean {
    return e.target instanceof Node && this.arrow.contains(e.target)
  }
}

class ToggleSummaryView extends BaseView {
  dom = el('div', 'toggle-summary')
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    this.contentDOM = this.dom
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    return true
  }
  ignoreMutation(m: ViewMutationRecord): boolean {
    return m.type === 'attributes' && m.target === this.dom
  }
}

// --- callout ---------------------------------------------------------------------------------

export function calloutIconOf(node: PMNode): string {
  return (node.attrs.icon as string | null) ?? CALLOUT_DEFAULT_ICON[node.attrs.kind as CalloutKind] ?? CALLOUT_DEFAULT_ICON.NOTE
}

class CalloutView extends BaseView {
  dom = el('div', 'callout')
  icon = el('button', 'callout-icon', { ...NOT_EDITABLE, type: 'button', tabindex: '-1', 'aria-label': t.editor.calloutIcon, title: t.editor.calloutIcon })
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    this.contentDOM = el('div', 'callout-body')
    this.icon.addEventListener('mousedown', (e) => e.preventDefault())
    this.icon.addEventListener('click', (e) => {
      e.preventDefault()
      const pos = this.getPos()
      if (pos === undefined || !this.view.editable) return
      this.ctx.ui.set({ emoji: { pos, anchor: this.icon.getBoundingClientRect() } })
    })
    this.dom.append(this.icon, this.contentDOM)
    this.sync()
  }
  sync() {
    this.icon.textContent = calloutIconOf(this.node)
    this.dom.setAttribute('data-kind', this.node.attrs.kind as string)
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.sync()
    return true
  }
  stopEvent(e: Event): boolean {
    return e.target instanceof Node && this.icon.contains(e.target)
  }
}

// --- code block ------------------------------------------------------------------------------

export const CODE_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'sql',
  'swift',
  'typescript',
  'yaml',
]

class CodeBlockView extends BaseView {
  dom = el('div', 'code-block')
  header = el('div', 'code-header', NOT_EDITABLE)
  select = el('select', 'code-language', { 'aria-label': t.editor.codeLanguage })
  copyBtn = el('button', 'code-copy', { type: 'button', 'aria-label': t.editor.copyCode, title: t.editor.copyCode, tabindex: '-1' })
  timer: number | undefined
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    this.contentDOM = el('pre', 'code-content', { spellcheck: 'false' })
    this.copyBtn.innerHTML = icons.copy(14)
    this.copyBtn.addEventListener('mousedown', (e) => e.preventDefault())
    this.copyBtn.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.node.textContent).then(
        () => {
          this.copyBtn.innerHTML = icons.check(14)
          this.copyBtn.classList.add('is-done')
          window.clearTimeout(this.timer)
          this.timer = window.setTimeout(() => {
            this.copyBtn.innerHTML = icons.copy(14)
            this.copyBtn.classList.remove('is-done')
          }, 1500)
        },
        () => undefined,
      )
    })
    this.select.addEventListener('change', () => {
      this.dispatchAttrs({ language: this.select.value })
      this.view.focus()
    })
    this.header.append(this.select, this.copyBtn)
    this.dom.append(this.header, this.contentDOM)
    this.buildOptions()
    this.sync()
  }
  buildOptions() {
    this.select.textContent = ''
    const langs = [...CODE_LANGUAGES]
    const cur = this.node.attrs.language as string
    if (cur && !langs.includes(cur)) langs.unshift(cur)
    const plain = el('option')
    plain.value = ''
    plain.textContent = t.editor.plainText
    this.select.append(plain)
    for (const l of langs) {
      const o = el('option')
      o.value = l
      o.textContent = l
      this.select.append(o)
    }
  }
  sync() {
    const cur = this.node.attrs.language as string
    if (cur && !Array.from(this.select.options).some((o) => o.value === cur)) this.buildOptions()
    this.select.value = cur
    this.select.disabled = !this.view.editable
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.sync()
    return true
  }
  stopEvent(e: Event): boolean {
    return e.target instanceof Node && this.header.contains(e.target)
  }
  destroy() {
    window.clearTimeout(this.timer)
  }
}

// --- image -----------------------------------------------------------------------------------

class ImageView extends BaseView {
  dom = el('figure', 'image-block', NOT_EDITABLE)
  frame = el('div', 'image-frame')
  caption = el('input', 'image-caption', { type: 'text', placeholder: t.editor.imageCaption, 'aria-label': t.editor.imageCaption })
  img: HTMLImageElement | null = null
  src = ''
  disposed = false
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    this.dom.append(this.frame, this.caption)
    this.caption.addEventListener('change', () => this.dispatchAttrs({ alt: this.caption.value }))
    this.caption.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault()
        this.caption.blur()
        this.view.focus()
      }
    })
    this.caption.readOnly = !view.editable
    this.load()
    this.syncCaption()
  }
  syncCaption() {
    const alt = (this.node.attrs.alt as string) ?? ''
    if (document.activeElement !== this.caption) this.caption.value = alt
    this.dom.toggleAttribute('data-has-caption', alt.length > 0)
  }
  placeholder(loading: boolean) {
    this.frame.textContent = ''
    const box = el('div', `image-placeholder${loading ? ' is-loading' : ''}`)
    box.innerHTML = `${icons.image(20)}<span></span>`
    box.lastElementChild!.textContent = loading ? t.common.loading : t.editor.imageUnavailable
    if (!loading) {
      box.setAttribute('role', 'button')
      box.tabIndex = -1
      box.addEventListener('click', (e) => {
        e.preventDefault()
        this.load(true)
      })
    }
    this.frame.append(box)
  }
  load(force = false) {
    const src = this.node.attrs.src as string
    this.src = src
    const show = (url: string) => {
      if (this.disposed || this.src !== src) return
      const img = el('img')
      img.alt = (this.node.attrs.alt as string) ?? ''
      img.draggable = false
      img.addEventListener('error', () => {
        if (!this.disposed && this.src === src) this.placeholder(false)
      })
      img.addEventListener('load', () => {
        if (this.disposed || this.src !== src) return
        this.frame.textContent = ''
        this.frame.append(img)
      })
      img.src = url
      this.img = img
    }
    this.placeholder(true)
    if (/^(https:\/\/|blob:)/i.test(src)) {
      show(src)
      return
    }
    void this.ctx.assets.get(src, force).then((url) => {
      if (this.disposed || this.src !== src) return
      if (url) show(url)
      else this.placeholder(false)
    })
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const srcChanged = node.attrs.src !== this.node.attrs.src
    this.node = node
    if (srcChanged) this.load()
    else if (this.img) this.img.alt = (node.attrs.alt as string) ?? ''
    this.syncCaption()
    return true
  }
  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }
  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }
  stopEvent(e: Event): boolean {
    return e.target === this.caption || (e.target instanceof Node && this.frame.contains(e.target) && e.type === 'click' && !!this.frame.querySelector('.image-placeholder:not(.is-loading)'))
  }
  ignoreMutation(): boolean {
    return true
  }
  destroy() {
    this.disposed = true
  }
}

// --- file ------------------------------------------------------------------------------------

class FileView extends BaseView {
  dom = el('div', 'file-block', { ...NOT_EDITABLE, role: 'button', tabindex: '-1' })
  nameEl = el('span', 'file-name')
  hint = el('span', 'file-hint')
  busy = false
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    const icon = el('span', 'file-icon')
    icon.innerHTML = icons.file(18)
    this.dom.append(icon, this.nameEl, this.hint)
    this.dom.addEventListener('click', (e) => {
      e.preventDefault()
      void this.download()
    })
    this.sync()
  }
  async download() {
    if (this.busy) return
    this.busy = true
    this.dom.classList.remove('is-error')
    const ok = await downloadAsset(this.ctx, this.node.attrs.href as string, this.node.attrs.name as string)
    this.busy = false
    if (!ok) {
      this.dom.classList.add('is-error')
      this.hint.textContent = t.editor.fileUnavailable
      window.setTimeout(() => {
        this.dom.classList.remove('is-error')
        this.hint.textContent = ''
      }, 2500)
    }
  }
  sync() {
    const name = (this.node.attrs.name as string) || decodeURIComponent((this.node.attrs.href as string).split('/').pop() ?? '')
    this.nameEl.textContent = name
    this.dom.setAttribute('aria-label', `${t.editor.fileDownload} ${name}`)
    this.dom.title = t.editor.fileDownload
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.sync()
    return true
  }
  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }
  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }
  stopEvent(e: Event): boolean {
    return e.type === 'click'
  }
  ignoreMutation(): boolean {
    return true
  }
}

// --- page link -------------------------------------------------------------------------------

export const pageLinkViews = new Set<PageLinkView>()

export class PageLinkView extends BaseView {
  dom = el('div', 'page-link-block', { ...NOT_EDITABLE, role: 'link', tabindex: '-1' })
  iconEl = el('span', 'page-link-icon')
  titleEl = el('span', 'page-link-title')
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    this.dom.append(this.iconEl, this.titleEl)
    this.dom.addEventListener('click', (e) => {
      e.preventDefault()
      this.ctx.services().openPage(this.node.attrs.href as string)
    })
    pageLinkViews.add(this)
    this.refresh()
  }
  /** Live title and icon from the app (the page may have been renamed since). */
  refresh() {
    const info = this.ctx.services().pageInfo(this.node.attrs.href as string)
    const title = info?.title || (this.node.attrs.title as string) || t.common.untitled
    if (info?.icon) {
      this.iconEl.textContent = info.icon
      this.iconEl.classList.add('is-emoji')
    } else {
      this.iconEl.classList.remove('is-emoji')
      if (!this.iconEl.firstElementChild) this.iconEl.innerHTML = icons.fileText(18)
    }
    if (this.titleEl.textContent !== title) this.titleEl.textContent = title
    this.dom.classList.toggle('is-missing', !info)
    this.dom.setAttribute('aria-label', title)
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.refresh()
    return true
  }
  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }
  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }
  stopEvent(e: Event): boolean {
    return e.type === 'click'
  }
  ignoreMutation(): boolean {
    return true
  }
  destroy() {
    pageLinkViews.delete(this)
  }
}

// --- raw Markdown ----------------------------------------------------------------------------

class RawView extends BaseView {
  dom = el('div', 'raw-block')
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    const label = el('span', 'raw-label', { ...NOT_EDITABLE, title: t.editor.rawHint })
    label.textContent = t.editor.rawLabel
    this.contentDOM = el('pre', 'raw-content', { spellcheck: 'false' })
    this.dom.append(label, this.contentDOM)
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    return true
  }
  stopEvent(e: Event): boolean {
    return e.target instanceof Element && !!e.target.closest('.raw-label')
  }
}

// --- table -----------------------------------------------------------------------------------

class TableView extends BaseView {
  dom = el('div', 'table-wrap')
  scroll = el('div', 'table-scroll')
  table = el('table')
  addCol = el('button', 'table-add table-add-col', { ...NOT_EDITABLE, type: 'button', tabindex: '-1', 'aria-label': t.editor.tableAddColumn, title: t.editor.tableAddColumn })
  addRow = el('button', 'table-add table-add-row', { ...NOT_EDITABLE, type: 'button', tabindex: '-1', 'aria-label': t.editor.tableAddRow, title: t.editor.tableAddRow })
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) {
    super(node, view, getPos, ctx)
    this.contentDOM = el('tbody')
    this.table.append(this.contentDOM)
    this.scroll.append(this.table)
    this.addCol.innerHTML = icons.plus(14)
    this.addRow.innerHTML = icons.plus(14)
    for (const b of [this.addCol, this.addRow]) b.addEventListener('mousedown', (e) => e.preventDefault())
    this.addCol.addEventListener('click', () => this.append('col'))
    this.addRow.addEventListener('click', () => this.append('row'))
    this.dom.append(this.scroll, this.addCol, this.addRow)
    this.sync()
  }
  /** Put the caret in the last column / row, then use the prosemirror-tables command. */
  append(what: 'row' | 'col') {
    const pos = this.getPos()
    if (pos === undefined || !this.view.editable) return
    const table = this.view.state.doc.nodeAt(pos)
    if (!table) return
    let cellPos: number
    if (what === 'col') {
      const row = table.firstChild!
      cellPos = pos + 2
      for (let i = 0; i < row.childCount - 1; i++) cellPos += row.child(i).nodeSize
    } else {
      cellPos = pos + 1
      for (let i = 0; i < table.childCount - 1; i++) cellPos += table.child(i).nodeSize
      cellPos += 1
    }
    const tr = this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, cellPos + 1))
    this.view.dispatch(tr)
    ;(what === 'col' ? addColumnAfter : addRowAfter)(this.view.state, this.view.dispatch)
    this.view.focus()
  }
  sync() {
    const cols = this.node.firstChild?.childCount ?? 1
    this.table.style.setProperty('--cols', String(cols))
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.sync()
    return true
  }
  stopEvent(e: Event): boolean {
    return e.target instanceof Node && (this.addCol.contains(e.target) || this.addRow.contains(e.target))
  }
  ignoreMutation(m: ViewMutationRecord): boolean {
    if (m.type === 'attributes' && (m.target === this.table || m.target === this.dom)) return true
    return ignoreOutside(this.contentDOM)(m)
  }
}

export function createNodeViews(ctx: EditorContext): Record<string, NodeViewConstructor> {
  const make =
    (Cls: new (node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorContext) => NodeView): NodeViewConstructor =>
    (node, view, getPos) =>
      new Cls(node, view, getPos as () => number | undefined, ctx)
  return {
    list_item: make(ListItemView),
    ordered_list: make(OrderedListView),
    toggle: make(ToggleView),
    toggle_summary: make(ToggleSummaryView),
    callout: make(CalloutView),
    code_block: make(CodeBlockView),
    image: make(ImageView),
    file: make(FileView),
    page_link: make(PageLinkView),
    raw: make(RawView),
    table: make(TableView),
  }
}

/** Select a block node (used by handle clicks). */
export function selectNodeAt(view: EditorView, pos: number) {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
}

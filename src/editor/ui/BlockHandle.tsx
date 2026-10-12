import { useEffect, useReducer, useRef, useState } from 'react'
import { GripVertical, Plus } from 'lucide-react'
import { t } from '../../strings/zh-TW'
import { schema } from '../../lib/schema'
import { addParagraphBelowTr, handleBlockAt, moveBlockToTr } from '../blocks'
import { insertSlashAtSelection } from '../slash'
import { useEditorUI, useUIState } from './shared'

const N = schema.nodes
const HANDLE_W = 48
const GAP = 6
const ICON = 24

interface DropTarget {
  dstPos: number
  where: 'before' | 'after'
  top: number
  left: number
  width: number
  valid: boolean
}

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

function firstTextElement(dom: HTMLElement): HTMLElement {
  if (dom.matches('p,h1,h2,h3,.toggle-summary')) return dom
  return (
    dom.querySelector<HTMLElement>(':scope > .li-body > p, :scope > .toggle-body > .toggle-summary, :scope > .callout-body > p, :scope > p, :scope > blockquote > p') ??
    dom
  )
}

/** UI-3: `+` and `⋮⋮` in the left gutter of the hovered block; the grip drags, a click opens the menu. */
export function BlockHandle({ root }: { root: HTMLElement }) {
  const { view, ctx, mobile } = useEditorUI()
  const ui = useUIState(ctx)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const menuOpen = !!ui.blockMenu
  const menuOpenRef = useRef(menuOpen)
  useEffect(() => {
    menuOpenRef.current = menuOpen
  }, [menuOpen])
  const hideTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (mobile) return
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current || menuOpenRef.current || !view.editable) return
      window.clearTimeout(hideTimer.current)
      const box = view.dom.getBoundingClientRect()
      if (e.clientY < box.top - 4 || e.clientY > box.bottom + 4) return
      const x = Math.min(Math.max(e.clientX, box.left + 12), box.right - 12)
      const hit = view.posAtCoords({ left: x, top: e.clientY })
      if (!hit) return
      const pos = handleBlockAt(view.state.doc, hit)
      if (pos !== ctx.hover.pos) {
        ctx.hover.pos = pos
        bump()
      }
    }
    const onLeave = () => {
      if (draggingRef.current || menuOpenRef.current) return
      window.clearTimeout(hideTimer.current)
      hideTimer.current = window.setTimeout(() => {
        ctx.hover.pos = null
        bump()
      }, 200)
    }
    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    return () => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
      window.clearTimeout(hideTimer.current)
    }
  }, [root, view, ctx, mobile])

  const hoverPos = ctx.hover.pos
  const node = hoverPos === null ? null : view.state.doc.nodeAt(hoverPos)
  const dom = hoverPos === null || !node ? null : view.nodeDOM(hoverPos)

  const startDrag = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || hoverPos === null) return
    e.preventDefault()
    const srcPos = hoverPos
    const srcNode = view.state.doc.nodeAt(srcPos)
    if (!srcNode) return
    const srcEnd = srcPos + srcNode.nodeSize
    const grip = e.currentTarget
    const startX = e.clientX
    const startY = e.clientY
    let active = false
    let last = { x: startX, y: startY }
    let target: DropTarget | null = null
    let raf = 0
    const scroller = scrollParentOf(view.dom)

    const compute = (x: number, y: number): DropTarget | null => {
      const box = view.dom.getBoundingClientRect()
      const px = Math.min(Math.max(x, box.left + 12), box.right - 12)
      const doc = view.state.doc
      let blockPos: number | null = null
      const hit = view.posAtCoords({ left: px, top: y })
      if (hit) blockPos = handleBlockAt(doc, hit)
      let where: 'before' | 'after' = 'before'
      if (blockPos === null || y > box.bottom) {
        const lastChild = doc.lastChild
        if (!lastChild) return null
        blockPos = doc.content.size - lastChild.nodeSize
        where = 'after'
      }
      const el = view.nodeDOM(blockPos)
      if (!(el instanceof HTMLElement)) return null
      const r = el.getBoundingClientRect()
      if (!(y > box.bottom)) where = y < r.top + r.height / 2 ? 'before' : 'after'
      const dst = doc.nodeAt(blockPos)
      let left = r.left
      if (dst?.type === N.list_item && el.parentElement) left = el.parentElement.getBoundingClientRect().left
      const inside = blockPos >= srcPos && blockPos < srcEnd
      const valid = !inside && moveBlockToTr(view.state, srcPos, blockPos, where) !== null
      return { dstPos: blockPos, where, top: where === 'before' ? r.top : r.bottom, left, width: Math.max(8, box.right - left), valid }
    }
    const update = () => {
      if (!active) return
      target = compute(last.x, last.y)
      setDrop(target)
    }
    const tick = () => {
      if (!active) return
      const vpTop = scroller ? scroller.getBoundingClientRect().top : 0
      const vpBottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight
      let dy = 0
      if (last.y < vpTop + 56) dy = -Math.ceil((vpTop + 56 - last.y) / 4)
      else if (last.y > vpBottom - 56) dy = Math.ceil((last.y - (vpBottom - 56)) / 4)
      if (dy) {
        if (scroller) scroller.scrollTop += dy
        else window.scrollBy(0, dy)
        update()
      }
      raf = requestAnimationFrame(tick)
    }
    const onMove = (ev: MouseEvent) => {
      last = { x: ev.clientX, y: ev.clientY }
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
        active = true
        draggingRef.current = true
        setDragging(true)
        document.body.classList.add('gn-dragging')
        raf = requestAnimationFrame(tick)
      }
      update()
    }
    const finish = (commit: boolean) => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      document.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(raf)
      document.body.classList.remove('gn-dragging')
      if (active) {
        draggingRef.current = false
        setDragging(false)
        setDrop(null)
        if (commit && target?.valid) {
          const tr = moveBlockToTr(view.state, srcPos, target.dstPos, target.where)
          if (tr) {
            ctx.hover.pos = null
            view.dispatch(tr)
            view.focus()
          }
        }
      } else if (commit) {
        // A click: open the block menu (or close it again).
        ctx.ui.set({ blockMenu: ctx.ui.getSnapshot().blockMenu ? null : { pos: srcPos, anchor: grip } })
      }
    }
    const onUp = (ev: MouseEvent) => {
      ev.preventDefault()
      finish(true)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        finish(false)
      }
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
    document.addEventListener('keydown', onKey, true)
  }

  const addBelow = () => {
    if (hoverPos === null) return
    const tr = addParagraphBelowTr(view.state, hoverPos)
    if (!tr) return
    view.dispatch(tr)
    view.focus()
    insertSlashAtSelection(view)
  }

  const indicator = drop && dragging && (
    <div
      className={drop.valid ? 'gn-drop-indicator' : 'gn-drop-indicator is-invalid'}
      style={{ top: drop.top - 1, left: drop.left, width: drop.width }}
    />
  )

  let handle = null
  if (dom instanceof HTMLElement && node && !mobile && view.editable) {
    const rootBox = root.getBoundingClientRect()
    const r = dom.getBoundingClientRect()
    let blockLeft = r.left
    if (node.type === N.list_item && dom.parentElement) blockLeft = dom.parentElement.getBoundingClientRect().left
    const textEl = firstTextElement(dom)
    const lh = parseFloat(getComputedStyle(textEl).lineHeight)
    const lineH = Number.isFinite(lh) ? lh : 24
    const isText = node.type !== N.table && node.type !== N.image && node.type !== N.horizontal_rule && node.type !== N.code_block && node.type !== N.raw
    const pt = parseFloat(getComputedStyle(textEl).paddingTop) || 0
    const top = (isText ? textEl.getBoundingClientRect().top + pt + (lineH - ICON) / 2 : r.top + 2) - rootBox.top
    const left = blockLeft - rootBox.left - HANDLE_W - GAP
    handle = (
      <div className={dragging ? 'gn-handle is-dragging' : 'gn-handle'} style={{ left, top }}>
        <button
          type="button"
          className="gn-handle-btn"
          aria-label={t.editor.addBelow}
          title={t.editor.addBelow}
          onMouseDown={(e) => e.preventDefault()}
          onClick={addBelow}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="gn-handle-btn gn-handle-grip"
          aria-label={t.editor.blockMenu}
          title={t.editor.dragHandle}
          aria-haspopup="menu"
          onMouseDown={startDrag}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              ctx.ui.set({ blockMenu: { pos: hoverPos!, anchor: e.currentTarget } })
            }
          }}
        >
          <GripVertical size={16} />
        </button>
      </div>
    )
  }
  return (
    <>
      <div className="gn-gutter" aria-hidden="true" />
      {handle}
      {indicator}
    </>
  )
}

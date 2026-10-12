import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import { ExternalLink, FileText, Link as LinkIcon, Unlink } from 'lucide-react'
import { schema } from '../../lib/schema'
import { t } from '../../strings/zh-TW'
import { Popover, cx } from '../../ui/primitives'
import { insertBlocksTr } from '../blocks'
import { caretRect } from '../insert'
import { normalizeLinkInput, openLink } from '../links'
import type { PageRef } from '../types'
import { linkAtSelection } from './actions'
import { useEditorUI, useUIState } from './shared'

const N = schema.nodes

function selectionRect(view: EditorView): DOMRect | null {
  try {
    const sel = view.state.selection
    const a = view.coordsAtPos(sel.from)
    const b = view.coordsAtPos(sel.to)
    const left = Math.min(a.left, b.left)
    const right = Math.max(a.right, b.right)
    const top = Math.min(a.top, b.top)
    const bottom = Math.max(a.bottom, b.bottom)
    return new DOMRect(left, top, Math.max(1, right - left), bottom - top)
  } catch {
    return null
  }
}

/**
 * Link editor (UI-8): paste a URL or search pages. `mark` mode links the selected text; `block`
 * mode (the `/link` item) inserts a page link block or a linked URL.
 */
export function LinkPopover() {
  const { view, ctx } = useEditorUI()
  const ui = useUIState(ctx)
  const link = ui.link
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const existing = useMemo(() => (link?.mode === 'mark' ? linkAtSelection(view.state) : null), [link, view])
  const [value, setValue] = useState('')
  const [results, setResults] = useState<PageRef[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!link) return
    setAnchor(link.anchor ?? (link.mode === 'mark' ? selectionRect(view) : caretRect(view)))
    setValue(existing?.href ?? '')
    setActive(0)
  }, [link, view, existing])

  useEffect(() => {
    if (!link) return
    let cancelled = false
    const q = value.trim()
    const timer = window.setTimeout(
      () => {
        if (/^(https?:|mailto:)/i.test(q) || q.startsWith('/')) {
          setResults([])
          return
        }
        ctx
          .services()
          .searchPages(q)
          .then((r) => {
            if (!cancelled) setResults(r.slice(0, 8))
          })
          .catch(() => {
            if (!cancelled) setResults([])
          })
      },
      q ? 120 : 0,
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [link, value, ctx])

  const shown = !!link && !!anchor
  useEffect(() => {
    if (!shown) return
    // The popover becomes visible one frame after mounting; focus then.
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [shown])

  if (!link || !anchor) return null

  const close = () => {
    ctx.ui.set({ link: null, toolbarMenu: null })
    view.focus()
  }
  const url = normalizeLinkInput(value)
  // Rows: pages first, then the typed URL.
  type Row = { key: string; label: string; sub?: string; icon: React.ReactNode; run: () => void }
  const applyHref = (href: string, text?: string) => {
    if (link.mode === 'mark') {
      const { from, to } = view.state.selection
      const mark = schema.marks.link.create({ href })
      const tr = view.state.tr.removeMark(from, to, schema.marks.link).addMark(from, to, mark)
      view.dispatch(tr)
    } else {
      const node = text
        ? N.page_link.create({ href, title: text })
        : N.paragraph.create(null, schema.text(href, [schema.marks.link.create({ href })]))
      view.dispatch(insertBlocksTr(view.state, [node]))
    }
    close()
  }
  const rows: Row[] = results.map((p) => ({
    key: p.href,
    label: p.title || t.common.untitled,
    sub: p.parentTitle ?? undefined,
    icon: p.icon ? <span className="gn-link-emoji">{p.icon}</span> : <FileText size={16} />,
    run: () => applyHref(p.href, p.title || t.common.untitled),
  }))
  // A page link block needs a page; a mark can point at one with just the href.
  if (link.mode === 'mark') {
    rows.forEach((r, i) => {
      r.run = () => applyHref(results[i].href)
    })
  }
  if (url && !url.startsWith('/')) {
    rows.push({ key: 'url', label: value.trim(), icon: <LinkIcon size={16} />, run: () => applyHref(url) })
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault()
      setActive((active + 1) % rows.length)
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault()
      setActive((active - 1 + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // A typed URL wins over a highlighted page when the field holds one.
      if (url && !results.length) applyHref(url)
      else if (rows[active]) rows[active].run()
      else if (url) applyHref(url)
    }
  }

  return (
    <Popover anchor={anchor} onClose={close} className="gn-link-popover">
      <div className="gn-link-field">
        <LinkIcon size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          className="gn-link-input"
          value={value}
          placeholder={t.editor.linkPlaceholder}
          aria-label={t.editor.link}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {rows.length > 0 && (
        <div className="gn-link-results" role="listbox">
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              role="option"
              aria-selected={i === active}
              className={cx('menu-row', i === active && 'is-highlighted')}
              onMouseMove={() => setActive(i)}
              onClick={r.run}
            >
              <span className="menu-icon">{r.icon}</span>
              <span className="menu-label">{r.label}</span>
              {r.sub && <span className="menu-hint">{r.sub}</span>}
            </button>
          ))}
        </div>
      )}
      {existing && (
        <div className="gn-link-actions">
          <button
            type="button"
            className="menu-row"
            onClick={() => {
              openLink(ctx, existing.href)
            }}
          >
            <span className="menu-icon">
              <ExternalLink size={16} />
            </span>
            <span className="menu-label">{t.editor.openLink}</span>
          </button>
          <button
            type="button"
            className="menu-row"
            onClick={() => {
              const { from, to } = view.state.selection
              view.dispatch(view.state.tr.removeMark(from, to, schema.marks.link))
              close()
            }}
          >
            <span className="menu-icon">
              <Unlink size={16} />
            </span>
            <span className="menu-label">{t.editor.removeLink}</span>
          </button>
        </div>
      )}
    </Popover>
  )
}

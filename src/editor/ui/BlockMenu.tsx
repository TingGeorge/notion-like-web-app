import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, FileText, FolderInput, Palette, Repeat2, Search, Trash2 } from 'lucide-react'
import { schema } from '../../lib/schema'
import { t } from '../../strings/zh-TW'
import { serializeMarkdown } from '../../lib/markdown'
import { Popover, cx } from '../../ui/primitives'
import {
  applyColorRange,
  blockRefAt,
  blockTextRange,
  canTurnInto,
  commonColor,
  deleteBlockTr,
  duplicateBlockTr,
  turnIntoTr,
  type BlockRef,
} from '../blocks'
import type { PageRef } from '../types'
import { EditorMenu, type MenuEntry } from './EditorMenu'
import { colorEntries, turnIntoEntries } from './menus'
import { useEditorUI, useUIState } from './shared'

type Panel = 'root' | 'turn' | 'color' | 'move'

/** UI-3: the block menu opened from `⋮⋮`. */
export function BlockMenu() {
  const { view, ctx } = useEditorUI()
  const ui = useUIState(ctx)
  const menu = ui.blockMenu
  const [panel, setPanel] = useState<Panel>('root')
  useEffect(() => {
    setPanel('root')
  }, [menu])
  if (!menu) return null
  const ref = blockRefAt(view.state.doc, menu.pos)
  if (!ref) return null

  const close = () => {
    ctx.ui.set({ blockMenu: null })
    view.focus()
  }

  const range = blockTextRange(ref)
  let entries: MenuEntry[]
  if (panel === 'root') {
    entries = [
      {
        key: 'delete',
        label: t.editor.deleteBlock,
        icon: <Trash2 size={16} />,
        danger: true,
        onSelect: () => {
          ctx.hover.pos = null
          view.dispatch(deleteBlockTr(view.state.tr, ref.pos).scrollIntoView())
          close()
        },
      },
      {
        key: 'duplicate',
        label: t.editor.duplicate,
        icon: <Copy size={16} />,
        onSelect: () => {
          view.dispatch(duplicateBlockTr(view.state, ref))
          close()
        },
      },
      {
        key: 'turn',
        label: t.editor.turnInto,
        icon: <Repeat2 size={16} />,
        submenu: true,
        disabled: ref.kind === null,
        onSelect: () => setPanel('turn'),
      },
      {
        key: 'color',
        label: t.editor.color,
        icon: <Palette size={16} />,
        submenu: true,
        disabled: !range,
        onSelect: () => setPanel('color'),
      },
      {
        key: 'move',
        label: t.editor.moveToPage,
        icon: <FolderInput size={16} />,
        submenu: true,
        onSelect: () => setPanel('move'),
      },
    ]
  } else if (panel === 'turn') {
    entries = [
      { key: 'back', label: t.editor.turnInto, icon: <ArrowLeft size={16} />, onSelect: () => setPanel('root') },
      { type: 'separator' },
      ...turnIntoEntries(
        ref.kind,
        (k) => canTurnInto(view.state, ref, k),
        (k) => {
          const tr = turnIntoTr(view.state, ref, k)
          if (tr) view.dispatch(tr)
          close()
        },
      ),
    ]
  } else {
    const current = range
      ? { color: commonColor(view.state.doc, range[0], range[1], 'color'), bg: commonColor(view.state.doc, range[0], range[1], 'bg') }
      : { color: null, bg: null }
    entries = [
      { key: 'back', label: t.editor.color, icon: <ArrowLeft size={16} />, onSelect: () => setPanel('root') },
      { type: 'separator' },
      ...colorEntries(current, (spec) => {
        if (range) {
          const tr = view.state.tr
          applyColorRange(tr, range[0], range[1], spec)
          view.dispatch(tr)
          if (!spec.endsWith(':default')) ctx.services().setLastColor(spec)
        }
        close()
      }),
    ]
  }

  return (
    <Popover anchor={menu.anchor} onClose={close} placement="right-start" offset={4} className="gn-block-popover">
      {panel === 'move' ? (
        <MovePanel block={ref} onBack={() => setPanel('root')} onDone={close} />
      ) : (
        <EditorMenu key={panel} label={t.editor.blockMenu} entries={entries} onClose={close} />
      )}
    </Popover>
  )
}

/** 移到頁面…: pick a page, append the block's Markdown there, then remove it here. */
function MovePanel({ block, onBack, onDone }: { block: BlockRef; onBack: () => void; onDone: () => void }) {
  const { view, ctx } = useEditorUI()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PageRef[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(
      () => {
        ctx
          .services()
          .searchPages(query.trim())
          .then((r) => !cancelled && setResults(r.slice(0, 10)))
          .catch(() => !cancelled && setResults([]))
      },
      query ? 120 : 0,
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, ctx])

  const move = async (page: PageRef) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const node = view.state.doc.nodeAt(block.pos)
      if (!node) throw new Error('gone')
      let wrapped = node
      if (node.type === schema.nodes.list_item) {
        const list = view.state.doc.resolve(block.pos).parent
        wrapped = list.type.create(list.type === schema.nodes.ordered_list ? { start: 1 } : null, node)
      }
      const markdown = serializeMarkdown(schema.topNodeType.create(null, [wrapped]))
      await ctx.services().moveBlocksToPage(markdown, page.href)
      const tr = deleteBlockTr(view.state.tr, block.pos)
      ctx.hover.pos = null
      view.dispatch(tr)
      onDone()
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error && e.message && e.message !== 'gone' && !e.message.startsWith('markdown:') ? e.message : t.editor.moveFailed)
    }
  }

  return (
    <div className="gn-move-panel">
      <button type="button" className="menu-row gn-move-back" onClick={onBack}>
        <span className="menu-icon">
          <ArrowLeft size={16} />
        </span>
        <span className="menu-label">{t.editor.moveToPage}</span>
      </button>
      <div className="gn-link-field">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          className="gn-link-input"
          value={query}
          placeholder={t.editor.searchPages}
          aria-label={t.editor.searchPages}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && results[0]) {
              e.preventDefault()
              void move(results[0])
            }
          }}
        />
      </div>
      <div className="gn-link-results" role="listbox">
        {results.length === 0 && <div className="gn-slash-empty">{t.editor.noPages}</div>}
        {results.map((p) => (
          <button key={p.href} type="button" role="option" aria-selected="false" className={cx('menu-row')} disabled={busy} onClick={() => void move(p)}>
            <span className="menu-icon">{p.icon ? <span className="gn-link-emoji">{p.icon}</span> : <FileText size={16} />}</span>
            <span className="menu-label">{p.title || t.common.untitled}</span>
            {p.parentTitle && <span className="menu-hint">{p.parentTitle}</span>}
          </button>
        ))}
      </div>
      {error && (
        <div className="gn-move-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

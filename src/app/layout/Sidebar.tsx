/** Desktop sidebar (UI-1, D02): workspace header, nav, favourites, page tree, trash, new page. */
import { ChevronDown, ChevronsLeft, Home, Plus, Search, Settings2, SquarePen, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Workspace } from '../../lib/types'
import { t } from '../../strings/zh-TW'
import { cx, IconButton, Menu, Popover } from '../../ui/primitives'
import { newPage } from '../actions'
import { usePages, useSettings, useUi } from '../hooks'
import { openOverlay } from '../overlays'
import { navigate, useRoute } from '../router'
import { buildTree } from '../../lib/data/tree'
import { PageTree } from './PageTree'
import './sidebar.css'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 480

export function workspaceTitle(ws: Workspace): string {
  return t.app.workspaceName(ws.name?.split(/\s+/)[0] || ws.login)
}

export function Avatar({ ws, size = 22 }: { ws: Workspace; size?: number }) {
  const letter = (ws.name || ws.login || '?').trim().charAt(0).toUpperCase()
  return (
    <span className="ws-avatar" style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden="true">
      {letter}
    </span>
  )
}

export function Sidebar({ workspace, onCollapse }: { workspace: Workspace; onCollapse: () => void }) {
  const route = useRoute()
  const pages = usePages() ?? []
  const settings = useSettings()
  const [ui, setUi] = useUi()
  const [width, setWidth] = useState(ui.sidebarWidth)
  const [wsMenu, setWsMenu] = useState<HTMLElement | null>(null)
  const [favOpen, setFavOpen] = useState<Set<string>>(new Set())
  const resizing = useRef(false)

  useEffect(() => setWidth(ui.sidebarWidth), [ui.sidebarWidth])

  const currentKey = route.name === 'page' ? route.key : null
  const tree = useMemo(() => buildTree(pages, settings), [pages, settings])
  const current = currentKey ? (tree.get(currentKey) ?? pages.find((p) => `path:${p.path}` === currentKey)) : undefined
  const favorites = tree.favorites

  const expanded = useMemo(() => new Set(ui.expanded), [ui.expanded])
  // Show the open page: expand its ancestors.
  useEffect(() => {
    if (!current) return
    const missing = tree.ancestors(current.key).filter((a) => !expanded.has(a.key))
    if (missing.length) setUi({ expanded: [...ui.expanded, ...missing.map((a) => a.key)] })
  }, [current, tree, expanded, setUi, ui.expanded])

  const toggle = (key: string) => {
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setUi({ expanded: [...next] })
  }

  const startResize = (e: React.PointerEvent) => {
    resizing.current = true
    const startX = e.clientX
    const startWidth = width
    const move = (ev: PointerEvent) => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX))
      setWidth(w)
    }
    const up = (ev: PointerEvent) => {
      resizing.current = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX))
      setUi({ sidebarWidth: w })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <aside className="sidebar" style={{ width }} data-print="hide" aria-label={t.nav.pages}>
      <div className="sb-header">
        <button type="button" className="sb-workspace" onClick={(e) => setWsMenu(e.currentTarget)}>
          <Avatar ws={workspace} />
          <span className="sb-workspace-name">{workspaceTitle(workspace)}</span>
          <ChevronDown size={14} className="sb-workspace-chevron" />
        </button>
        <span className="sb-header-actions">
          <IconButton label={t.nav.collapseSidebar} onClick={onCollapse} size={28}>
            <ChevronsLeft size={18} />
          </IconButton>
          <IconButton label={t.nav.newPage} onClick={() => void newPage()} size={28}>
            <SquarePen size={17} />
          </IconButton>
        </span>
      </div>
      {wsMenu && (
        <Popover anchor={wsMenu} onClose={() => setWsMenu(null)}>
          <div className="sb-ws-info">
            <div className="sb-ws-repo">
              {workspace.owner}/{workspace.repo}
            </div>
            <div className="sb-ws-login">{workspace.login}</div>
          </div>
          <Menu
            onClose={() => setWsMenu(null)}
            items={[
              { key: 'settings', label: t.nav.settings, icon: <Settings2 size={17} />, onSelect: () => openOverlay({ kind: 'settings' }) },
              { key: 'link', label: t.link.title, icon: <SquarePen size={17} />, onSelect: () => openOverlay({ kind: 'link-device' }) },
            ]}
          />
        </Popover>
      )}

      <nav className="sb-nav">
        <button type="button" className="sb-nav-row" onClick={() => openOverlay({ kind: 'search' })}>
          <Search size={18} />
          <span>{t.nav.search}</span>
        </button>
        <button type="button" className={cx('sb-nav-row', route.name === 'home' && 'is-selected')} onClick={() => navigate({ name: 'home' })}>
          <Home size={18} />
          <span>{t.nav.home}</span>
        </button>
        <button type="button" className="sb-nav-row" onClick={() => openOverlay({ kind: 'settings' })}>
          <Settings2 size={18} />
          <span>{t.nav.settings}</span>
        </button>
      </nav>

      <div className="sb-scroll">
        {favorites.length > 0 && (
          <section className="sb-section">
            <h2 className="sb-section-title">{t.nav.favorites}</h2>
            <PageTree
              tree={tree}
              roots={favorites}
              currentKey={null}
              expanded={favOpen}
              onToggle={(k) =>
                setFavOpen((s) => {
                  const n = new Set(s)
                  if (n.has(k)) n.delete(k)
                  else n.add(k)
                  return n
                })
              }
              draggable={false}
              idPrefix="fav"
            />
          </section>
        )}
        <section className="sb-section">
          <h2 className="sb-section-title">{t.nav.pages}</h2>
          {tree.roots.length > 0 ? (
            <PageTree tree={tree} roots={tree.roots} currentKey={current?.key ?? null} expanded={expanded} onToggle={toggle} />
          ) : (
            <div className="tree-empty" style={{ paddingLeft: 10 }}>
              {t.nav.noPages}
            </div>
          )}
        </section>
      </div>

      <div className="sb-footer">
        <button
          type="button"
          className="sb-nav-row"
          onClick={(e) => openOverlay({ kind: 'trash', anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
        >
          <Trash2 size={18} />
          <span>{t.nav.trash}</span>
        </button>
        <button type="button" className="sb-nav-row" onClick={() => void newPage()}>
          <Plus size={18} />
          <span>{t.nav.newPage}</span>
        </button>
      </div>
      <div className="sb-resizer" onPointerDown={startResize} role="separator" aria-orientation="vertical" />
    </aside>
  )
}

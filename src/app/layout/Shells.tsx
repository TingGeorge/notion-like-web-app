/** The two layouts: desktop (sidebar + main, D02) and iPhone (tab bar + stacked screens, M02–M05). */
import { ChevronLeft, FileText, Home, MoreHorizontal, Search, SquarePen, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildTree } from '../../lib/data/tree'
import type { PageRow, Workspace } from '../../lib/types'
import { t } from '../../strings/zh-TW'
import { cx, IconButton } from '../../ui/primitives'
import { newPage } from '../actions'
import { useFile, usePage, usePages, useSettings, useUi } from '../hooks'
import { HomeScreen } from '../home/HomeScreen'
import { openOverlay, useOverlay } from '../overlays'
import { PageIcon } from '../PageIcon'
import { PageNotFound, PageView } from '../page/PageView'
import { isFollow, navigate, useRoute } from '../router'
import { useGlobalShortcuts } from '../shortcuts'
import { Banners } from './Banners'
import { PageTree } from './PageTree'
import { Sidebar } from './Sidebar'
import { SyncStatusButton } from './SyncStatus'
import { Topbar } from './Topbar'
import './shell.css'

/**
 * Resolves a page key. Keeps the same mounted view when the key only changed because the page
 * received an id (`followKey`), so the editor keeps its caret.
 */
function usePageRoute(routeKey: string): { page: PageRow | null | undefined; mountId: number } {
  const page = usePage(routeKey)
  const mount = useRef({ key: routeKey, id: 0 })
  const last = useRef<PageRow | null>(null)
  if (mount.current.key !== routeKey) {
    if (isFollow(mount.current.key, routeKey)) {
      mount.current = { key: routeKey, id: mount.current.id }
    } else {
      mount.current = { key: routeKey, id: mount.current.id + 1 }
      last.current = null
    }
  }
  if (page) last.current = page
  return { page: page === undefined ? (last.current ?? undefined) : page, mountId: mount.current.id }
}

function DesktopPage({ routeKey, collapsed, expandSidebar }: { routeKey: string; collapsed: boolean; expandSidebar: () => void }) {
  const { page, mountId } = usePageRoute(routeKey)
  const file = useFile(page && !page.virtual ? page.path : null)
  return (
    <>
      <Topbar page={page ?? null} sidebarCollapsed={collapsed} onExpandSidebar={expandSidebar} editedAt={file?.updatedAt} isNew={!!file && file.baseSha === null && Date.now() - file.updatedAt < 60_000} />
      <div className="main-scroll">{page === null ? <PageNotFound /> : page ? <PageView key={mountId} page={page} /> : null}</div>
    </>
  )
}

export function DesktopShell({ workspace }: { workspace: Workspace }) {
  const route = useRoute()
  const [ui, setUi] = useUi()
  const collapsed = ui.sidebarCollapsed
  const toggleSidebar = useCallback(() => setUi({ sidebarCollapsed: !collapsed }), [collapsed, setUi])
  useGlobalShortcuts(true, toggleSidebar)

  // Routes that are dialogs on desktop.
  useEffect(() => {
    if (route.name === 'search') openOverlay({ kind: 'search', query: route.q })
    else if (route.name === 'settings') openOverlay({ kind: 'settings', section: route.section ?? undefined })
    else if (route.name === 'trash') openOverlay({ kind: 'trash' })
    else if (route.name === 'link') openOverlay({ kind: 'link-device' })
    else return
    navigate({ name: 'home' }, { replace: true })
  }, [route])

  return (
    <div className="desktop">
      {!collapsed && <Sidebar workspace={workspace} onCollapse={toggleSidebar} />}
      <main className="main">
        <Banners workspace={workspace} />
        {route.name === 'page' ? (
          <DesktopPage routeKey={route.key} collapsed={collapsed} expandSidebar={toggleSidebar} />
        ) : (
          <>
            <Topbar page={null} sidebarCollapsed={collapsed} onExpandSidebar={toggleSidebar} />
            <div className="main-scroll">
              <HomeScreen workspace={workspace} mobile={false} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// --- iPhone ----------------------------------------------------------------------------------

function TabBar({ active }: { active: 'home' | 'search' | 'pages' }) {
  const tabs = [
    { id: 'home', label: t.nav.home, icon: <Home size={24} strokeWidth={active === 'home' ? 2.1 : 1.7} />, run: () => navigate({ name: 'home' }) },
    { id: 'search', label: t.nav.search, icon: <Search size={24} strokeWidth={active === 'search' ? 2.1 : 1.7} />, run: () => openOverlay({ kind: 'search' }) },
    { id: 'pages', label: t.nav.allPages, icon: <FileText size={24} strokeWidth={active === 'pages' ? 2.1 : 1.7} />, run: () => navigate({ name: 'pages' }) },
    { id: 'new', label: t.nav.add, icon: <SquarePen size={24} strokeWidth={1.7} />, run: () => void newPage() },
  ]
  return (
    <nav className="tabbar" data-print="hide">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" className={cx('tab', active === tab.id && 'is-active')} onClick={tab.run} aria-current={active === tab.id ? 'page' : undefined}>
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}

function AllPagesScreen() {
  const pages = usePages()
  const settings = useSettings()
  const [ui, setUi] = useUi()
  const tree = useMemo(() => buildTree(pages, settings), [pages, settings])
  const expanded = useMemo(() => new Set(ui.expanded), [ui.expanded])
  const toggle = (key: string) => {
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setUi({ expanded: [...next] })
  }
  return (
    <div className="all-pages">
      <header className="m-large-header">
        <h1>{t.nav.allPages}</h1>
        <span className="all-pages-actions">
          <IconButton label={t.nav.search} size={36} onClick={() => openOverlay({ kind: 'search' })}>
            <Search size={22} />
          </IconButton>
          <IconButton label={t.nav.newPage} size={36} onClick={() => void newPage()}>
            <SquarePen size={22} />
          </IconButton>
        </span>
      </header>
      {tree.favorites.length > 0 && (
        <section>
          <h2 className="all-pages-section">{t.nav.favorites}</h2>
          <PageTree tree={tree} roots={tree.favorites} currentKey={null} expanded={new Set()} onToggle={() => undefined} variant="mobile" draggable={false} idPrefix="m-fav" />
        </section>
      )}
      <section>
        <h2 className="all-pages-section">{t.nav.pages}</h2>
        <PageTree tree={tree} roots={tree.roots} currentKey={null} expanded={expanded} onToggle={toggle} variant="mobile" draggable={false} idPrefix="m-tree" />
      </section>
      <button type="button" className="all-pages-trash" onClick={() => openOverlay({ kind: 'trash' })}>
        <Trash2 size={20} />
        {t.nav.trash}
      </button>
    </div>
  )
}

function MobilePage({ routeKey }: { routeKey: string }) {
  const { page, mountId } = usePageRoute(routeKey)
  const pages = usePages()
  const parent = page?.parentKey ? pages.find((p) => p.key === page.parentKey) : undefined
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onIn = (e: FocusEvent) => setEditing(!!(e.target as HTMLElement).closest('.ProseMirror, .page-title-input'))
    const onOut = () => setTimeout(() => setEditing(!!document.activeElement?.closest('.ProseMirror, .page-title-input')), 0)
    el.addEventListener('focusin', onIn)
    el.addEventListener('focusout', onOut)
    return () => {
      el.removeEventListener('focusin', onIn)
      el.removeEventListener('focusout', onOut)
    }
  }, [])
  return (
    <div className="m-page" ref={ref}>
      <header className="m-page-nav" data-print="hide">
        <button
          type="button"
          className="m-page-back"
          aria-label={t.nav.back}
          onClick={() => (history.length > 1 ? history.back() : navigate(parent ? { name: 'page', key: parent.key } : { name: 'home' }))}
        >
          <ChevronLeft size={24} />
          {parent && (
            <span className="m-page-parent">
              <PageIcon icon={parent.icon} size={16} />
              {parent.title}
            </span>
          )}
        </button>
        <span className="m-page-actions">
          <SyncStatusButton compact />
          {editing ? (
            <button type="button" className="m-done" onMouseDown={(e) => e.preventDefault()} onClick={() => (document.activeElement as HTMLElement | null)?.blur()}>
              {t.common.done}
            </button>
          ) : (
            page && (
              <IconButton label={t.nav.pageMenu} size={36} onClick={() => openOverlay({ kind: 'page-menu', pageKey: page.key })}>
                <MoreHorizontal size={22} />
              </IconButton>
            )
          )}
        </span>
      </header>
      {page === null ? <PageNotFound /> : page ? <PageView key={mountId} page={page} /> : null}
    </div>
  )
}

export function MobileShell({ workspace }: { workspace: Workspace }) {
  const route = useRoute()
  const overlay = useOverlay()
  useGlobalShortcuts(true, () => undefined)

  useEffect(() => {
    if (route.name === 'search') openOverlay({ kind: 'search', query: route.q })
    else if (route.name === 'settings') openOverlay({ kind: 'settings', section: route.section ?? undefined })
    else if (route.name === 'trash') openOverlay({ kind: 'trash' })
    else if (route.name === 'link') openOverlay({ kind: 'link-device' })
    else return
    navigate({ name: 'home' }, { replace: true })
  }, [route])

  const showTabs = route.name !== 'page'
  const active = overlay?.kind === 'search' ? 'search' : route.name === 'pages' ? 'pages' : 'home'
  return (
    <div className={cx('mobile', showTabs && 'has-tabs')}>
      <Banners workspace={workspace} />
      {route.name === 'page' ? <MobilePage routeKey={route.key} /> : route.name === 'pages' ? <AllPagesScreen /> : <HomeScreen workspace={workspace} mobile />}
      {(showTabs || overlay?.kind === 'search') && <TabBar active={active} />}
    </div>
  )
}

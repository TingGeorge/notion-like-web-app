/** 首頁 (UI-11, M02): greeting, 最近造訪, 我的最愛, top-level 頁面. */
import { ChevronDown, ChevronRight, SquarePen } from 'lucide-react'
import { useMemo } from 'react'
import { buildTree } from '../../lib/data/tree'
import type { PageRow, Workspace } from '../../lib/types'
import { t } from '../../strings/zh-TW'
import { cx, IconButton } from '../../ui/primitives'
import { newPage } from '../actions'
import { greetingWord, relativeTime } from '../format'
import { useNow, usePages, useSettings, useUi } from '../hooks'
import { Avatar, workspaceTitle } from '../layout/Sidebar'
import { SyncStatusButton } from '../layout/SyncStatus'
import { openOverlay } from '../overlays'
import { PageIcon } from '../PageIcon'
import { navigate, pageHash } from '../router'
import './home.css'

const CARD_TINTS = ['var(--palette-bg-blue)', 'var(--palette-bg-pink)', 'var(--palette-bg-yellow)', 'var(--palette-bg-green)', 'var(--palette-bg-purple)', 'var(--palette-bg-orange)']

function ListGroup({ pages }: { pages: PageRow[] }) {
  return (
    <ul className="home-list">
      {pages.map((p) => (
        <li key={p.key}>
          <a
            className="home-row"
            href={pageHash(p.key)}
            onClick={(e) => {
              e.preventDefault()
              navigate({ name: 'page', key: p.key })
            }}
          >
            <PageIcon icon={p.icon} size={22} />
            <span className="home-row-title">{p.title}</span>
            <ChevronRight size={18} className="home-row-chevron" />
          </a>
        </li>
      ))}
    </ul>
  )
}

export function HomeScreen({ workspace, mobile }: { workspace: Workspace; mobile: boolean }) {
  const pages = usePages()
  const settings = useSettings()
  const [ui] = useUi()
  const now = useNow(60_000)
  const tree = useMemo(() => buildTree(pages, settings), [pages, settings])
  const recent = ui.recent.map((k) => tree.get(k)).filter((p): p is PageRow => !!p)
  const name = workspace.name?.split(/\s+/)[0] || workspace.login

  return (
    <div className={cx('home', mobile && 'is-mobile')}>
      {mobile && (
        <header className="home-header">
          <button type="button" className="home-ws" onClick={() => openOverlay({ kind: 'settings' })}>
            <Avatar ws={workspace} size={24} />
            <span>{workspaceTitle(workspace)}</span>
            <ChevronDown size={16} />
          </button>
          <span className="home-header-actions">
            <SyncStatusButton compact />
            <IconButton label={t.nav.newPage} onClick={() => void newPage()} size={36}>
              <SquarePen size={22} />
            </IconButton>
          </span>
        </header>
      )}
      <h1 className="home-greeting">{t.home.greeting(greetingWord(new Date(now)), name)}</h1>

      {recent.length > 0 && (
        <section className="home-section">
          <h2 className="home-section-title">{t.home.recent}</h2>
          <div className="home-cards">
            {recent.map((p, i) => (
              <a
                key={p.key}
                className="home-card"
                href={pageHash(p.key)}
                onClick={(e) => {
                  e.preventDefault()
                  navigate({ name: 'page', key: p.key })
                }}
              >
                <span
                  className="home-card-band"
                  style={{ background: p.cover?.startsWith('gradient:') ? `var(--cover-${p.cover.slice(9)})` : CARD_TINTS[i % CARD_TINTS.length] }}
                />
                <PageIcon icon={p.icon} size={28} className="home-card-icon" />
                <span className="home-card-title">{p.title}</span>
                <span className="home-card-time">{relativeTime(p.updatedAt, now)}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {tree.favorites.length > 0 && (
        <section className="home-section">
          <h2 className="home-section-title">{t.nav.favorites}</h2>
          <ListGroup pages={tree.favorites} />
        </section>
      )}

      <section className="home-section">
        <h2 className="home-section-title">{t.nav.pages}</h2>
        {tree.roots.length > 0 ? <ListGroup pages={tree.roots} /> : <p className="home-empty">{t.nav.noPages}</p>}
      </section>
    </div>
  )
}

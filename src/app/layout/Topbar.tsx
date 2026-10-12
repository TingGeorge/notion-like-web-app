/** Desktop top bar (UI-4): breadcrumb, Sync/Status, 已編輯 N 分鐘前, history, favourite, page menu. */
import { ChevronsRight, History, Menu as MenuIcon, MoreHorizontal, Star } from 'lucide-react'
import { Fragment } from 'react'
import type { PageRow } from '../../lib/types'
import { t } from '../../strings/zh-TW'
import { IconButton } from '../../ui/primitives'
import { toggleFavorite } from '../actions'
import { relativeTime } from '../format'
import { useNow, usePages, useSettings } from '../hooks'
import { openOverlay } from '../overlays'
import { PageIcon } from '../PageIcon'
import { navigate } from '../router'
import { buildTree } from '../../lib/data/tree'
import { SyncStatusButton } from './SyncStatus'

export function Topbar({
  page,
  sidebarCollapsed,
  onExpandSidebar,
  editedAt,
  isNew,
}: {
  page: PageRow | null
  sidebarCollapsed: boolean
  onExpandSidebar: () => void
  editedAt?: number | null
  isNew?: boolean
}) {
  const pages = usePages()
  const settings = useSettings()
  const now = useNow()
  const tree = buildTree(pages, settings)
  const crumbs = page ? [...tree.ancestors(page.key), page] : []
  const isFavorite = page ? settings.favorites.includes(page.key) : false

  return (
    <header className="topbar" data-print="hide">
      <div className="topbar-left">
        {sidebarCollapsed && (
          <IconButton label={t.nav.expandSidebar} onClick={onExpandSidebar} className="topbar-expand">
            <MenuIcon size={18} className="topbar-expand-menu" />
            <ChevronsRight size={18} className="topbar-expand-chevrons" />
          </IconButton>
        )}
        <nav className="breadcrumb" aria-label="breadcrumb">
          {crumbs.map((p, i) => (
            <Fragment key={p.key}>
              {i > 0 && <span className="breadcrumb-sep">/</span>}
              <button
                type="button"
                className={`breadcrumb-item ${i === crumbs.length - 1 ? 'is-current' : ''}`}
                onClick={() => navigate({ name: 'page', key: p.key })}
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
              >
                <PageIcon icon={p.icon} size={16} />
                <span className="breadcrumb-title">{p.title || t.common.untitled}</span>
              </button>
            </Fragment>
          ))}
        </nav>
      </div>
      <div className="topbar-right">
        <SyncStatusButton />
        {page && (
          <span className="topbar-edited">
            {isNew ? t.page.createdJustNow : editedAt ? t.page.editedAgo(relativeTime(editedAt, now)) : ''}
          </span>
        )}
        {page && (
          <>
            <IconButton label={t.page.history} onClick={() => openOverlay({ kind: 'history', pageKey: page.key })} disabled={page.virtual}>
              <History size={18} />
            </IconButton>
            <IconButton
              label={isFavorite ? t.page.unfavorite : t.page.favorite}
              active={isFavorite}
              onClick={() => void toggleFavorite(page.key, !isFavorite)}
            >
              <Star size={18} fill={isFavorite ? 'currentColor' : 'none'} className={isFavorite ? 'is-favorite' : undefined} />
            </IconButton>
            <IconButton
              label={t.nav.pageMenu}
              onClick={(e) => openOverlay({ kind: 'page-menu', pageKey: page.key, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
            >
              <MoreHorizontal size={18} />
            </IconButton>
          </>
        )}
      </div>
    </header>
  )
}

/** 移動到… (M08): pick a new parent page, or the top level. */
import { ArrowUpToLine, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { childDirOf, isInside } from '../../lib/data/names'
import { t } from '../../strings/zh-TW'
import { Modal, Sheet } from '../../ui/primitives'
import { moveTo } from '../actions'
import { pagesCache, useIsMobile, usePage, usePages } from '../hooks'
import { closeOverlay } from '../overlays'
import { PageIcon } from '../PageIcon'
import './dialogs.css'

export function MoveDialog({ pageKey }: { pageKey: string }) {
  const page = usePage(pageKey)
  const pages = usePages()
  const mobile = useIsMobile()
  const [query, setQuery] = useState('')
  const candidates = useMemo(() => {
    if (!page) return []
    const q = query.trim().toLowerCase()
    return pages
      .filter((p) => p.key !== page.key && !isInside(p.path, childDirOf(page.path)) && p.key !== page.parentKey)
      .filter((p) => !q || p.title.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
  }, [pages, page, query])

  if (!page) return null
  const choose = (parentKey: string | null) => {
    closeOverlay()
    void moveTo(page.key, parentKey)
  }
  const content = (
    <div className="move">
      <div className="trash-search">
        <Search size={15} />
        <input autoFocus data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.page.moveSearch} aria-label={t.page.moveSearch} />
      </div>
      <div className="move-list">
        {page.parentKey && !query && (
          <button type="button" className="move-row" onClick={() => choose(null)}>
            <ArrowUpToLine size={18} />
            <span>{t.page.moveToRoot}</span>
          </button>
        )}
        {candidates.map((p) => {
          const parent = p.parentKey ? pagesCache.byKey.get(p.parentKey) : undefined
          return (
            <button key={p.key} type="button" className="move-row" onClick={() => choose(p.key)}>
              <PageIcon icon={p.icon} size={18} />
              <span className="move-title">{p.title}</span>
              {parent && <span className="move-parent">{parent.title}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
  if (mobile) {
    return (
      <Sheet open onClose={closeOverlay} title={t.page.moveDialogTitle}>
        {content}
      </Sheet>
    )
  }
  return (
    <Modal open onClose={closeOverlay} title={t.page.moveDialogTitle} width={420} top>
      {content}
    </Modal>
  )
}

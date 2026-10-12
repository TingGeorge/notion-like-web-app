/** 垃圾桶 (DATA-22, D07 / M19): search by title, 還原, 永久刪除 with confirmation. */
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { parseTrashIndex } from '../../lib/data/notesFiles'
import { db } from '../../lib/store/db'
import { TRASH_INDEX_PATH, type TrashEntry } from '../../lib/types'
import { t } from '../../strings/zh-TW'
import { Button, IconButton, Modal, Popover } from '../../ui/primitives'
import { purgeFromTrash, restoreFromTrash } from '../actions'
import { relativeTime } from '../format'
import { useIsMobile } from '../hooks'
import { closeOverlay } from '../overlays'
import { PageIcon } from '../PageIcon'
import './dialogs.css'

function useTrashEntries(): TrashEntry[] {
  const text = useLiveQuery(async () => {
    const row = await db().files.get(TRASH_INDEX_PATH)
    return row && !row.deleted ? row.text : null
  }, [])
  return parseTrashIndex(text ?? null)
    .value.entries.slice()
    .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
}

function TrashList({ mobile }: { mobile: boolean }) {
  const entries = useTrashEntries()
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<TrashEntry | null>(null)
  const q = query.trim().toLowerCase()
  const shown = q ? entries.filter((e) => e.title.toLowerCase().includes(q)) : entries
  return (
    <div className={`trash ${mobile ? 'is-mobile' : ''}`}>
      <div className="trash-search">
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.trash.search} aria-label={t.trash.search} autoFocus={!mobile} />
      </div>
      <div className="trash-section">{t.trash.deletedPages}</div>
      <ul className="trash-list">
        {shown.map((entry) => (
          <li key={entry.id} className="trash-row">
            <PageIcon icon={entry.icon ?? null} size={mobile ? 22 : 18} />
            <span className="trash-text">
              <span className="trash-title">{entry.title || t.common.untitled}</span>
              <span className="trash-sub">
                {entry.reason === 'replaced' ? `${t.trash.replaced} · ` : entry.parentTitle ? `${entry.parentTitle} · ` : ''}
                {t.trash.deletedAgo(relativeTime(Date.parse(entry.deletedAt)))}
              </span>
            </span>
            <IconButton label={t.common.restore} onClick={() => void restoreFromTrash(entry.id, entry.title).then(closeOverlay)}>
              <RotateCcw size={16} />
            </IconButton>
            <IconButton label={t.trash.purge} onClick={() => setConfirm(entry)}>
              <Trash2 size={16} />
            </IconButton>
          </li>
        ))}
        {shown.length === 0 && <li className="trash-empty">{t.trash.empty}</li>}
      </ul>
      <div className="trash-footer">{t.trash.footer}</div>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={t.trash.purge} width={360}>
        {confirm && (
          <div className="confirm">
            <p className="confirm-text">{t.trash.confirmPurge(confirm.title)}</p>
            <div className="confirm-actions">
              <Button onClick={() => setConfirm(null)}>{t.common.cancel}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  void purgeFromTrash(confirm.id)
                  setConfirm(null)
                }}
              >
                {t.trash.purge}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export function TrashPanel({ anchor }: { anchor?: DOMRect }) {
  const mobile = useIsMobile()
  if (mobile) {
    return (
      <div className="fullscreen-overlay" role="dialog" aria-modal="true" aria-label={t.trash.title}>
        <header className="mobile-nav">
          <button type="button" className="mobile-nav-back" onClick={closeOverlay}>
            <ChevronLeft size={22} />
            {t.nav.back}
          </button>
          <h1 className="mobile-nav-title">{t.trash.title}</h1>
          <span />
        </header>
        <TrashList mobile />
      </div>
    )
  }
  return (
    <Popover anchor={anchor ?? new DOMRect(16, window.innerHeight - 80, 200, 30)} onClose={closeOverlay} placement="right-start" className="trash-popover">
      <TrashList mobile={false} />
    </Popover>
  )
}

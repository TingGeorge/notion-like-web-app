/** Sync/Status (SYNC-11): 已同步 / 同步中… / 離線 · N 頁待同步 / 同步失敗 · 點此重試. */
import { AlertCircle, CloudOff, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SyncError } from '../../lib/types'
import { t } from '../../strings/zh-TW'
import { cx, Popover } from '../../ui/primitives'
import { syncNow } from '../actions'
import { useDirtyCount, useOnline, useSyncState } from '../hooks'
import { session } from '../session'
import { useSyncing } from '../syncActivity'

export type StatusView = { state: 'synced' } | { state: 'syncing' } | { state: 'offline'; pending: number } | { state: 'error'; error: SyncError }

export function useSyncStatus(): StatusView {
  const state = useSyncState()
  const pending = useDirtyCount()
  const online = useOnline()
  const syncing = useSyncing()
  if (syncing) return { state: 'syncing' }
  if (!online || state?.lastError?.kind === 'network') return { state: 'offline', pending }
  if (state?.lastError) return { state: 'error', error: state.lastError }
  return { state: 'synced' }
}

export function statusLabel(s: StatusView): string {
  switch (s.state) {
    case 'synced':
      return t.sync.synced
    case 'syncing':
      return t.sync.syncing
    case 'offline':
      return t.sync.offline(s.pending)
    case 'error':
      return t.sync.error
  }
}

/** Cloud with a check mark (Figma icon/cloud-check). */
export function CloudCheck({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <path d="m9.5 13.5 2 2 3.5-3.5" />
    </svg>
  )
}

export function SyncStatusButton({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const label = statusLabel(status)
  useEffect(() => {
    if (status.state !== 'error') setAnchor(null)
  }, [status.state])
  const icon =
    status.state === 'syncing' ? (
      <RefreshCw size={15} className="spin-slow" />
    ) : status.state === 'offline' ? (
      <CloudOff size={15} />
    ) : status.state === 'error' ? (
      <AlertCircle size={15} />
    ) : (
      <CloudCheck size={16} />
    )
  return (
    <>
      <button
        type="button"
        className={cx('sync-status', `is-${status.state}`, compact && 'is-compact')}
        onClick={(e) => {
          // SYNC-11: clicking runs 立即同步; the error state also shows the reason.
          if (status.state === 'error') setAnchor(e.currentTarget)
          void syncNow()
        }}
        aria-live="polite"
        title={t.sync.syncNow}
      >
        {icon}
        <span>{label}</span>
      </button>
      {anchor && status.state === 'error' && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-end">
          <div className="sync-error-pop">
            <strong>{t.sync.errors[status.error.kind] ?? t.sync.errors.unknown}</strong>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void session()?.engine.syncNow()}>
              {t.common.retry}
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}

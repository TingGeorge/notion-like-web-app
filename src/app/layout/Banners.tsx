/**
 * Banners above the page (SETUP-13, UI-14): read-only after a 401, token expiry warning,
 * Safari tab mode hint, new app version ready.
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isApplePlatform, isIOS, isSafariTab } from '../../lib/data/device'
import { db } from '../../lib/store/db'
import type { Workspace } from '../../lib/types'
import { t } from '../../strings'
import { daysUntil } from '../format'
import { useSyncState } from '../hooks'
import { openOverlay } from '../overlays'
import { applyUpdate, useUpdateReady } from '../pwa'
import { session } from '../session'
import './banners.css'

export function Banners({ workspace }: { workspace: Workspace }) {
  const sync = useSyncState()
  const update = useUpdateReady()
  const [hideSafari, setHideSafari] = useState(false)
  // 更換 token saves a new date (or 永不過期) without reloading, so read the stored workspace.
  const saved = useLiveQuery(() => db().config.get('workspace'), [])
  const expiresOn = saved?.key === 'workspace' ? saved.value.tokenExpiresOn : (session()?.workspace ?? workspace).tokenExpiresOn
  // SETUP-5: a token without an expiry date never gets the warning.
  const days = expiresOn ? daysUntil(expiresOn) : Infinity
  const unauthorized = sync?.lastError?.kind === 'unauthorized'
  const safariTab = isSafariTab()

  return (
    <div className="banners" data-print="hide">
      {update && (
        <div className="banner is-info" role="status">
          <span>{t.app.updateReady}</span>
          <button type="button" className="banner-action" onClick={() => void applyUpdate()}>
            {t.app.reload}
          </button>
        </div>
      )}
      {unauthorized ? (
        <div className="banner is-danger" role="alert">
          <span>{t.page.readOnlyBanner}</span>
          <button type="button" className="banner-action" onClick={() => openOverlay({ kind: 'settings', section: 'github' })}>
            {t.page.replaceToken}
          </button>
        </div>
      ) : (
        days <= 14 && (
          <div className="banner is-warning" role="status">
            <span>{t.page.tokenExpiresSoon(Math.max(0, days))}</span>
            <button type="button" className="banner-action" onClick={() => openOverlay({ kind: 'settings', section: 'github' })}>
              {t.page.replaceToken}
            </button>
          </div>
        )
      )}
      {safariTab && !hideSafari && (
        <div className="banner is-muted" role="note">
          <span>{isIOS() || !isApplePlatform() ? t.page.safariHint : t.page.safariHintMac}</span>
          <button type="button" className="banner-close" aria-label={t.common.close} onClick={() => setHideSafari(true)}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}

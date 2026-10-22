/** 設定 (UI-15, §6.6, D08 / M17). */
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronLeft, ChevronRight, Clock, Download, FileText, Keyboard, Link2, Lock, LogOut, RefreshCw, Sun, Trash2, Type } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { shortcutLabel } from '../../lib/data/device'
import { db } from '../../lib/store/db'
import type { ThemePref, Workspace } from '../../lib/types'
import { language, setLanguage, t, type Language } from '../../strings'
import { Button, cx, Modal, Sheet, Switch, TextInput } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { CloudCheck, statusLabel, useSyncStatus } from '../layout/SyncStatus'
import { Avatar } from '../layout/Sidebar'
import { syncNow } from '../actions'
import { displayDate, formatBytes, hhmm } from '../format'
import { useIsMobile, useSyncState, useUi } from '../hooks'
import { closeOverlay, openOverlay } from '../overlays'
import { navigate } from '../router'
import { session } from '../session'
import { isPastDate, toIsoDate } from '../setup/token'
import { changeRepo, clearDeviceData, disconnect, downloadBlob, exportZip, pendingChanges, replaceToken } from '../workspaceAdmin'
import './dialogs.css'

type Section = 'github' | 'appearance' | 'shortcuts' | 'sync' | 'export'

const NAV: { group: string; items: { id: Section; label: string; icon: ReactNode }[] }[] = [
  { group: t.settings.sections.connection, items: [{ id: 'github', label: t.settings.github, icon: <Link2 size={18} /> }] },
  {
    group: t.settings.sections.preferences,
    items: [
      { id: 'appearance', label: t.settings.appearance, icon: <Sun size={18} /> },
      { id: 'shortcuts', label: t.settings.shortcuts, icon: <Type size={18} /> },
    ],
  },
  {
    group: t.settings.sections.data,
    items: [
      { id: 'sync', label: t.settings.syncStorage, icon: <RefreshCw size={18} /> },
      { id: 'export', label: t.settings.export, icon: <Download size={18} /> },
    ],
  },
]

function maskToken(token: string): string {
  const prefix = token.startsWith('github_pat_') ? 'github_pat_' : token.slice(0, 4)
  return `${prefix}…${token.slice(-4)}`
}

function useOfflineSummary(): { pages: number; bytes: number } {
  return (
    useLiveQuery(async () => {
      const files = await db().files.toArray()
      const assets = await db().assets.toArray()
      const pages = files.filter((f) => f.kind === 'page' && !f.deleted).length
      const bytes = files.reduce((n, f) => n + (f.text?.length ?? 0) * 2, 0) + assets.reduce((n, a) => n + a.size, 0)
      return { pages, bytes }
    }, []) ?? { pages: 0, bytes: 0 }
  )
}

function Row({ title, sub, children, onClick }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; onClick?: () => void }) {
  return (
    <div className={cx('settings-row', onClick && 'is-button')} onClick={onClick}>
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {sub && <div className="settings-row-sub">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

/** SETUP-12: actions that need zero unsynced changes, or the user's confirmation to drop them. */
function useGuarded() {
  const [ask, setAsk] = useState<{ count: number; run: () => void; title: string } | null>(null)
  const guard = async (title: string, run: () => void) => {
    const count = await pendingChanges()
    if (count === 0) setAsk({ count: 0, run, title })
    else setAsk({ count, run, title })
  }
  const dialog = ask && (
    <Modal open onClose={() => setAsk(null)} title={ask.title} showTitle width={420}>
      <div className="confirm">
        <p className="confirm-text">
          {ask.count > 0
            ? t.settings.needsSyncFirst(ask.count)
            : ask.title === t.settings.disconnect
              ? t.settings.confirmDisconnect
              : ask.title === t.settings.clearDevice
                ? t.settings.confirmClear
                : ask.title}
        </p>
        <div className="confirm-actions">
          <Button onClick={() => setAsk(null)}>{t.common.cancel}</Button>
          {ask.count > 0 && (
            <Button
              onClick={() => {
                void syncNow()
                setAsk(null)
              }}
            >
              {t.sync.syncNow}
            </Button>
          )}
          <Button
            variant="danger"
            onClick={() => {
              const run = ask.run
              setAsk(null)
              run()
            }}
          >
            {ask.count > 0 ? t.settings.discardChanges(ask.count) : t.common.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  )
  return { guard, dialog }
}

/** 「2027/01/10 到期」 or 「永不過期」 (SETUP-5). */
function expiryLabel(tokenExpiresOn: string | null): string {
  return tokenExpiresOn ? t.settings.expiresOn(displayDate(tokenExpiresOn)) : t.setup.neverExpires
}

function TokenDialog({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const [token, setToken] = useState('')
  const [expires, setExpires] = useState(() => {
    const d = new Date(Date.now() + 90 * 86_400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  // Unticked even when the current token never expires: the new one usually has a date (SETUP-5).
  const [neverExpires, setNeverExpires] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = toIsoDate(new Date())
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} title={t.settings.newTokenTitle} showTitle width={440}>
      <form
        className="token-form"
        // The date's `min` only greys out past days in the picker; the message below explains.
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!neverExpires && isPastDate(expires, new Date())) {
            setError(t.setup.expiryPast)
            return
          }
          setBusy(true)
          setError(null)
          replaceToken(token, neverExpires ? null : expires)
            .then(() => {
              toast(t.settings.changeToken)
              onClose()
            })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : t.sync.errors.unknown))
            .finally(() => setBusy(false))
        }}
      >
        <p className="settings-row-sub">
          {workspace.owner}/{workspace.repo}
        </p>
        <label className="field-label" htmlFor="new-token">
          {t.setup.tokenLabel}
        </label>
        <TextInput
          id="new-token"
          className="mono"
          value={token}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setToken(e.target.value)}
          invalid={!!error}
          placeholder="github_pat_…"
          autoFocus
        />
        <label className="field-label" htmlFor="new-expiry">
          {t.setup.expiryLabel}
        </label>
        <TextInput
          id="new-expiry"
          type="date"
          min={today}
          value={neverExpires ? '' : expires}
          disabled={neverExpires}
          onChange={(e) => setExpires(e.target.value)}
        />
        <label className="check-row">
          <input type="checkbox" checked={neverExpires} onChange={(e) => setNeverExpires(e.target.checked)} />
          <span>{t.setup.neverExpires}</span>
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="confirm-actions">
          <Button onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!token.trim() || (!neverExpires && !expires)}>
            {t.settings.changeToken}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function SettingsDialog({ section: initial }: { section?: string }) {
  const mobile = useIsMobile()
  const s = session()
  const [section, setSection] = useState<Section>((initial as Section) || 'sync')
  const [ui, setUi] = useUi()
  const sync = useSyncState()
  const status = useSyncStatus()
  const offline = useOfflineSummary()
  const [tokenOpen, setTokenOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [picker, setPicker] = useState<'theme' | 'language' | null>(null)
  const { guard, dialog } = useGuarded()
  if (!s) return null
  const ws = s.workspace

  const lastSync = sync?.lastPullAt ? `${statusLabel(status)} · ${t.sync.lastSynced(hhmm(sync.lastPullAt))}` : statusLabel(status)

  const doExport = async () => {
    setBusy('export')
    try {
      downloadBlob(await exportZip(), `${ws.repo}.zip`)
      toast(t.toast.exported)
    } finally {
      setBusy(null)
    }
  }
  const doChangeRepo = () =>
    guard(t.settings.changeRepo, () => {
      void changeRepo().then(() => {
        closeOverlay()
        navigate({ name: 'setup', step: 'repo' })
        location.reload()
      })
    })
  const doDisconnect = () =>
    guard(t.settings.disconnect, () => {
      void disconnect().then(() => {
        closeOverlay()
        navigate({ name: 'setup', step: null })
        location.reload()
      })
    })
  const doClear = () =>
    guard(t.settings.clearDevice, () => {
      setBusy('clear')
      void clearDeviceData().finally(() => setBusy(null))
    })

  const themeOptions: [ThemePref, string][] = [
    ['system', t.settings.themeSystem],
    ['light', t.settings.themeLight],
    ['dark', t.settings.themeDark],
  ]
  // Each language is named in itself.
  const languageOptions: [Language, string][] = [
    ['zh-TW', t.settings.languageZh],
    ['en', t.settings.languageEn],
  ]

  const storageRow = (
    <Row title={t.settings.storage} sub={t.settings.repoWithVisibility(`${ws.owner}/${ws.repo}`, ws.private === false)}>
      <Button onClick={() => void doChangeRepo()}>{t.settings.changeRepo}</Button>
    </Row>
  )
  const tokenRow = (
    <Row title={t.settings.token} sub={`${maskToken(ws.token)} · ${expiryLabel(ws.tokenExpiresOn)}`}>
      <Button onClick={() => setTokenOpen(true)}>{t.settings.changeToken}</Button>
    </Row>
  )
  const linkRow = (
    <Row title={t.settings.linkDevice} sub={t.link.showQrHint}>
      <Button onClick={() => openOverlay({ kind: 'link-device' })}>{t.link.showQr}</Button>
    </Row>
  )
  const disconnectRow = (
    <Row title={t.settings.disconnect} sub={t.settings.disconnectHint}>
      <Button onClick={() => void doDisconnect()}>{t.settings.disconnect}</Button>
    </Row>
  )

  const content: Record<Section, ReactNode> = {
    github: (
      <>
        <h2 className="settings-heading">{t.settings.github}</h2>
        <Row title={ws.name || ws.login} sub={`@${ws.login}`} />
        {storageRow}
        {tokenRow}
        {linkRow}
        {disconnectRow}
      </>
    ),
    appearance: (
      <>
        <h2 className="settings-heading">{t.settings.appearance}</h2>
        <Row title={t.settings.theme}>
          <div className="segmented" role="radiogroup" aria-label={t.settings.theme}>
            {themeOptions.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={ui.theme === value} className={cx('segmented-item', ui.theme === value && 'is-active')} onClick={() => setUi({ theme: value })}>
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row title={t.settings.language}>
          <div className="segmented" role="radiogroup" aria-label={t.settings.language}>
            {languageOptions.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={language === value} lang={value} className={cx('segmented-item', language === value && 'is-active')} onClick={() => setLanguage(value)}>
                {label}
              </button>
            ))}
          </div>
        </Row>
      </>
    ),
    shortcuts: (
      <>
        <h2 className="settings-heading">{t.settings.shortcuts}</h2>
        <dl className="shortcut-list">
          {t.shortcuts.list.map(([keys, label]) => (
            <div key={keys} className="shortcut-row">
              <dt>{label}</dt>
              <dd>{shortcutLabel(keys)}</dd>
            </div>
          ))}
        </dl>
        <h3 className="settings-subheading">Markdown</h3>
        <dl className="shortcut-list">
          {t.shortcuts.markdown.map(([keys, label]) => (
            <div key={keys} className="shortcut-row">
              <dt>{label}</dt>
              <dd>{keys}</dd>
            </div>
          ))}
        </dl>
      </>
    ),
    sync: (
      <>
        <h2 className="settings-heading">{t.settings.syncStorage}</h2>
        {storageRow}
        {tokenRow}
        <Row title={t.settings.syncStatus} sub={lastSync}>
          <Button onClick={() => void syncNow()}>{t.sync.syncNow}</Button>
        </Row>
        <Row title={t.sync.autoSync} sub={t.sync.autoSyncHint}>
          <Switch checked={ui.autoSync} onChange={(v) => setUi({ autoSync: v })} label={t.sync.autoSync} />
        </Row>
        {linkRow}
        <Row title={t.settings.offlineData} sub={t.settings.offlineSummary(offline.pages, formatBytes(offline.bytes))}>
          <Button variant="danger-ghost" loading={busy === 'clear'} onClick={() => void doClear()}>
            {t.settings.clearDevice}
          </Button>
        </Row>
        {disconnectRow}
      </>
    ),
    export: (
      <>
        <h2 className="settings-heading">{t.settings.export}</h2>
        <Row title={t.settings.exportZip} sub={t.settings.exportZipHint}>
          <Button loading={busy === 'export'} onClick={() => void doExport()}>
            {t.settings.export}
          </Button>
        </Row>
      </>
    ),
  }

  if (mobile) {
    const group = (title: string, rows: ReactNode) => (
      <section className="m-group">
        <h2 className="m-group-title">{title}</h2>
        <div className="m-group-body">{rows}</div>
      </section>
    )
    const mrow = (icon: ReactNode, label: ReactNode, value?: ReactNode, onClick?: () => void, tone?: 'accent' | 'danger', chevron = !!onClick) => (
      <button type="button" className={cx('m-row', tone && `is-${tone}`)} onClick={onClick} disabled={!onClick}>
        <span className="m-row-icon">{icon}</span>
        <span className="m-row-label">{label}</span>
        {value !== undefined && <span className="m-row-value">{value}</span>}
        {chevron && <ChevronRight size={16} className="m-row-chevron" />}
      </button>
    )
    return (
      <div className="fullscreen-overlay settings is-mobile" role="dialog" aria-modal="true" aria-label={t.settings.title}>
        <header className="m-large-header">
          <h1>{t.settings.title}</h1>
          <button type="button" className="m-done" onClick={closeOverlay}>
            {t.common.done}
          </button>
        </header>
        {group(
          t.settings.sections.connection,
          <>
            {mrow(<FileText size={20} />, t.settings.storage, ws.repo, () => void doChangeRepo())}
            {mrow(<Lock size={20} />, t.settings.token, expiryLabel(ws.tokenExpiresOn), () => setTokenOpen(true))}
            {mrow(<Link2 size={20} />, t.settings.linkDevice, undefined, () => openOverlay({ kind: 'link-device' }))}
          </>,
        )}
        {group(
          t.settings.sections.sync,
          <>
            {mrow(<CloudCheck size={20} />, t.settings.syncStatus, sync?.lastPullAt ? `${statusLabel(status)} · ${hhmm(sync.lastPullAt)}` : statusLabel(status))}
            <div className="m-row">
              <span className="m-row-icon">
                <Clock size={20} />
              </span>
              <span className="m-row-label">{t.sync.autoSync}</span>
              <Switch checked={ui.autoSync} onChange={(v) => setUi({ autoSync: v })} label={t.sync.autoSync} />
            </div>
            {mrow(<RefreshCw size={20} />, t.sync.syncNow, undefined, () => void syncNow(), 'accent', false)}
          </>,
        )}
        {group(
          t.settings.sections.appearance,
          <>
            {mrow(<Sun size={20} />, t.settings.theme, themeOptions.find(([v]) => v === ui.theme)?.[1], () => setPicker('theme'))}
            {mrow(<Keyboard size={20} />, t.settings.language, languageOptions.find(([v]) => v === language)?.[1], () => setPicker('language'))}
          </>,
        )}
        {group(
          t.settings.sections.data,
          <>
            {mrow(<Download size={20} />, t.settings.exportZip, undefined, () => void doExport(), undefined, false)}
            {mrow(<Trash2 size={20} />, t.settings.clearDevice, undefined, () => void doClear(), 'danger', false)}
            {mrow(<LogOut size={20} />, t.settings.disconnect, undefined, () => void doDisconnect(), 'danger', false)}
          </>,
        )}
        {picker === 'theme' && (
          <ChoiceSheet
            title={t.settings.theme}
            options={themeOptions}
            value={ui.theme}
            onChoose={(theme) => setUi({ theme })}
            onClose={() => setPicker(null)}
          />
        )}
        {picker === 'language' && (
          <ChoiceSheet title={t.settings.language} options={languageOptions} value={language} onChoose={setLanguage} onClose={() => setPicker(null)} lang />
        )}
        {tokenOpen && <TokenDialog workspace={ws} onClose={() => setTokenOpen(false)} />}
        {dialog}
      </div>
    )
  }

  return (
    <Modal open onClose={closeOverlay} title={t.settings.title} width={1000} className="settings-modal" closeButton>
      <div className="settings">
        <nav className="settings-nav">
          <div className="settings-account">
            <Avatar ws={ws} size={28} />
            <div>
              <div className="settings-account-name">{ws.login}</div>
              <div className="settings-account-repo">{ws.repo}</div>
            </div>
          </div>
          {NAV.map((g) => (
            <div key={g.group} className="settings-nav-group">
              <div className="settings-nav-title">{g.group}</div>
              {g.items.map((item) => (
                <button key={item.id} type="button" className={cx('settings-nav-row', section === item.id && 'is-selected')} onClick={() => setSection(item.id)}>
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">{content[section]}</div>
      </div>
      {tokenOpen && <TokenDialog workspace={ws} onClose={() => setTokenOpen(false)} />}
      {dialog}
    </Modal>
  )
}

/** iPhone: a settings row with a chevron opens its choices, the current one ticked. */
function ChoiceSheet<T extends string>({
  title,
  options,
  value,
  onChoose,
  onClose,
  lang = false,
}: {
  title: string
  options: [T, string][]
  value: T
  onChoose: (value: T) => void
  onClose: () => void
  /** Options are language names, each written in its own language. */
  lang?: boolean
}) {
  return (
    <Sheet open onClose={onClose} title={title} className="choice-sheet">
      <div className="sheet-group" role="radiogroup" aria-label={title}>
        {options.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={v === value}
            lang={lang ? v : undefined}
            className="sheet-row"
            onClick={() => {
              onClose()
              if (v !== value) onChoose(v)
            }}
          >
            <span>{label}</span>
            {v === value && <Check size={20} className="sheet-row-check" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function SettingsBackButton() {
  return (
    <button type="button" className="mobile-nav-back" onClick={closeOverlay}>
      <ChevronLeft size={22} />
      {t.nav.back}
    </button>
  )
}

/**
 * LINK-1 / LINK-2: show a QR code and pairing code so another device can link (D15 modal, M21 full screen).
 * The QR code and the code appear only after 「顯示 QR code」, and hide after 60 s or when the window is hidden.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Lock, QrCode } from 'lucide-react'
import * as realCrypto from '../../lib/link/crypto'
import type { LinkCrypto } from '../setup/deps'
import type { Workspace } from '../../lib/types'
import { t } from '../../strings'
import { Button, IconButton, Modal } from '../../ui/primitives'
import { qrPath } from './qrSvg'
import { useIsPhone } from './useIsPhone'
import './link.css'

export const SHOW_SECONDS = 60

export interface LinkDeviceDialogProps {
  open: boolean
  onClose(): void
  workspace: Workspace
  /** Defaults to `src/lib/link/crypto.ts`. */
  linkCrypto?: LinkCrypto
}

export function LinkDeviceDialog(props: LinkDeviceDialogProps) {
  if (!props.open) return null
  return <Inner {...props} />
}

interface Shown {
  code: string
  payload: string
  deadline: number
}

function Inner({ onClose, workspace, linkCrypto = realCrypto }: LinkDeviceDialogProps) {
  const phone = useIsPhone()
  const [shown, setShown] = useState<Shown | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [seconds, setSeconds] = useState(SHOW_SECONDS)
  const [copied, setCopied] = useState(false)
  const generation = useRef(0)

  const hide = useCallback(() => {
    generation.current++
    setShown(null)
    setBusy(false)
    setCopied(false)
  }, [])

  const generate = useCallback(async () => {
    const mine = ++generation.current
    setBusy(true)
    setFailed(false)
    setCopied(false)
    try {
      const code = linkCrypto.generatePairingCode()
      const payload = await linkCrypto.encryptLinkPayload(
        { o: workspace.owner, r: workspace.repo, b: workspace.branch, t: workspace.token, e: workspace.tokenExpiresOn },
        code,
      )
      if (mine !== generation.current) return
      setShown({ code, payload, deadline: Date.now() + SHOW_SECONDS * 1000 })
      setSeconds(SHOW_SECONDS)
    } catch {
      if (mine === generation.current) setFailed(true)
    } finally {
      if (mine === generation.current) setBusy(false)
    }
  }, [linkCrypto, workspace])

  // LINK-2: 60 s countdown.
  const deadline = shown?.deadline
  useEffect(() => {
    if (deadline === undefined) return
    const tick = () => {
      const left = Math.ceil((deadline - Date.now()) / 1000)
      if (left <= 0) hide()
      else setSeconds(left)
    }
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [deadline, hide])

  // LINK-2: hide when the window is hidden.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') hide()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [hide])

  // Invalidate any pending generation on unmount.
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )

  const copy = async () => {
    if (!shown) return
    try {
      await navigator.clipboard.writeText(shown.payload)
      setCopied(true)
    } catch {
      /* clipboard unavailable: nothing to do */
    }
  }

  const body = (
    <div className="link-body">
      <p className="link-intro">
        {(phone ? t.link.showIntroPhone : t.link.showIntro).map((line, i) => (
          <span key={i} className="link-intro-line">
            {line}
          </span>
        ))}
      </p>
      {shown ? (
        <QrCard key={shown.payload} text={realCrypto.qrText(shown.payload, shown.code)} />
      ) : (
        <Placeholder busy={busy} failed={failed} onShow={generate} />
      )}
      {shown && (
        <>
          {/* LINK-2: the QR code carries the pairing code; only the copied setup code needs it typed. */}
          {copied && (
            <>
              <div className="link-code-label">{t.link.pairingCode}</div>
              <div className="link-code" aria-live="polite">
                {shown.code.slice(0, 4)}-{shown.code.slice(4)}
              </div>
              <div className="link-code-hint">{t.link.pairingCodeForPaste}</div>
            </>
          )}
          <div className="link-warning">
            <Lock size={12} aria-hidden="true" />
            <span>{t.link.secretWarning}</span>
          </div>
          <div className="link-countdown">{t.link.hidesIn(seconds)}</div>
          {phone && (
            <button type="button" className="link-regen-phone" onClick={generate}>
              {t.link.regenerate}
            </button>
          )}
          {copied && <div className="link-clipboard-note">{t.link.clipboardWarning}</div>}
        </>
      )}
    </div>
  )

  const actions = (
    <div className="link-actions">
      {shown && (
        <Button variant={phone ? 'secondary' : 'ghost'} size={phone ? 'lg' : 'md'} className="link-copy" onClick={copy}>
          {copied ? t.common.copied : t.link.copySetupCode}
        </Button>
      )}
      {shown && !phone && (
        <Button variant="secondary" onClick={generate} loading={busy}>
          {t.link.regenerate}
        </Button>
      )}
      <Button variant="primary" size={phone ? 'lg' : 'md'} className="link-done" onClick={onClose}>
        {t.common.done}
      </Button>
    </div>
  )

  if (phone) {
    return (
      <PhoneScreen onClose={onClose}>
        {body}
        {actions}
      </PhoneScreen>
    )
  }
  return (
    <Modal open onClose={onClose} title={t.link.title} showTitle width={480} className="link-modal">
      {body}
      {actions}
    </Modal>
  )
}

function Placeholder({ busy, failed, onShow }: { busy: boolean; failed: boolean; onShow(): void }) {
  return (
    <div className="qr-card qr-placeholder">
      <QrCode size={36} strokeWidth={1.5} aria-hidden="true" />
      <p>{t.link.showQrHint}</p>
      <Button variant="primary" onClick={onShow} loading={busy}>
        {t.link.showQr}
      </Button>
      {failed && <p className="link-error">{t.sync.errors.unknown}</p>}
    </div>
  )
}

function QrCard({ text }: { text: string }) {
  // Computed once per payload (the card is keyed by it); it re-renders once a second for the countdown.
  const [path] = useState(() => qrPath(text))
  const quiet = 0
  const total = path.size + quiet * 2
  return (
    <div className="qr-card">
      <svg
        role="img"
        aria-label={t.link.qrAlt}
        viewBox={`${-quiet} ${-quiet} ${total} ${total}`}
        shapeRendering="crispEdges"
        className="qr-svg"
      >
        <path d={path.d} fill="currentColor" />
      </svg>
    </div>
  )
}

function PhoneScreen({ onClose, children }: { onClose(): void; children: React.ReactNode }) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="link-screen">
      <header className="link-screen-top">
        <IconButton label={t.nav.back} size={32} onClick={onClose} className="link-screen-back">
          <ChevronLeft size={22} />
        </IconButton>
        <h2 id={titleId}>{t.link.title}</h2>
      </header>
      {children}
    </div>,
    document.body,
  )
}


/**
 * LINK-1 / LINK-2: show a QR code and pairing code so another device can link (D15 modal, M21 full screen).
 * The QR code and the code appear only after 「顯示 QR code」, and hide after 60 s or when the window is hidden.
 *
 * LINK-5: 「新裝置沒有相機？改用配對碼」 shows the GitHub account and a 10-character code instead, backed by
 * a public gist that is deleted when the code is hidden, replaced or expires (5 minutes), or by the new
 * device once it has read it. The code stays while the window is hidden: the phone may lock while the
 * user types on the other device.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, ChevronLeft, Lock, QrCode } from 'lucide-react'
import { GitHubClient } from '../../lib/github/client'
import * as realCrypto from '../../lib/link/crypto'
import { formatPairingCode, LONG_CODE_LENGTH } from '../../lib/link/crypto'
import { LINK_GIST_FILE, LINK_GIST_SECONDS, NoGistPermissionError, publishLinkGist, removeLinkGists } from '../../lib/link/gist'
import { errorMessage, type LinkCrypto } from '../setup/deps'
import type { Workspace } from '../../lib/types'
import { t } from '../../strings'
import { Button, IconButton, Modal, Spinner } from '../../ui/primitives'
import { rememberLinkGist } from './linkGist'
import { qrPath } from './qrSvg'
import { useIsPhone } from './useIsPhone'
import './link.css'

export const SHOW_SECONDS = 60
/** LINK-5: how often the source checks whether the new device has taken (deleted) the gist. */
export const GIST_POLL_MS = 3000

const FINE_GRAINED_TOKENS_URL = 'https://github.com/settings/personal-access-tokens'
const CLASSIC_TOKENS_URL = 'https://github.com/settings/tokens'

export interface LinkDeviceDialogProps {
  open: boolean
  onClose(): void
  workspace: Workspace
  /** Defaults to `src/lib/link/crypto.ts`. */
  linkCrypto?: LinkCrypto
  /** LINK-5: the client that writes the link gist. Defaults to a new client for the workspace token. */
  createClient?(token: string): GitHubClient
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

function Inner({ onClose, workspace, linkCrypto = realCrypto, createClient }: LinkDeviceDialogProps) {
  const phone = useIsPhone()
  const [mode, setMode] = useState<'qr' | 'code'>('qr')
  const codeLink = useCodeLink(workspace, linkCrypto, createClient)
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

  const switchToCode = () => {
    hide()
    setMode('code')
    void codeLink.generate()
  }
  const switchToQr = () => {
    codeLink.hide()
    setMode('qr')
  }

  const codeBody = (
    <div className="link-body">
      <p className="link-intro">
        {t.link.codeIntro.map((line, i) => (
          <span key={i} className="link-intro-line">
            {line}
          </span>
        ))}
      </p>
      <CodePanel state={codeLink} login={workspace.login} classic={workspace.token.startsWith('ghp_')} onRetry={codeLink.generate} />
      {codeLink.shown && !codeLink.shown.linked && (
        <>
          <div className="link-warning">
            <Lock size={12} aria-hidden="true" />
            <span>{t.link.codeWarning}</span>
          </div>
          <div className="link-countdown">{t.link.codeExpiresIn(codeLink.seconds)}</div>
          {phone && (
            <button type="button" className="link-regen-phone" onClick={() => void codeLink.generate()}>
              {t.link.regenerate}
            </button>
          )}
        </>
      )}
    </div>
  )

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
      <button type="button" className="link-switch" onClick={switchToCode}>
        {t.link.showCodeHint}
      </button>
    </div>
  )

  const codeActions = (
    <div className="link-actions">
      <Button variant={phone ? 'secondary' : 'ghost'} size={phone ? 'lg' : 'md'} className="link-copy" onClick={switchToQr}>
        {t.link.backToQr}
      </Button>
      {codeLink.shown && !codeLink.shown.linked && !phone && (
        <Button variant="secondary" onClick={() => void codeLink.generate()} loading={codeLink.busy}>
          {t.link.regenerate}
        </Button>
      )}
      <Button variant="primary" size={phone ? 'lg' : 'md'} className="link-done" onClick={onClose}>
        {t.common.done}
      </Button>
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
        {mode === 'code' ? codeBody : body}
        {mode === 'code' ? codeActions : actions}
      </PhoneScreen>
    )
  }
  return (
    <Modal open onClose={onClose} title={t.link.title} showTitle width={480} className="link-modal">
      {mode === 'code' ? codeBody : body}
      {mode === 'code' ? codeActions : actions}
    </Modal>
  )
}

interface CodeShown {
  code: string
  gistId: string
  deadline: number
  /** The new device has read (and deleted) the gist. */
  linked: boolean
}

type CodeError = { kind: 'no-permission' } | { kind: 'failed'; message: string }

interface CodeLinkState {
  shown: CodeShown | null
  busy: boolean
  error: CodeError | null
  seconds: number
  generate(): Promise<void>
  hide(): void
}

/** LINK-5 on the source device: publish the link gist, count down, notice when it is taken, clean up. */
function useCodeLink(workspace: Workspace, linkCrypto: LinkCrypto, createClient?: (token: string) => GitHubClient): CodeLinkState {
  const client = useMemo(() => (createClient ? createClient(workspace.token) : new GitHubClient({ token: workspace.token })), [createClient, workspace.token])
  const [shown, setShown] = useState<CodeShown | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<CodeError | null>(null)
  const [seconds, setSeconds] = useState(LINK_GIST_SECONDS)
  const generation = useRef(0)
  // The gist that is live and still ours to delete.
  const live = useRef<string | null>(null)

  const drop = useCallback(() => {
    const id = live.current
    live.current = null
    if (!id) return
    void client
      .deleteGist(id)
      .then(() => rememberLinkGist(null))
      .catch(() => undefined)
  }, [client])

  const hide = useCallback(() => {
    generation.current++
    drop()
    setShown(null)
    setBusy(false)
  }, [drop])

  const generate = useCallback(async () => {
    const mine = ++generation.current
    drop()
    setShown(null)
    setError(null)
    setBusy(true)
    try {
      const code = linkCrypto.generatePairingCode(LONG_CODE_LENGTH)
      // Leftovers of earlier codes (an app closed while one was shown). Publishing reports real problems.
      await removeLinkGists(client).catch(() => undefined)
      const data = { o: workspace.owner, r: workspace.repo, b: workspace.branch, t: workspace.token, e: workspace.tokenExpiresOn }
      const id = await publishLinkGist(client, data, code)
      if (mine !== generation.current) {
        void client.deleteGist(id).catch(() => undefined)
        return
      }
      live.current = id
      void rememberLinkGist(id).catch(() => undefined)
      setShown({ code, gistId: id, deadline: Date.now() + LINK_GIST_SECONDS * 1000, linked: false })
      setSeconds(LINK_GIST_SECONDS)
    } catch (e) {
      if (mine === generation.current) setError(e instanceof NoGistPermissionError ? { kind: 'no-permission' } : { kind: 'failed', message: errorMessage(e) })
    } finally {
      if (mine === generation.current) setBusy(false)
    }
  }, [client, drop, linkCrypto, workspace])

  // Countdown; the gist goes when the code expires.
  const deadline = shown && !shown.linked ? shown.deadline : undefined
  useEffect(() => {
    if (deadline === undefined) return
    const tick = () => {
      const left = Math.ceil((deadline - Date.now()) / 1000)
      if (left <= 0) hide()
      else setSeconds(left)
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [deadline, hide])

  // The new device deletes the gist once it has decrypted it.
  const watching = shown && !shown.linked ? shown.gistId : null
  useEffect(() => {
    if (!watching) return
    let stopped = false
    const id = setInterval(() => {
      void client
        .getGistFile(watching, LINK_GIST_FILE)
        .then((content) => {
          if (stopped || content !== null || live.current !== watching) return
          live.current = null
          void rememberLinkGist(null).catch(() => undefined)
          setShown((s) => (s && s.gistId === watching ? { ...s, linked: true } : s))
        })
        .catch(() => undefined)
    }, GIST_POLL_MS)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [client, watching])

  // Closing the dialog deletes the gist.
  useEffect(
    () => () => {
      generation.current++
      drop()
    },
    [drop],
  )

  return { shown, busy, error, seconds, generate, hide }
}

function CodePanel({ state, login, classic, onRetry }: { state: CodeLinkState; login: string; classic: boolean; onRetry(): void }) {
  const { shown, error } = state
  if (shown?.linked) {
    return (
      <div className="code-card is-linked" role="status">
        <CircleCheck size={28} aria-hidden="true" />
        <p>{t.link.codeLinked}</p>
      </div>
    )
  }
  if (shown) {
    return (
      <div className="code-card">
        <div className="link-code-label">{t.link.accountLabel}</div>
        <div className="code-account">{login}</div>
        <div className="link-code-label">{t.link.pairingCode}</div>
        <div className="link-code" aria-live="polite">
          {formatPairingCode(shown.code)}
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="code-card is-error" role="alert">
        {error.kind === 'no-permission' ? (
          <>
            <p className="link-error">{t.link.noGistPermission}</p>
            <p className="code-steps">{classic ? t.link.noGistScopeSteps : t.link.noGistPermissionSteps}</p>
            <a href={classic ? CLASSIC_TOKENS_URL : FINE_GRAINED_TOKENS_URL} target="_blank" rel="noopener noreferrer">
              {t.link.editToken} ↗
            </a>
          </>
        ) : (
          <p className="link-error">{error.message}</p>
        )}
        <Button onClick={onRetry}>{t.common.retry}</Button>
      </div>
    )
  }
  return (
    <div className="code-card is-busy">
      <Spinner size={16} /> <span>{t.link.generating}</span>
    </div>
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


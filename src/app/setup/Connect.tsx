/** D12 / M12 (SETUP-3 to SETUP-6): paste a token and its expiry date, check it with GitHub. */
import { useRef, useState } from 'react'
import { CalendarDays, Lock } from 'lucide-react'
import { GitHubError, type GitHubClient, type GitHubUser, type RepoSummary } from '../../lib/github/client'
import { t } from '../../strings'
import { Button, Spinner } from '../../ui/primitives'
import { errorMessage } from './deps'
import { SetupPage } from './parts'
import { checkToken, defaultExpiry, formatExpiry, isPastDate, parseExpiryText } from './token'
import './setup.css'

export const NEW_REPO_URL = 'https://github.com/new'
export const NEW_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=GitHub+Notes&description=GitHub+Notes+app&contents=write&expires_in=90'

export interface ConnectResult {
  token: string
  /** `YYYY-MM-DD` */
  tokenExpiresOn: string
  client: GitHubClient
  user: GitHubUser
  repos: RepoSummary[]
}

export interface ConnectProps {
  createClient(token: string): GitHubClient
  today(): Date
  /** Shown as 「token 只存在這台 iPhone」 on the phone layout. */
  deviceName?: string
  onConnected(result: ConnectResult): void
}

export function Connect({ createClient, today, deviceName, onConnected }: ConnectProps) {
  const [tokenText, setTokenText] = useState('')
  const [reveal, setReveal] = useState(false)
  const [touched, setTouched] = useState(false)
  const [expiryText, setExpiryText] = useState(() => formatExpiry(defaultExpiry(today())))
  const [classicAck, setClassicAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const dateRef = useRef<HTMLInputElement>(null)

  const check = checkToken(tokenText)
  const expiryIso = parseExpiryText(expiryText)
  const expiryError = !expiryIso ? t.setup.expiryInvalid : isPastDate(expiryIso, today()) ? t.setup.expiryPast : null
  const tokenError = check.kind === 'invalid' && (touched || submitted) ? t.setup.notAToken : null
  const showClassic = check.kind === 'classic' && submitted && !classicAck

  const connect = async (ack = classicAck) => {
    setSubmitted(true)
    setServerError(null)
    if (check.kind !== 'fine-grained' && check.kind !== 'classic') return
    if (check.kind === 'classic' && !ack) return
    if (expiryError || !expiryIso) return
    setBusy(true)
    try {
      const client = createClient(check.token)
      const user = await client.getUser()
      const repos = await client.listRepos()
      onConnected({ token: check.token, tokenExpiresOn: expiryIso, client, user, repos })
    } catch (e) {
      setServerError(e instanceof GitHubError && e.kind === 'unauthorized' ? t.setup.tokenInvalid : errorMessage(e))
      setBusy(false)
    }
  }

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setTokenText(text.trim())
      setClassicAck(false)
      setTouched(true)
    } catch {
      /* clipboard read not allowed: the user can paste by hand */
    }
  }

  const phoneNote = deviceName ? t.setup.tokenOnlyHereDevice(deviceName) : t.setup.tokenOnlyHere
  const canConnect = check.kind === 'fine-grained' || check.kind === 'classic'

  const button = (
    <>
      <Button variant="primary" size="lg" block disabled={!canConnect} loading={busy} onClick={() => void connect()}>
        {busy ? t.setup.connecting : t.setup.connect}
      </Button>
      <p className="setup-privacy only-desktop">
        <Lock size={12} aria-hidden="true" /> {t.setup.tokenOnlyHere}
      </p>
    </>
  )

  return (
    <SetupPage step={1} footer={button}>
      <h1 className="setup-title">{t.setup.connectTitle}</h1>
      <p className="setup-intro">
        <span className="only-desktop">{t.setup.connectIntro}</span>
        <span className="only-phone">{t.setup.connectIntro.replace(t.setup.thisDevice, deviceName ? t.setup.thisNamedDevice(deviceName) : t.setup.thisDevice)}</span>
      </p>

      <ol className="instructions">
        <li>
          <span className="instr-num" aria-hidden="true">
            1
          </span>
          <div>
            <h2>{t.setup.step1Title}</h2>
            <p>{t.setup.step1Body}</p>
            <a href={NEW_REPO_URL} target="_blank" rel="noopener noreferrer">
              {t.setup.step1Link} ↗
            </a>
          </div>
        </li>
        <li>
          <span className="instr-num" aria-hidden="true">
            2
          </span>
          <div>
            <h2>{t.setup.step2Title}</h2>
            <p>
              <span className="only-desktop">{t.setup.step2Body}</span>
              <span className="only-phone">{t.setup.step2BodyShort}</span>
            </p>
            <a href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer">
              {t.setup.step2Link} ↗
            </a>
          </div>
        </li>
        <li>
          <span className="instr-num" aria-hidden="true">
            3
          </span>
          <div>
            <h2>{t.setup.step3Title}</h2>
            <p>
              <span className="only-desktop">{t.setup.step3Body}</span>
              <span className="only-phone">{t.setup.step3BodyShort}</span>
            </p>
          </div>
        </li>
      </ol>

      <form
        className="connect-form"
        onSubmit={(e) => {
          e.preventDefault()
          void connect()
        }}
      >
        <label className="field-label" htmlFor="setup-token">
          {t.setup.tokenLabel}
        </label>
        <div className={`field-wrap${tokenError ? ' is-invalid' : ''}`}>
          <input
            id="setup-token"
            className="field-input is-mono"
            type={reveal ? 'text' : 'password'}
            value={tokenText}
            placeholder={t.setup.tokenPlaceholder}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            name="github-notes-token"
            data-1p-ignore
            data-lpignore="true"
            aria-invalid={tokenError ? true : undefined}
            aria-describedby={tokenError ? 'setup-token-error' : undefined}
            onChange={(e) => {
              setTokenText(e.target.value)
              setClassicAck(false)
              setServerError(null)
            }}
            onBlur={() => {
              setTouched(true)
              setTokenText((v) => v.trim())
            }}
          />
          {tokenText === '' ? (
            <button type="button" className="field-action only-phone" onClick={() => void paste()}>
              {t.setup.paste}
            </button>
          ) : null}
          <button
            type="button"
            className={`field-action${tokenText === '' ? ' only-desktop' : ''}`}
            onClick={() => setReveal((v) => !v)}
            aria-pressed={reveal}
          >
            {reveal ? t.common.hide : t.common.show}
          </button>
        </div>
        {tokenError && (
          <p id="setup-token-error" className="field-error" role="alert">
            {tokenError}
          </p>
        )}
        <p className="field-note only-phone">
          {phoneNote}
        </p>
        {showClassic && (
          <div className="warn-box" role="alert">
            <p>{t.setup.classicWarning}</p>
            <Button
              size="sm"
              onClick={() => {
                setClassicAck(true)
                void connect(true)
              }}
            >
              {t.setup.useAnyway}
            </Button>
          </div>
        )}

        <label className="field-label" htmlFor="setup-expiry">
          {t.setup.expiryLabel}
        </label>
        <div className={`field-wrap${submitted && expiryError ? ' is-invalid' : ''}`}>
          <input
            id="setup-expiry"
            className="field-input"
            inputMode="numeric"
            placeholder="YYYY/MM/DD"
            value={expiryText}
            autoComplete="off"
            onChange={(e) => setExpiryText(e.target.value)}
          />
          <span className="field-icon-wrap">
            <CalendarDays size={15} aria-hidden="true" />
            <input
              ref={dateRef}
              type="date"
              className="date-overlay"
              tabIndex={-1}
              aria-hidden="true"
              value={expiryIso ?? ''}
              onChange={(e) => e.target.value && setExpiryText(formatExpiry(e.target.value))}
            />
          </span>
        </div>
        {submitted && expiryError ? (
          <p className="field-error" role="alert">
            {expiryError}
          </p>
        ) : (
          <p className="field-note">{t.setup.expiryHint}</p>
        )}
        {serverError && (
          <p className="field-error" role="alert">
            {serverError}
          </p>
        )}
        {busy && (
          <span className="visually-hidden">
            <Spinner />
          </span>
        )}
        <button type="submit" hidden />
      </form>
    </SetupPage>
  )
}

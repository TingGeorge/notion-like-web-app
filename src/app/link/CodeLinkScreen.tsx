/**
 * LINK-5 on the new device: type the GitHub account and the 10-character code shown on a linked device.
 * The link gist is looked up without a token; a code made a moment ago may take a few seconds to be
 * listed, so a gist that is not there yet is looked for again a few times.
 */
import { useEffect, useRef, useState } from 'react'
import { GitHubError, type GitHubClient } from '../../lib/github/client'
import { LONG_CODE_LENGTH, WrongPairingCodeError, type LinkData } from '../../lib/link/crypto'
import { fetchLinkGist, LinkGistNotFoundError, normalizeLogin } from '../../lib/link/gist'
import { t } from '../../strings'
import { Button, Spinner } from '../../ui/primitives'
import { errorMessage } from '../setup/deps'
import { PairingInput } from './PairingInput'
import './link.css'

/** Waits before looking for a gist that is not listed yet. */
export const NOT_FOUND_RETRY_MS = [2000, 4000, 6000]

export interface CodeLinkScreenProps {
  /** `''` builds the anonymous client used to read the gist. */
  createClient(token: string): GitHubClient
  onCancel(): void
  /** Decrypted; the gist has been deleted (best effort). */
  onLinked(data: LinkData): void
  retryDelaysMs?: number[]
}

export function CodeLinkScreen({ createClient, onCancel, onLinked, retryDelaysMs = NOT_FOUND_RETRY_MS }: CodeLinkScreenProps) {
  const [login, setLogin] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeWrong, setCodeWrong] = useState(false)
  const [inputKey, setInputKey] = useState(0)
  const alive = useRef(true)
  useEffect(() => {
    // Set again on mount: StrictMode mounts, cleans up and mounts once more.
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const account = normalizeLogin(login)
  const ready = account !== null && code.length === LONG_CODE_LENGTH

  const submit = async (value = code) => {
    if (busy) return
    if (account === null) {
      setError(login.trim() ? t.link.accountInvalid : null)
      return
    }
    if (value.length !== LONG_CODE_LENGTH) return
    setBusy(true)
    setError(null)
    setCodeWrong(false)
    const anonymous = createClient('')
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const { data, gistId } = await fetchLinkGist(anonymous, account, value)
          // The payload is no longer needed in public: delete it with the token it carried.
          void createClient(data.t)
            .deleteGist(gistId)
            .catch(() => undefined)
          if (alive.current) onLinked(data)
          return
        } catch (e) {
          if (!(e instanceof LinkGistNotFoundError) || attempt >= retryDelaysMs.length) throw e
          await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]))
          if (!alive.current) return
        }
      }
    } catch (e) {
      if (!alive.current) return
      if (e instanceof WrongPairingCodeError) {
        setError(t.link.codeWrong)
        setCodeWrong(true)
        setCode('')
        setInputKey((k) => k + 1)
      } else if (e instanceof LinkGistNotFoundError) {
        setError(t.link.codeNotFound)
      } else if (e instanceof GitHubError && e.kind === 'not-found') {
        setError(t.link.accountNotFound)
      } else {
        setError(errorMessage(e))
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="pair-screen">
      <div className="pair-scroll">
        <button type="button" className="pair-cancel" onClick={onCancel}>
          {t.common.cancel}
        </button>
        <form
          className="pair-main"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <h1 className="pair-title">{t.link.codeTitle}</h1>
          <p className="pair-intro">{t.link.codeScreenIntro}</p>
          <label className="pair-label" htmlFor="link-account">
            {t.link.accountLabel}
          </label>
          <input
            id="link-account"
            className="pair-account"
            value={login}
            placeholder={t.link.accountPlaceholder}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => {
              setLogin(e.target.value)
              setError(null)
            }}
            autoFocus
          />
          <div className="pair-label" id="link-code-label">
            {t.link.pairingCode}
          </div>
          <PairingInput
            key={inputKey}
            value={code}
            length={LONG_CODE_LENGTH}
            onChange={(v) => {
              setCode(v)
              setCodeWrong(false)
            }}
            onComplete={(v) => {
              if (normalizeLogin(login) !== null) void submit(v)
            }}
            disabled={busy}
            invalid={codeWrong}
            autoFocus={inputKey > 0}
          />
          {busy && (
            <p className="pair-status">
              <Spinner size={12} /> {t.link.searching}
            </p>
          )}
          {error && (
            <p className="pair-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" hidden />
        </form>
      </div>
      <div className="pair-bottom">
        <Button variant="primary" size="lg" block disabled={!ready} loading={busy} onClick={() => void submit()}>
          {t.link.pasteContinue}
        </Button>
      </div>
    </div>
  )
}

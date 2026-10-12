/**
 * LINK-3 / M22: enter the pairing code, decrypt the scanned payload, show what is about to be linked
 * (SEC-8), then probe write access (SETUP-8) and hand the Workspace to the app.
 */
import { useRef, useState } from 'react'
import { InvalidPayloadError, WrongPairingCodeError } from '../../lib/link/crypto'
import type { GitHubUser } from '../../lib/github/client'
import type { LinkData } from '../../lib/link/crypto'
import type { Workspace } from '../../lib/types'
import { t } from '../../strings/zh-TW'
import { Button, Spinner } from '../../ui/primitives'
import { activateRepo, errorMessage, type SetupDeps } from '../setup/deps'
import { formatExpiry } from '../setup/token'
import { PairingInput, PAIRING_LENGTH } from './PairingInput'
import './link.css'

export const MAX_WRONG_CODES = 3

export interface PairingCodeScreenProps {
  /** The scanned or pasted `ghnotes:1:…` text. Held in memory only. */
  payload: string
  deps: Required<Pick<SetupDeps, 'createClient' | 'linkCrypto' | 'welcomePage' | 'now'>>
  onCancel(): void
  /** Three wrong codes or a malformed payload: go back to scanning with a message. */
  onDiscard(message: string): void
  /** The write probe passed and the workspace was built. The caller persists it and moves on. */
  onReady(ws: Workspace): Promise<void>
}

export function PairingCodeScreen({ payload, deps, onCancel, onDiscard, onReady }: PairingCodeScreenProps) {
  const [code, setCode] = useState('')
  const [wrong, setWrong] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<LinkData | null>(null)
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const attempts = useRef(0)
  const [inputKey, setInputKey] = useState(0)

  const decrypt = async (value: string) => {
    if (busy) return
    setBusy(true)
    try {
      const d = await deps.linkCrypto.decryptLinkPayload(payload, value)
      setData(d)
      setWrong(null)
      try {
        setUser(await deps.createClient(d.t).getUser())
      } catch (e) {
        setAccountError(errorMessage(e))
      }
    } catch (e) {
      if (e instanceof InvalidPayloadError) {
        onDiscard(t.link.notOurQr)
        return
      }
      if (e instanceof WrongPairingCodeError) {
        attempts.current++
        if (attempts.current >= MAX_WRONG_CODES) {
          onDiscard(t.link.tooManyTries)
          return
        }
        setWrong(MAX_WRONG_CODES - attempts.current)
        setCode('')
        setInputKey((k) => k + 1)
        return
      }
      onDiscard(t.sync.errors.unknown)
    } finally {
      setBusy(false)
    }
  }

  const link = async () => {
    if (!data || !user || linking) return
    setLinking(true)
    setLinkError(null)
    try {
      const client = deps.createClient(data.t)
      let isPrivate: boolean | undefined
      try {
        isPrivate = (await client.getRepo(data.o, data.r)).private
      } catch {
        isPrivate = undefined
      }
      const res = await activateRepo({
        client,
        repo: { owner: data.o, name: data.r, defaultBranch: data.b, private: isPrivate ?? true },
        token: data.t,
        tokenExpiresOn: data.e,
        user,
        welcomePage: deps.welcomePage,
        now: deps.now(),
      })
      if (!res.ok) {
        setLinkError(t.setup.noWriteAccess)
        return
      }
      await onReady(res.workspace)
    } catch (e) {
      setLinkError(errorMessage(e))
    } finally {
      setLinking(false)
    }
  }

  const confirmed = data !== null

  return (
    <div className="pair-screen">
      <div className="pair-scroll">
        <button type="button" className="pair-cancel" onClick={onCancel}>
          {t.common.cancel}
        </button>
        <div className="pair-main">
          <h1 className="pair-title">{t.link.enterCodeTitle}</h1>
          <p className="pair-intro">{t.link.enterCodeIntro}</p>
          <PairingInput
            key={inputKey}
            value={code}
            onChange={setCode}
            onComplete={(v) => void decrypt(v)}
            disabled={busy || confirmed}
            invalid={wrong !== null}
            autoFocus
          />
          {busy && (
            <p className="pair-status">
              <Spinner size={12} /> {t.link.decrypting}
            </p>
          )}
          {wrong !== null && (
            <p className="pair-error" role="alert">
              {t.link.wrongCode(wrong)}
            </p>
          )}
          {confirmed && (
            <>
              <div className="pair-card">
                <div className="pair-card-label">{t.link.aboutToLink}</div>
                <div className="pair-card-repo">
                  {data.o}/{data.r}
                </div>
                <div className="pair-card-meta">
                  {user ? (
                    t.link.accountLine(user.login, formatExpiry(data.e))
                  ) : accountError ? (
                    <span className="pair-error-inline">{accountError}</span>
                  ) : (
                    t.link.checkingAccount
                  )}
                </div>
              </div>
              <p className="pair-note">{t.link.confirmOwn}</p>
              {linkError && (
                <p className="pair-error" role="alert">
                  {linkError}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <div className="pair-bottom">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!confirmed || !user || code.length !== PAIRING_LENGTH}
          loading={linking}
          onClick={() => void link()}
        >
          {t.link.linkAndSync}
        </Button>
      </div>
    </div>
  )
}

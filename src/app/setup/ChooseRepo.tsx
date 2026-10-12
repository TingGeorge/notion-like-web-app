/** D13 / M13 (SETUP-7 to SETUP-9): pick the repo, confirm public ones, probe write access, initialise an empty repo. */
import { useEffect, useRef, useState } from 'react'
import type { GitHubClient, GitHubUser, RepoSummary } from '../../lib/github/client'
import type { Workspace } from '../../lib/types'
import { t } from '../../strings/zh-TW'
import { Button, Modal, cx } from '../../ui/primitives'
import { activateRepo, errorMessage } from './deps'
import { SetupPage } from './parts'
import './setup.css'

export const TOKEN_SETTINGS_URL = 'https://github.com/settings/personal-access-tokens'

/** Page counts are fetched this many at a time. */
export const COUNT_CONCURRENCY = 3

export interface ChooseRepoProps {
  repos: RepoSummary[]
  client: GitHubClient
  token: string
  tokenExpiresOn: string
  user: GitHubUser
  welcomePage: string
  now(): Date
  onBack(): void
  /** Called with the finished Workspace; the caller persists it and moves to the first sync. */
  onReady(ws: Workspace): Promise<void>
}

type Count = number | null | 'loading' | undefined

/** SETUP-7: private repos first (stable inside each group). */
export function sortRepos(repos: RepoSummary[]): RepoSummary[] {
  return [...repos].sort((a, b) => Number(a.private === false) - Number(b.private === false))
}

export function ChooseRepo({ repos, client, token, tokenExpiresOn, user, welcomePage, now, onBack, onReady }: ChooseRepoProps) {
  const sorted = useRef(sortRepos(repos)).current
  const [selected, setSelected] = useState<string | null>(() => sorted.find((r) => r.private)?.fullName ?? null)
  const [counts, setCounts] = useState<Record<string, Count>>({})
  const [confirmPublic, setConfirmPublic] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lazy page counts, a few at a time (D13 second line).
  useEffect(() => {
    let cancelled = false
    const queue = sorted.filter((r) => r.size > 0)
    const run = async () => {
      const next = async (): Promise<void> => {
        const repo = queue.shift()
        if (!repo || cancelled) return
        setCounts((c) => ({ ...c, [repo.fullName]: 'loading' }))
        let n: number | null
        try {
          n = await client.countPages(repo.owner, repo.name, repo.defaultBranch)
        } catch {
          n = null
        }
        if (cancelled) return
        setCounts((c) => ({ ...c, [repo.fullName]: n }))
        await next()
      }
      await Promise.all(Array.from({ length: COUNT_CONCURRENCY }, next))
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [client, sorted])

  const detail = (r: RepoSummary): string => {
    if (!r.private) return t.setup.publicWarning
    if (r.size === 0) return t.setup.emptyRepo
    const c = counts[r.fullName]
    if (typeof c === 'number') return t.setup.existingRepo(c)
    if (c === null) return t.setup.existingRepoUnknown
    return t.setup.repoCountLoading
  }

  const chosen = sorted.find((r) => r.fullName === selected) ?? null

  const proceed = async (repo: RepoSummary) => {
    setConfirmPublic(false)
    setBusy(true)
    setError(null)
    try {
      const res = await activateRepo({
        client,
        repo: { owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch, private: repo.private },
        token,
        tokenExpiresOn,
        user,
        welcomePage,
        now: now(),
      })
      if (!res.ok) {
        setError(t.setup.noWriteAccess)
        setBusy(false)
        return
      }
      await onReady(res.workspace)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const onUse = () => {
    if (!chosen || busy) return
    if (!chosen.private) setConfirmPublic(true)
    else void proceed(chosen)
  }

  const footer = (
    <>
      <Button variant="primary" size="lg" className="repo-use" disabled={!chosen} loading={busy} onClick={onUse}>
        {busy ? t.setup.checking : t.setup.useRepo}
      </Button>
      <Button variant="secondary" size="lg" className="repo-back" disabled={busy} onClick={onBack}>
        {t.common.back}
      </Button>
    </>
  )

  return (
    <SetupPage step={2} footer={footer}>
      <h1 className="setup-title">{t.setup.chooseTitle}</h1>
      <p className="setup-intro">{t.setup.chooseIntro}</p>

      {sorted.length === 0 ? (
        <p className="repo-empty">{t.setup.noRepos}</p>
      ) : (
        <div className="repo-list" role="radiogroup" aria-label={t.setup.repoListLabel}>
          {sorted.map((r) => {
            const isSel = r.fullName === selected
            return (
              <button
                key={r.fullName}
                type="button"
                role="radio"
                aria-checked={isSel}
                className={cx('repo-row', isSel && 'is-selected', !r.private && 'is-public')}
                onClick={() => {
                  setSelected(r.fullName)
                  setError(null)
                }}
              >
                <span className="repo-radio" aria-hidden="true" />
                <span className="repo-text">
                  <span className="repo-name">
                    <span className="repo-fullname">{r.fullName}</span>
                    <span className="repo-badge">{r.private ? t.setup.badgePrivate : t.setup.badgePublic}</span>
                  </span>
                  <span className="repo-detail">{detail(r)}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      <a className="repo-find" href={TOKEN_SETTINGS_URL} target="_blank" rel="noopener noreferrer">
        {t.setup.cantFind} ↗
      </a>
      {error && (
        <p className="field-error repo-error" role="alert">
          {error}
        </p>
      )}

      <Modal open={confirmPublic} onClose={() => setConfirmPublic(false)} title={t.setup.publicConfirmTitle} showTitle width={400} className="confirm-modal">
        <p className="confirm-text">{t.setup.publicConfirm}</p>
        <div className="confirm-actions">
          <Button onClick={() => setConfirmPublic(false)}>{t.common.cancel}</Button>
          <Button variant="danger" onClick={() => chosen && void proceed(chosen)}>
            {t.setup.useAnyway}
          </Button>
        </div>
      </Modal>
    </SetupPage>
  )
}

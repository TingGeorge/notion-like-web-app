/** D14 / M14 (SETUP-10): first download with progress. */
import { useEffect, useId, useRef, useState } from 'react'
import { Check, Circle, Lightbulb, RefreshCw } from 'lucide-react'
import type { InitialSyncProgress } from '../../lib/sync/engine'
import { t } from '../../strings'
import { Button, cx } from '../../ui/primitives'
import { errorMessage } from './deps'
import { SetupPage } from './parts'
import './setup.css'

export interface FirstSyncProps {
  /** `owner/repo`, for 「已連結 …」. */
  repoName: string
  runInitialSync(onProgress: (p: InitialSyncProgress) => void): Promise<void>
  onFinished(): void
  /** Phone copy says 「這台 iPhone」. */
  deviceName?: string
}

type ItemState = 'done' | 'active' | 'todo'

export function FirstSync({ repoName, runInitialSync, onFinished, deviceName }: FirstSyncProps) {
  const [progress, setProgress] = useState<InitialSyncProgress>({ phase: 'list', done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const started = useRef<number | null>(null)
  const titleId = useId()

  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    // StrictMode mounts twice in dev; run each attempt only once.
    if (started.current === attempt) return
    started.current = attempt
    setError(null)
    setProgress({ phase: 'list', done: 0, total: 0 })
    runInitialSync((p) => mounted.current && setProgress(p)).then(
      () => mounted.current && setProgress((p) => ({ ...p, phase: 'done' })),
      (e: unknown) => mounted.current && setError(errorMessage(e)),
    )
    // runInitialSync is a stable dependency from the shell; a retry bumps `attempt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const { phase, done, total } = progress
  const finished = phase === 'done'
  const ratio = finished ? 1 : phase === 'index' ? 1 : phase === 'download' && total > 0 ? Math.min(1, done / total) : 0

  const items: { key: string; label: string; state: ItemState }[] = [
    { key: 'linked', label: t.setup.connectedTo(repoName), state: 'done' },
    { key: 'list', label: t.setup.readingList, state: phase === 'list' ? 'active' : 'done' },
    {
      key: 'download',
      label: t.setup.downloadingPages(done, total),
      state: phase === 'list' ? 'todo' : phase === 'download' ? 'active' : 'done',
    },
    { key: 'index', label: t.setup.buildingIndex, state: finished ? 'done' : phase === 'index' ? 'active' : 'todo' },
  ]

  const footer = (
    <Button variant="primary" size="lg" block disabled={!finished} onClick={onFinished}>
      {t.setup.startUsing}
    </Button>
  )

  return (
    <SetupPage step={3} footer={footer}>
      <h1 className="setup-title" id={titleId}>
        {t.setup.preparingTitle}
      </h1>
      <p className="setup-intro">
        {deviceName ? t.setup.preparingIntro.replace(t.setup.thisDevice, t.setup.thisNamedDevice(deviceName)) : t.setup.preparingIntro}
      </p>

      <div
        className="progress"
        role="progressbar"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <div className="progress-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="progress-label">{t.setup.downloading(done, total)}</p>

      <ul className="checklist">
        {items.map((it) => (
          <li key={it.key} className={cx('check-item', `is-${it.state}`)}>
            <span className="check-icon" aria-hidden="true">
              {it.state === 'done' ? (
                <Check size={16} strokeWidth={2.25} />
              ) : it.state === 'active' ? (
                <RefreshCw size={16} className="is-spinning" />
              ) : (
                <Circle size={15} />
              )}
            </span>
            <span>{it.label}</span>
          </li>
        ))}
      </ul>

      {error ? (
        <div className="callout is-error" role="alert">
          <span>
            {t.setup.syncFailed} · {error}
          </span>
          <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
            {t.common.retry}
          </Button>
        </div>
      ) : (
        <div className="callout">
          <Lightbulb size={16} aria-hidden="true" />
          <span>{t.setup.offlineReady}</span>
        </div>
      )}
    </SetupPage>
  )
}

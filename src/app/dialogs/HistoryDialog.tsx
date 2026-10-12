/** 頁面歷史 (SYNC-15, SYNC-16, D06 / M18). Needs the network (NFR-2). */
import { ChevronLeft, History } from 'lucide-react'
import type { Node as PMNode } from 'prosemirror-model'
import { useEffect, useMemo, useState } from 'react'
import { Editor } from '../../editor'
import type { CommitSummary } from '../../lib/github/client'
import { parseMarkdown, readPageMeta, splitPageFile } from '../../lib/markdown'
import { restoreVersionText } from '../../lib/workspace/ops'
import { t } from '../../strings/zh-TW'
import { Button, cx, Modal, Spinner } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { localChange } from '../actions'
import { historyTime } from '../format'
import { useIsMobile, usePage } from '../hooks'
import { closeOverlay } from '../overlays'
import { editorServices } from '../page/editorServices'
import { session } from '../session'
import './dialogs.css'

interface Version {
  commit: CommitSummary
  text?: string
}

export function HistoryDialog({ pageKey }: { pageKey: string }) {
  const page = usePage(pageKey)
  const mobile = useIsMobile()
  const [versions, setVersions] = useState<Version[]>([])
  const [pageNo, setPageNo] = useState(1)
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState(0)
  const [preview, setPreview] = useState<{ sha: string; text: string } | null>(null)
  const services = useMemo(() => editorServices(() => pageKey), [pageKey])
  const path = page?.path

  useEffect(() => {
    const s = session()
    if (!path || !s) return
    let alive = true
    setLoading(true)
    const { owner, repo } = s.workspace
    s.client
      .listCommits(owner, repo, path, pageNo)
      .then((commits) => {
        if (!alive) return
        setVersions((v) => [...v, ...commits.map((commit) => ({ commit }))])
        setMore(commits.length === 30)
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [path, pageNo])

  const current = versions[selected]
  useEffect(() => {
    const s = session()
    if (!current || !path || !s) return
    if (preview?.sha === current.commit.sha) return
    let alive = true
    const { owner, repo } = s.workspace
    s.client
      .getFileAt(owner, repo, path, current.commit.sha)
      .then((text) => alive && setPreview({ sha: current.commit.sha, text }))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [current, path, preview?.sha])

  const previewDoc: PMNode | null = useMemo(() => {
    if (!preview) return null
    try {
      return parseMarkdown(splitPageFile(preview.text).body)
    } catch {
      return null
    }
  }, [preview])
  const previewTitle = preview ? (readPageMeta(splitPageFile(preview.text).frontmatter).title ?? page?.title) : page?.title

  const restore = async () => {
    if (!preview || !page) return
    await restoreVersionText(page.key, preview.text)
    localChange()
    toast(t.toast.versionRestored)
    closeOverlay()
  }

  const list = (
    <div className="history-list">
      <div className="history-list-head">
        <div className="history-list-title">{t.history.versions}</div>
        <div className="history-list-hint">{t.history.versionsHint}</div>
      </div>
      <div className="history-rows" role="listbox" aria-label={t.history.versions}>
        {versions.map((v, i) => {
          const isFirst = i === versions.length - 1 && !more
          return (
            <button
              key={v.commit.sha}
              type="button"
              role="option"
              aria-selected={i === selected}
              className={cx('history-row', i === selected && 'is-selected')}
              onClick={() => setSelected(i)}
            >
              <span className="history-row-time">{historyTime(Date.parse(v.commit.date))}</span>
              <span className="history-row-sub">
                {isFirst ? t.history.created : [v.commit.authorLogin, v.commit.device?.split(' · ')[0] ?? t.history.githubVersion].filter(Boolean).join(' · ')}
              </span>
            </button>
          )
        })}
        {loading && (
          <div className="history-loading">
            <Spinner />
          </div>
        )}
        {error && <div className="history-error">{t.history.loadFailed}</div>}
        {!loading && more && versions.length > 0 && (
          <button type="button" className="history-more" onClick={() => setPageNo((n) => n + 1)}>
            {t.history.loadMore}
          </button>
        )}
        {!more && <div className="history-limit">{t.history.limitation}</div>}
      </div>
      <div className="history-actions">
        <Button onClick={closeOverlay}>{t.common.cancel}</Button>
        <Button variant="primary" disabled={!preview || selected === 0} onClick={() => void restore()}>
          {t.history.restoreVersion}
        </Button>
      </div>
    </div>
  )

  const previewPane = (
    <div className="history-preview">
      {current && (
        <div className="history-chip">
          <History size={14} />
          {t.history.viewing(historyTime(Date.parse(current.commit.date)))}
        </div>
      )}
      <h1 className="history-title">{previewTitle}</h1>
      {previewDoc ? (
        <Editor key={preview?.sha} doc={previewDoc} editable={false} services={services} onChange={() => undefined} />
      ) : (
        current && !error && <Spinner />
      )}
    </div>
  )

  if (mobile) {
    return (
      <div className="fullscreen-overlay history is-mobile" role="dialog" aria-modal="true" aria-label={t.history.title}>
        <header className="mobile-nav">
          <button type="button" className="mobile-nav-back" onClick={closeOverlay}>
            <ChevronLeft size={22} />
            {t.nav.back}
          </button>
          <h1 className="mobile-nav-title">{t.history.title}</h1>
          <span />
        </header>
        {previewPane}
        {list}
      </div>
    )
  }
  return (
    <Modal open onClose={closeOverlay} title={t.history.title} width={1040} className="history-modal">
      <div className="history">
        {previewPane}
        {list}
      </div>
    </Modal>
  )
}

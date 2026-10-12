/**
 * A page (D02 / M03): cover, icon, title, the block editor, backlinks.
 * Loading and saving (STORE-3): edits are written to `files.text` within 300 ms of the last
 * keystroke and before the page is left; remote changes are shown right away (SYNC-5 step 5).
 */
import { AlertTriangle, ImagePlus, Smile } from 'lucide-react'
import type { Node as PMNode } from 'prosemirror-model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor } from '../../editor'
import type { EditorHandle } from '../../editor/types'
import { PAGE_TEMPLATES, type PageTemplate } from '../../lib/data/templates'
import { parseMarkdown, serializeMarkdown, splitPageFile } from '../../lib/markdown'
import { schema } from '../../lib/schema'
import { mergeLines } from '../../lib/sync/merge'
import type { FileRow, PageRow } from '../../lib/types'
import { renamePage, savePageBody, setPageField } from '../../lib/workspace/ops'
import { t } from '../../strings/zh-TW'
import { cx, Popover } from '../../ui/primitives'
import { leavePage, localChange } from '../actions'
import { useFile, useIsMobile, useSyncState } from '../hooks'
import { openOverlay } from '../overlays'
import { PageIcon } from '../PageIcon'
import { followKey, navigate } from '../router'
import { registerFlusher, rememberRecent } from '../session'
import { resolveAttachment, uploadAttachment } from './assets'
import { editorServices } from './editorServices'
import { CoverPicker, EmojiPicker } from './EmojiPicker'
import { Backlinks } from './Backlinks'
import './page.css'

function bodyOf(file: FileRow | null | undefined): string {
  if (!file || file.deleted || file.text === null) return ''
  return splitPageFile(file.text).body
}

function safeParse(body: string): PMNode {
  try {
    return parseMarkdown(body)
  } catch (error) {
    console.error('parseMarkdown failed', error)
    return schema.node('doc', null, [schema.node('raw', null, body ? [schema.text(body)] : [])])
  }
}

function safeSerialize(doc: PMNode): string | null {
  try {
    return serializeMarkdown(doc)
  } catch (error) {
    console.error('serializeMarkdown failed', error)
    return null
  }
}

const normalize = (body: string) => body.replace(/\n+$/, '')

export function PageView({ page }: { page: PageRow }) {
  const file = useFile(page.virtual ? null : page.path)
  const sync = useSyncState()
  const mobile = useIsMobile()
  const readOnly = sync?.lastError?.kind === 'unauthorized'
  const loaded = useRef(false)
  const lastFile = useRef<FileRow | null>(null)
  if (file !== undefined) lastFile.current = file

  // Wait for the file row (unless the page is virtual) before mounting the editor; once mounted,
  // keep it mounted while a rename switches the row being watched.
  if (!page.virtual && file === undefined && !loaded.current) return <div className="page-loading" />
  loaded.current = true
  return <PageBody page={page} file={file === undefined ? lastFile.current : file} readOnly={readOnly} mobile={mobile} />
}

function PageBody({ page, file, readOnly, mobile }: { page: PageRow; file: FileRow | null; readOnly: boolean; mobile: boolean }) {
  const editorRef = useRef<EditorHandle>(null)
  const keyRef = useRef(page.key)
  keyRef.current = page.key
  /** The body as last loaded from or written to `files` (normalised). */
  const savedBody = useRef(normalize(bodyOf(file)))
  /** A document with unsaved changes, if any. */
  const pending = useRef<PMNode | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [initialDoc] = useState(() => safeParse(bodyOf(file)))
  const [isEmpty, setIsEmpty] = useState(() => normalize(bodyOf(file)) === '')
  const services = useMemo(() => editorServices(() => keyRef.current), [])

  const save = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const doc = pending.current
    if (!doc) return
    pending.current = null
    const body = safeSerialize(doc)
    if (body === null || normalize(body) === savedBody.current) return
    savedBody.current = normalize(body)
    const key = keyRef.current
    const newKey = await savePageBody(key, body)
    localChange()
    if (newKey !== key) followKey(key, newKey)
  }, [])

  // STORE-3 and SYNC-3: flush before syncs, on leave and when hidden.
  useEffect(() => {
    const unregister = registerFlusher(save)
    const onHide = () => {
      if (document.visibilityState === 'hidden') void save()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      unregister()
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      const key = keyRef.current
      void save().then(() => leavePage(key))
    }
  }, [save])

  useEffect(() => {
    void rememberRecent(page.key)
  }, [page.key])

  // SYNC-5 step 5: a pull or another tab changed the file.
  const fileBody = file && !file.deleted ? bodyOf(file) : null
  useEffect(() => {
    if (fileBody === null) return
    const remote = normalize(fileBody)
    if (remote === savedBody.current) return
    const handle = editorRef.current
    if (!handle) return
    if (!pending.current) {
      savedBody.current = remote
      handle.replaceDoc(safeParse(fileBody))
      setIsEmpty(remote === '')
      return
    }
    const ours = safeSerialize(pending.current)
    if (ours === null) return
    const merged = mergeLines(savedBody.current, normalize(ours), remote)
    savedBody.current = remote
    if (merged !== null) {
      pending.current = null
      handle.replaceDoc(safeParse(merged))
      if (merged !== remote) {
        pending.current = handle.getDoc()
        void save()
      }
    }
    // Overlapping typing: keep the editor as it is; the next save writes it over the remote text.
  }, [fileBody, save])

  const onChange = useCallback(
    (doc: PMNode) => {
      pending.current = doc
      setIsEmpty(doc.childCount === 1 && doc.firstChild!.isTextblock && doc.firstChild!.content.size === 0)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(), 300)
    },
    [save],
  )

  const isNew = !!file && file.baseSha === null
  const applyTemplate = (template: PageTemplate) => {
    if (template.body) {
      const doc = safeParse(template.body)
      editorRef.current?.setContent(doc)
      onChange(doc)
    }
    editorRef.current?.focus(template.body ? 'end' : 'start')
    // An untitled page takes the starter's title (UI-10).
    if (template.title && page.title === t.common.untitled) {
      const key = keyRef.current
      void renamePage(key, template.title).then((newKey) => {
        localChange()
        if (newKey !== key) followKey(key, newKey)
      })
    }
  }

  return (
    <article className={cx('page', mobile && 'is-mobile')}>
      <PageHeader page={page} readOnly={readOnly} mobile={mobile} onEnter={() => editorRef.current?.focus('start')} />
      {file?.conflict && (
        <div className="page-banner is-warning" role="status">
          <AlertTriangle size={16} />
          <span>{t.page.conflictBanner}</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => openOverlay({ kind: 'conflict', path: page.path })}>
            {t.page.resolveConflict}
          </button>
        </div>
      )}
      {page.virtual && isEmpty && <p className="page-virtual-hint">{t.page.virtualPage}</p>}
      <div className="page-content">
        <Editor
          ref={editorRef}
          doc={initialDoc}
          editable={!readOnly && !file?.conflict}
          services={services}
          onChange={onChange}
          onExitTop={() => document.querySelector<HTMLTextAreaElement>('.page-title-input')?.focus()}
          placeholder={t.page.bodyPlaceholder}
          mobile={mobile}
        />
        {isNew && isEmpty && !readOnly && (
          <div className="page-starters" data-print="hide">
            <div className="page-starters-label">{t.page.startFrom}</div>
            {PAGE_TEMPLATES.map((template) => (
              <button key={template.id} type="button" className="page-starter" onClick={() => applyTemplate(template)}>
                <StarterIcon kind={template.id} />
                {template.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!page.virtual && <Backlinks path={page.path} />}
    </article>
  )
}

function StarterIcon({ kind }: { kind: 'blank' | 'todo' | 'meeting' }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'todo')
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
        <path d="m8 12 3 3 5-6" />
      </svg>
    )
  if (kind === 'meeting')
    return (
      <svg {...common} aria-hidden="true">
        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z" />
      </svg>
    )
  return (
    <svg {...common} aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  )
}

// --- Header: cover, icon, title ------------------------------------------------------------

function useCoverUrl(cover: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!cover || cover.startsWith('gradient:')) setUrl(null)
    else void resolveAttachment(cover).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [cover])
  return url
}

function PageHeader({ page, readOnly, mobile, onEnter }: { page: PageRow; readOnly: boolean; mobile: boolean; onEnter: () => void }) {
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null)
  const [coverAnchor, setCoverAnchor] = useState<HTMLElement | null>(null)
  const coverUrl = useCoverUrl(page.cover)
  const gradient = page.cover?.match(/^gradient:([1-8])$/)?.[1]

  const setField = async (field: 'icon' | 'cover', value: string | null) => {
    const key = page.key
    const newKey = await setPageField(key, field, value)
    localChange()
    if (newKey !== key) followKey(key, newKey)
  }

  return (
    <header className={cx('page-header', page.cover && 'has-cover', page.icon && 'has-icon')}>
      {page.cover && (
        <div
          className="page-cover"
          style={gradient ? { background: `var(--cover-${gradient})` } : coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined}
        >
          {!readOnly && (
            <div className="page-cover-actions" data-print="hide">
              <button type="button" className="page-cover-btn" onClick={(e) => setCoverAnchor(e.currentTarget)}>
                {t.page.changeCover}
              </button>
              <button type="button" className="page-cover-btn" onClick={() => void setField('cover', null)}>
                {t.page.removeCover}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="page-head-inner">
        {page.icon && (
          <button
            type="button"
            className="page-big-icon"
            onClick={(e) => !readOnly && setIconAnchor(e.currentTarget)}
            aria-label={t.page.addIcon}
            disabled={readOnly}
          >
            <PageIcon icon={page.icon} size={mobile ? 56 : 78} />
          </button>
        )}
        {!readOnly && (!page.icon || !page.cover) && (
          <div className="page-head-buttons" data-print="hide">
            {!page.icon && (
              <button type="button" className="page-head-btn" onClick={(e) => setIconAnchor(e.currentTarget)}>
                <Smile size={15} />
                {t.page.addIcon}
              </button>
            )}
            {!page.cover && (
              <button type="button" className="page-head-btn" onClick={() => void setField('cover', `gradient:${1 + Math.floor(Math.random() * 8)}`)}>
                <ImagePlus size={15} />
                {t.page.addCover}
              </button>
            )}
          </div>
        )}
        <TitleInput page={page} readOnly={readOnly} onEnter={onEnter} />
      </div>
      {iconAnchor && (
        <Popover anchor={iconAnchor} onClose={() => setIconAnchor(null)}>
          <EmojiPicker
            onPick={(emoji) => {
              setIconAnchor(null)
              void setField('icon', emoji)
            }}
            onRemove={
              page.icon
                ? () => {
                    setIconAnchor(null)
                    void setField('icon', null)
                  }
                : undefined
            }
          />
        </Popover>
      )}
      {coverAnchor && (
        <Popover anchor={coverAnchor} onClose={() => setCoverAnchor(null)} placement="bottom-end">
          <CoverPicker
            onPick={(cover) => {
              setCoverAnchor(null)
              void setField('cover', cover)
            }}
            onUpload={(file) => {
              setCoverAnchor(null)
              void uploadAttachment(file).then((r) => setField('cover', r.href))
            }}
            onRemove={() => {
              setCoverAnchor(null)
              void setField('cover', null)
            }}
          />
        </Popover>
      )}
    </header>
  )
}

function TitleInput({ page, readOnly, onEnter }: { page: PageRow; readOnly: boolean; onEnter: () => void }) {
  const initial = page.title === t.common.untitled ? '' : page.title
  const [value, setValue] = useState(initial)
  /** The latest typed value and whether the user changed it since the last commit. */
  const typed = useRef({ value: initial, dirty: false })
  const focused = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageRef = useRef(page)
  pageRef.current = page

  // Follow renames from elsewhere while not editing.
  useEffect(() => {
    if (focused.current || typed.current.dirty) return
    const next = page.title === t.common.untitled ? '' : page.title
    typed.current.value = next
    setValue(next)
  }, [page.title])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Firefox reports scrollHeight 0 for an empty textarea at height 0; never go below one line (CSS min-height).
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  // A new page starts with the caret in the title (D11).
  useEffect(() => {
    if (page.title === t.common.untitled && !readOnly) ref.current?.focus()
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Uses only refs, never the DOM: it also runs on unmount, after React has detached `ref`.
  const commit = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!typed.current.dirty) return
    typed.current.dirty = false
    const current = pageRef.current
    const title = typed.current.value.replace(/\s*\n\s*/g, ' ')
    const effective = title.trim() === '' ? t.common.untitled : title
    if (effective === current.title) return
    const newKey = await renamePage(current.key, effective)
    localChange()
    if (newKey !== current.key) followKey(current.key, newKey)
  }, [])

  useEffect(() => () => void commit(), [commit])

  return (
    <textarea
      ref={ref}
      className="page-title-input"
      value={value}
      rows={1}
      placeholder={t.page.titlePlaceholder}
      readOnly={readOnly}
      aria-label={t.page.titlePlaceholder}
      spellCheck={false}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        void commit()
      }}
      onChange={(e) => {
        const next = e.target.value.replace(/\n/g, '')
        typed.current = { value: next, dirty: true }
        setValue(next)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void commit(), 1200)
      }}
      onKeyDown={(e) => {
        // UI-17: ignore Enter while an IME is composing.
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.preventDefault()
          void commit()
          onEnter()
        } else if (e.key === 'ArrowDown' && !e.nativeEvent.isComposing) {
          const el = e.currentTarget
          if (el.selectionStart === el.value.length) {
            e.preventDefault()
            onEnter()
          }
        }
      }}
    />
  )
}

/** A page route: resolves the key; `null` page → not found. */
export function PageNotFound() {
  return (
    <div className="page-not-found">
      <h1>{t.page.notFound}</h1>
      <p>{t.page.notFoundHint}</p>
      <button type="button" className="btn btn-secondary" onClick={() => navigate({ name: 'home' })}>
        {t.page.goHome}
      </button>
    </div>
  )
}

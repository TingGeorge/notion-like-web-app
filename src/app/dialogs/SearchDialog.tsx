/** Search (UI-9, D05 / M07): ⌘K or ⌘P; title > headings > body; filters; Enter / ⌘Enter. */
import { ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { shortcutLabel } from '../../lib/data/device'
import type { SearchResult } from '../../lib/search'
import { getSearchIndex } from '../../lib/workspace/indexer'
import { t } from '../../strings/zh-TW'
import { cx, Kbd, Menu, Modal, Popover } from '../../ui/primitives'
import { pagesCache, useIsMobile, usePages, useUi } from '../hooks'
import { closeOverlay } from '../overlays'
import { PageIcon } from '../PageIcon'
import { navigate, pageHash } from '../router'
import './dialogs.css'

type DateFilter = 'any' | '7' | '30'

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (!ranges.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let at = 0
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (s < at) continue
    if (s > at) parts.push(text.slice(at, s))
    parts.push(<mark key={s}>{text.slice(s, e)}</mark>)
    at = e
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

function parentTitle(key: string): string | null {
  const page = pagesCache.byKey.get(key)
  const parent = page?.parentKey ? pagesCache.byKey.get(page.parentKey) : undefined
  return parent?.title ?? null
}

export function SearchDialog({ initialQuery = '' }: { initialQuery?: string }) {
  const mobile = useIsMobile()
  const pages = usePages()
  const [ui] = useUi()
  const [query, setQuery] = useState(initialQuery)
  const [titleOnly, setTitleOnly] = useState(false)
  const [sort, setSort] = useState<'relevance' | 'recent'>('relevance')
  const [date, setDate] = useState<DateFilter>('any')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const [menu, setMenu] = useState<{ kind: 'sort' | 'date'; anchor: HTMLElement } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    void getSearchIndex().then((index) => {
      if (!alive) return
      const since = date === 'any' ? null : Date.now() - Number(date) * 86_400_000
      setResults(index.search(q, { titleOnly, sort, since, limit: 50 }))
      setSelected(0)
    })
    return () => {
      alive = false
    }
  }, [query, titleOnly, sort, date])

  const recent = useMemo(
    () =>
      ui.recent
        .map((k) => pages.find((p) => p.key === k))
        .filter((p) => !!p)
        .slice(0, 8),
    [ui.recent, pages],
  )

  const rows: { key: string; title: string; icon: string | null; titleRanges: [number, number][]; parent: string | null; snippet: React.ReactNode }[] =
    query.trim()
      ? results.map((r) => ({
          key: r.key,
          title: r.title,
          icon: pagesCache.byKey.get(r.key)?.icon ?? null,
          titleRanges: r.titleHighlights,
          parent: parentTitle(r.key),
          snippet: r.snippet.text ? <Highlighted text={r.snippet.text} ranges={r.snippet.highlights} /> : null,
        }))
      : recent.map((p) => ({ key: p!.key, title: p!.title, icon: p!.icon, titleRanges: [], parent: parentTitle(p!.key), snippet: null }))

  const open = (key: string, newTab: boolean) => {
    if (newTab) {
      window.open(`${location.pathname}${pageHash(key)}`, '_blank', 'noopener')
      return
    }
    closeOverlay()
    navigate({ name: 'page', key })
  }

  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(rows.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter' && rows[selected]) {
      e.preventDefault()
      open(rows[selected].key, e.metaKey || e.ctrlKey)
    }
  }

  const sortLabel = sort === 'relevance' ? t.search.sortRelevance : t.search.sortRecent
  const dateLabel = date === 'any' ? t.search.date : date === '7' ? t.search.date7 : t.search.date30

  const body = (
    <div className={cx('search', mobile && 'is-mobile')} onKeyDown={onKeyDown}>
      <div className="search-input-row">
        <Search size={18} className="search-icon" />
        <input
          ref={inputRef}
          autoFocus
          data-autofocus
          className="search-input"
          value={query}
          placeholder={t.search.placeholder}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t.search.placeholder}
          enterKeyHint="search"
        />
        {mobile ? (
          <>
            {query && (
              <button type="button" className="search-clear" aria-label={t.common.close} onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
            <button type="button" className="search-cancel" onClick={closeOverlay}>
              {t.common.cancel}
            </button>
          </>
        ) : (
          <Kbd>esc</Kbd>
        )}
      </div>
      <div className="search-filters">
        {mobile && (
          <button type="button" className={cx('chip', !titleOnly && date === 'any' && 'is-active')} onClick={() => (setTitleOnly(false), setDate('any'))}>
            {t.search.all}
          </button>
        )}
        <button type="button" className={cx('chip', titleOnly && 'is-active')} onClick={() => setTitleOnly((v) => !v)} aria-pressed={titleOnly}>
          {t.search.titleOnly}
          {!mobile && <ChevronDown size={13} />}
        </button>
        {mobile ? (
          <button type="button" className={cx('chip', date === '7' && 'is-active')} onClick={() => setDate((d) => (d === '7' ? 'any' : '7'))}>
            {t.search.date7}
          </button>
        ) : (
          <>
            <button type="button" className={cx('chip', sort !== 'relevance' && 'is-active')} onClick={(e) => setMenu({ kind: 'sort', anchor: e.currentTarget })}>
              {t.search.sortLabel(sortLabel)}
              <ChevronDown size={13} />
            </button>
            <button type="button" className={cx('chip', date !== 'any' && 'is-active')} onClick={(e) => setMenu({ kind: 'date', anchor: e.currentTarget })}>
              {dateLabel}
              <ChevronDown size={13} />
            </button>
          </>
        )}
      </div>
      <div className="search-results" ref={listRef} role="listbox" aria-label={t.search.pages}>
        {rows.length > 0 && <div className="search-section">{query.trim() ? t.search.pages : t.search.recent}</div>}
        {rows.map((row, i) => (
          <button
            key={row.key}
            type="button"
            role="option"
            aria-selected={i === selected}
            className={cx('search-row', i === selected && 'is-selected')}
            onMouseMove={() => setSelected(i)}
            onClick={(e) => open(row.key, e.metaKey || e.ctrlKey)}
          >
            <PageIcon icon={row.icon} size={24} />
            <span className="search-row-text">
              <span className="search-row-title">
                <Highlighted text={row.title} ranges={row.titleRanges} />
              </span>
              {mobile ? (
                // M07: where the page is (頁面 at the top level), then one line of the match.
                <>
                  <span className="search-row-parent">{row.parent ?? t.search.pages}</span>
                  {row.snippet ? <span className="search-row-sub">{row.snippet}</span> : null}
                </>
              ) : row.parent || row.snippet ? (
                <span className="search-row-sub">
                  {row.parent && row.snippet ? `${row.parent} · ` : row.parent}
                  {row.snippet}
                </span>
              ) : null}
            </span>
            {!mobile && i === selected && <span className="search-row-enter">Enter</span>}
          </button>
        ))}
        {query.trim() && rows.length === 0 && <div className="search-empty">{t.search.noResults}</div>}
      </div>
      {!mobile && (
        <div className="search-footer">
          <span>{shortcutLabel(t.search.footer)}</span>
          <span>{t.search.chineseOk}</span>
        </div>
      )}
      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)}>
          <Menu
            onClose={() => setMenu(null)}
            items={
              menu.kind === 'sort'
                ? [
                    { key: 'r', label: t.search.sortRelevance, checked: sort === 'relevance', onSelect: () => setSort('relevance') },
                    { key: 'n', label: t.search.sortRecent, checked: sort === 'recent', onSelect: () => setSort('recent') },
                  ]
                : [
                    { key: 'a', label: t.search.dateAny, checked: date === 'any', onSelect: () => setDate('any') },
                    { key: '7', label: t.search.date7, checked: date === '7', onSelect: () => setDate('7') },
                    { key: '30', label: t.search.date30, checked: date === '30', onSelect: () => setDate('30') },
                  ]
            }
          />
        </Popover>
      )}
    </div>
  )

  if (mobile) {
    return (
      <div className="fullscreen-overlay with-tabbar" role="dialog" aria-modal="true" aria-label={t.search.placeholder}>
        {body}
      </div>
    )
  }
  return (
    <Modal open onClose={closeOverlay} title={t.nav.search} width={640} top className="search-modal">
      {body}
    </Modal>
  )
}

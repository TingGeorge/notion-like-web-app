/**
 * The page tree (UI-1 desktop sidebar, M05 iPhone 所有頁面): expand/collapse, hover `…` and `+`,
 * drag to reorder, drop onto the middle of a row to make the page its child.
 */
import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { useState, type DragEvent, type MouseEvent } from 'react'
import type { PageRow } from '../../lib/types'
import { t } from '../../strings'
import { cx } from '../../ui/primitives'
import { moveTo, newPage } from '../actions'
import { openOverlay } from '../overlays'
import { PageIcon } from '../PageIcon'
import { navigate, pageHash } from '../router'
import type { PageTree as Tree } from '../../lib/data/tree'

const DRAG_TYPE = 'application/x-github-notes-page'

/** NFR-3: ↑/↓ move between rows, → expands, ← collapses (or goes to the parent row). */
function onTreeKey(e: React.KeyboardEvent<HTMLAnchorElement>, open: boolean, toggle: () => void) {
  const links = Array.from(e.currentTarget.closest('.page-tree')?.querySelectorAll<HTMLAnchorElement>('.tree-link') ?? [])
  const i = links.indexOf(e.currentTarget)
  if (e.key === 'ArrowDown' && i < links.length - 1) links[i + 1].focus()
  else if (e.key === 'ArrowUp' && i > 0) links[i - 1].focus()
  else if (e.key === 'ArrowRight' && !open) toggle()
  else if (e.key === 'ArrowLeft') {
    if (open) toggle()
    else e.currentTarget.closest('ul[role=group]')?.closest('li')?.querySelector<HTMLAnchorElement>('.tree-link')?.focus()
  } else return
  e.preventDefault()
}

type DropZone = 'before' | 'inside' | 'after'

interface Props {
  tree: Tree
  /** Rows to show at the top level (the whole tree, or the favourites). */
  roots: PageRow[]
  currentKey: string | null
  expanded: Set<string>
  onToggle: (key: string) => void
  variant?: 'sidebar' | 'mobile'
  /** Favourites are not reorderable by drag. */
  draggable?: boolean
  idPrefix?: string
}

export function PageTree({ tree, roots, currentKey, expanded, onToggle, variant = 'sidebar', draggable = true, idPrefix = 'tree' }: Props) {
  const [drop, setDrop] = useState<{ key: string; zone: DropZone } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const onDragStart = (e: DragEvent, page: PageRow) => {
    e.dataTransfer.setData(DRAG_TYPE, page.key)
    e.dataTransfer.effectAllowed = 'move'
    setDragging(page.key)
  }

  const zoneFor = (e: DragEvent): DropZone => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
  }

  const onDragOver = (e: DragEvent, page: PageRow) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE) || dragging === page.key) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const zone = zoneFor(e)
    if (drop?.key !== page.key || drop.zone !== zone) setDrop({ key: page.key, zone })
  }

  const onDrop = (e: DragEvent, target: PageRow) => {
    e.preventDefault()
    const key = e.dataTransfer.getData(DRAG_TYPE)
    const zone = zoneFor(e)
    setDrop(null)
    setDragging(null)
    if (!key || key === target.key) return
    if (zone === 'inside') {
      void moveTo(key, target.key).catch(() => undefined)
      if (!expanded.has(target.key)) onToggle(target.key)
      return
    }
    const siblings = tree.childrenOf(target.parentKey)
    const without = siblings.filter((p) => p.key !== key)
    let index = without.findIndex((p) => p.key === target.key)
    if (zone === 'after') index += 1
    void moveTo(key, target.parentKey, Math.max(0, index)).catch(() => undefined)
  }

  const renderRows = (pages: PageRow[], depth: number): React.ReactNode =>
    pages.map((page) => {
      const children = tree.childrenOf(page.key)
      const open = expanded.has(page.key)
      const selected = page.key === currentKey
      return (
        <li key={page.key} role="treeitem" aria-expanded={open} aria-selected={selected} aria-level={depth + 1}>
          <div
            className={cx('tree-row', `is-${variant}`, selected && 'is-selected', drop?.key === page.key && `drop-${drop.zone}`, dragging === page.key && 'is-dragging')}
            style={{ paddingLeft: (variant === 'mobile' ? 4 : 8) + depth * (variant === 'mobile' ? 20 : 14) }}
            draggable={draggable}
            onDragStart={(e) => onDragStart(e, page)}
            onDragEnd={() => {
              setDragging(null)
              setDrop(null)
            }}
            onDragOver={draggable ? (e) => onDragOver(e, page) : undefined}
            onDragLeave={() => setDrop((d) => (d?.key === page.key ? null : d))}
            onDrop={draggable ? (e) => onDrop(e, page) : undefined}
            onContextMenu={(e: MouseEvent) => {
              e.preventDefault()
              openOverlay({ kind: 'page-menu', pageKey: page.key, anchor: new DOMRect(e.clientX, e.clientY, 0, 0) })
            }}
          >
            <button
              type="button"
              className={cx('tree-chevron', open && 'is-open')}
              aria-label={open ? t.nav.collapse : t.nav.expand}
              onClick={() => onToggle(page.key)}
              tabIndex={-1}
            >
              <ChevronRight size={variant === 'mobile' ? 18 : 16} strokeWidth={1.8} />
            </button>
            <a
              className="tree-link"
              href={pageHash(page.key)}
              onClick={(e) => {
                e.preventDefault()
                navigate({ name: 'page', key: page.key })
              }}
              onKeyDown={(e) => onTreeKey(e, open, () => onToggle(page.key))}
              id={`${idPrefix}-${page.key}`}
            >
              <PageIcon icon={page.icon} size={variant === 'mobile' ? 22 : 18} />
              <span className="tree-title">{page.title || t.common.untitled}</span>
            </a>
            <span className="tree-actions">
              <button
                type="button"
                className="tree-action"
                aria-label={t.nav.pageMenu}
                title={t.nav.pageMenu}
                onClick={(e) => openOverlay({ kind: 'page-menu', pageKey: page.key, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
              >
                <MoreHorizontal size={16} />
              </button>
              {variant === 'sidebar' && (
                <button
                  type="button"
                  className="tree-action"
                  aria-label={t.nav.addChild}
                  title={t.nav.addChild}
                  onClick={() => {
                    if (!open) onToggle(page.key)
                    void newPage(page.key)
                  }}
                >
                  <Plus size={16} />
                </button>
              )}
            </span>
          </div>
          {open &&
            (children.length > 0 ? (
              <ul role="group">{renderRows(children, depth + 1)}</ul>
            ) : (
              <div className="tree-empty" style={{ paddingLeft: (variant === 'mobile' ? 4 : 8) + (depth + 1) * (variant === 'mobile' ? 20 : 14) + 22 }}>
                {t.nav.noPages}
              </div>
            ))}
        </li>
      )
    })

  return (
    <ul className="page-tree" role="tree">
      {renderRows(roots, 0)}
    </ul>
  )
}

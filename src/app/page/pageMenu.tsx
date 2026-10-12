/** The page menu (UI-4 `…`, M08): the same items on desktop and iPhone. */
import { ArrowRightToLine, Copy, Download, History, Link2, Printer, Star, StarOff, Trash2 } from 'lucide-react'
import type { MenuItem } from '../../ui/primitives'
import { t } from '../../strings/zh-TW'
import { copyPageLink, duplicate, exportMarkdown, printPage, toggleFavorite, trashPage } from '../actions'
import { openOverlay } from '../overlays'

export function pageMenuItems(pageKey: string, isFavorite: boolean, currentKey: string | null, isVirtual = false): (MenuItem | 'separator')[] {
  const size = 17
  return [
    {
      key: 'fav',
      label: isFavorite ? t.page.unfavorite : t.page.favorite,
      icon: isFavorite ? <StarOff size={size} /> : <Star size={size} />,
      onSelect: () => void toggleFavorite(pageKey, !isFavorite),
    },
    { key: 'link', label: t.page.copyLink, icon: <Link2 size={size} />, onSelect: () => void copyPageLink(pageKey) },
    { key: 'dup', label: t.page.duplicate, icon: <Copy size={size} />, onSelect: () => void duplicate(pageKey) },
    {
      key: 'move',
      label: t.page.moveTo,
      icon: <ArrowRightToLine size={size} />,
      onSelect: () => openOverlay({ kind: 'move', pageKey }),
    },
    {
      key: 'history',
      label: t.page.history,
      icon: <History size={size} />,
      disabled: isVirtual,
      onSelect: () => openOverlay({ kind: 'history', pageKey }),
    },
    {
      key: 'export',
      label: t.page.exportMarkdown,
      icon: <Download size={size} />,
      disabled: isVirtual,
      onSelect: () => void exportMarkdown(pageKey),
    },
    { key: 'print', label: t.page.print, icon: <Printer size={size} />, onSelect: printPage },
    'separator',
    {
      key: 'delete',
      label: t.page.deletePage,
      icon: <Trash2 size={size} />,
      danger: true,
      onSelect: () => void trashPage(pageKey, currentKey),
    },
  ]
}

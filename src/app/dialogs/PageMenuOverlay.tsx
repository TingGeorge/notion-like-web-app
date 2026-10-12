/** The page menu: a popover on desktop (UI-4 `…`), a sheet on iPhone (M08). */
import { t } from '../../strings/zh-TW'
import { Menu, Popover, Sheet, cx } from '../../ui/primitives'
import { relativeTime } from '../format'
import { useFile, useIsMobile, usePage, useSettings } from '../hooks'
import { closeOverlay } from '../overlays'
import { PageIcon } from '../PageIcon'
import { pageMenuItems } from '../page/pageMenu'
import { useRoute } from '../router'
import { statusLabel, useSyncStatus } from '../layout/SyncStatus'
import './dialogs.css'

export function PageMenuOverlay({ pageKey, anchor }: { pageKey: string; anchor?: DOMRect }) {
  const page = usePage(pageKey)
  const file = useFile(page && !page.virtual ? page.path : null)
  const settings = useSettings()
  const mobile = useIsMobile()
  const route = useRoute()
  const status = useSyncStatus()
  if (!page) return null
  const currentKey = route.name === 'page' ? route.key : null
  const items = pageMenuItems(page.key, settings.favorites.includes(page.key), currentKey, page.virtual)

  if (mobile) {
    const normal = items.filter((i) => i !== 'separator' && !i.danger)
    const danger = items.filter((i) => i !== 'separator' && i.danger)
    return (
      <Sheet open onClose={closeOverlay} title={page.title} showTitle={false} className="page-menu-sheet">
        <div className="page-menu-head">
          <PageIcon icon={page.icon} size={32} />
          <div>
            <div className="page-menu-title">{page.title}</div>
            <div className="page-menu-sub">
              {file ? t.page.lastEdited(relativeTime(file.updatedAt)) : ''} · {statusLabel(status)}
            </div>
          </div>
        </div>
        {[normal, danger].map((group, gi) => (
          <div key={gi} className="sheet-group">
            {group.map(
              (item) =>
                item !== 'separator' && (
                  <button
                    key={item.key}
                    type="button"
                    className={cx('sheet-row', item.danger && 'is-danger')}
                    disabled={item.disabled}
                    onClick={() => {
                      closeOverlay()
                      item.onSelect()
                    }}
                  >
                    <span className="sheet-row-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ),
            )}
          </div>
        ))}
      </Sheet>
    )
  }
  return (
    <Popover anchor={anchor ?? null} onClose={closeOverlay} placement="bottom-end">
      <Menu items={items} onClose={closeOverlay} />
    </Popover>
  )
}

import { LinkDeviceDialog } from './link/LinkDeviceDialog'
import { ConflictDialog } from './dialogs/ConflictDialog'
import { HistoryDialog } from './dialogs/HistoryDialog'
import { MoveDialog } from './dialogs/MoveDialog'
import { PageMenuOverlay } from './dialogs/PageMenuOverlay'
import { SearchDialog } from './dialogs/SearchDialog'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { TrashPanel } from './dialogs/TrashPanel'
import { closeOverlay, useOverlay } from './overlays'
import { session } from './session'

export function OverlayHost() {
  const overlay = useOverlay()
  if (!overlay) return null
  switch (overlay.kind) {
    case 'search':
      return <SearchDialog initialQuery={overlay.query} />
    case 'settings':
      return <SettingsDialog section={overlay.section} />
    case 'history':
      return <HistoryDialog pageKey={overlay.pageKey} />
    case 'move':
      return <MoveDialog pageKey={overlay.pageKey} />
    case 'trash':
      return <TrashPanel anchor={overlay.anchor} />
    case 'conflict':
      return <ConflictDialog path={overlay.path} />
    case 'page-menu':
      return <PageMenuOverlay pageKey={overlay.pageKey} anchor={overlay.anchor} />
    case 'link-device': {
      const s = session()
      return s ? <LinkDeviceDialog open onClose={closeOverlay} workspace={s.workspace} /> : null
    }
  }
}

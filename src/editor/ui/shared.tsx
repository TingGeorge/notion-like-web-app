import { createContext, useContext, useEffect, useReducer, useSyncExternalStore } from 'react'
import {
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  Link as LinkIcon,
  List,
  ListOrdered,
  Image as ImageIcon,
  Minus,
  Paperclip,
  Play,
  Quote,
  SquareCheck,
  Table as TableIcon,
  Type,
  type LucideIcon,
} from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import type { EditorContext, UIState } from '../context'
import type { InsertItemId } from '../slash'

export interface EditorUI {
  view: EditorView
  ctx: EditorContext
  mobile: boolean
}

export const EditorUIContext = createContext<EditorUI | null>(null)

export function useEditorUI(): EditorUI {
  const v = useContext(EditorUIContext)
  if (!v) throw new Error('EditorUIContext missing')
  return v
}

export function useUIState(ctx: EditorContext): UIState {
  return useSyncExternalStore(ctx.ui.subscribe, ctx.ui.getSnapshot)
}

/** Re-render when anything scrolls or the viewport changes (floating UI follows the text). */
export function useViewportTick(active = true) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(bump)
    }
    window.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    const vv = window.visualViewport
    vv?.addEventListener('resize', on)
    vv?.addEventListener('scroll', on)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
      vv?.removeEventListener('resize', on)
      vv?.removeEventListener('scroll', on)
    }
  }, [active])
}

export const ITEM_ICONS: Record<InsertItemId, LucideIcon> = {
  text: Type,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  number: ListOrdered,
  todo: SquareCheck,
  toggle: Play,
  quote: Quote,
  callout: Lightbulb,
  divider: Minus,
  code: Code,
  table: TableIcon,
  image: ImageIcon,
  file: Paperclip,
  link: LinkIcon,
  page: FileText,
}

/** Keep the editor focused when a toolbar button is pressed. */
export function keepFocus(e: { preventDefault(): void }) {
  e.preventDefault()
}

export function visibleViewport() {
  const vv = window.visualViewport
  return {
    top: vv?.offsetTop ?? 0,
    left: vv?.offsetLeft ?? 0,
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  }
}

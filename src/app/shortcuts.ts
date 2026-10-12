/**
 * App-level keyboard shortcuts (§7.1). On Windows and Linux ⌘ is Ctrl; ⌘⌥N is Ctrl+Alt+N.
 * Shortcuts with ⌥ are matched on `event.code` because ⌥ changes `event.key` on a Mac.
 */
import { useEffect } from 'react'
import { isApplePlatform } from '../lib/data/device'
import type { ThemePref } from '../lib/types'
import { newPage } from './actions'
import { closeOverlay, openOverlay } from './overlays'
import { loadUi, updateUi } from './session'

export function effectiveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** D09: follow `prefers-color-scheme` unless overridden in settings. */
export function useTheme(pref: ThemePref): void {
  useEffect(() => {
    const apply = () => {
      const theme = effectiveTheme(pref)
      document.documentElement.dataset.theme = theme
      for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
        if (pref === 'system') meta.content = meta.media.includes('dark') ? '#191919' : '#ffffff'
        else meta.content = theme === 'dark' ? '#191919' : '#ffffff'
      }
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [pref])
}

function hasSelection(): boolean {
  const sel = window.getSelection()
  return !!sel && !sel.isCollapsed && sel.toString().length > 0
}

export function useGlobalShortcuts(enabled: boolean, toggleSidebar: () => void): void {
  useEffect(() => {
    if (!enabled) return
    const apple = isApplePlatform()
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return
      const mod = apple ? e.metaKey : e.ctrlKey
      if (!mod) return
      // ⌘⌥N (Ctrl+Alt+N): new page.
      if (e.altKey && e.code === 'KeyN') {
        e.preventDefault()
        closeOverlay()
        void newPage()
        return
      }
      if (e.altKey) return
      const key = e.key.toLowerCase()
      if ((key === 'k' && !hasSelection()) || (key === 'p' && !e.shiftKey)) {
        // ⌘K with no selection, or ⌘P (UI-9, UI-16: ⌘P stays bound to search).
        e.preventDefault()
        openOverlay({ kind: 'search' })
      } else if (e.code === 'Backslash') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.shiftKey && e.code === 'KeyL') {
        e.preventDefault()
        void loadUi().then((ui) => updateUi({ theme: effectiveTheme(ui.theme) === 'dark' ? 'light' : 'dark' }))
      } else if (e.code === 'BracketLeft' && !e.shiftKey) {
        e.preventDefault()
        history.back()
      } else if (e.code === 'BracketRight' && !e.shiftKey) {
        e.preventDefault()
        history.forward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, toggleSidebar])
}

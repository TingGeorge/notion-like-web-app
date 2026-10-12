/**
 * UI-14: when a new app version is ready, show 「有新版本 · 重新整理」. The app never reloads
 * by itself; reloading first flushes the open editors so no edit is lost.
 */
import { useSyncExternalStore } from 'react'
import { flushEditors } from './session'

let ready = false
let update: ((reload?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const { registerSW } = await import('virtual:pwa-register')
  update = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true
      listeners.forEach((l) => l())
    },
  })
}

export async function applyUpdate(): Promise<void> {
  await flushEditors()
  if (update) await update(true)
  else location.reload()
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => ready,
  )
}

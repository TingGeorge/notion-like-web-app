/**
 * Whether a pull or push is running right now (SYNC-11 「同步中…」). The sync engine reports it;
 * other tabs learn it through the shared `sync` table's timestamps only, so this is per tab.
 */
import { useSyncExternalStore } from 'react'

let active = 0
const listeners = new Set<() => void>()

export function setSyncing(on: boolean): void {
  active = Math.max(0, active + (on ? 1 : -1))
  listeners.forEach((l) => l())
}

export function useSyncing(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => active > 0,
  )
}

import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 639.98px)'

function subscribe(listener: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', listener)
  return () => mq.removeEventListener('change', listener)
}

function getSnapshot() {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

/** The layout switches to the iPhone design below ~640 px wide. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

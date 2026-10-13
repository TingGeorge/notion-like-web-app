/**
 * ARCH-2: hash routing, so GitHub Pages never returns 404 for deep links.
 *   #/                    home
 *   #/p/<pageKey>         page
 *   #/search?q=           search
 *   #/settings/<section>  settings
 *   #/setup/<step>        setup
 *   #/link                link a device
 */
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'page'; key: string }
  | { name: 'search'; q: string }
  | { name: 'settings'; section: string | null }
  | { name: 'setup'; step: string | null }
  | { name: 'link' }
  | { name: 'pages' }
  | { name: 'trash' }
  | { name: 'not-found'; hash: string }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  const params = new URLSearchParams(query)
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'home' }
  const [head, ...rest] = parts
  switch (head) {
    case 'p':
      if (rest.length === 0) return { name: 'home' }
      return { name: 'page', key: safeDecode(rest.join('/')) }
    case 'search':
      return { name: 'search', q: params.get('q') ?? '' }
    case 'settings':
      return { name: 'settings', section: rest[0] ?? null }
    case 'setup':
      return { name: 'setup', step: rest[0] ?? null }
    case 'link':
      return { name: 'link' }
    case 'pages':
      return { name: 'pages' }
    case 'trash':
      return { name: 'trash' }
    default:
      return { name: 'not-found', hash: raw }
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function pageHash(key: string): string {
  return `#/p/${encodeURIComponent(key)}`
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'page':
      return pageHash(route.key)
    case 'search':
      return route.q ? `#/search?q=${encodeURIComponent(route.q)}` : '#/search'
    case 'settings':
      return route.section ? `#/settings/${route.section}` : '#/settings'
    case 'setup':
      return route.step ? `#/setup/${route.step}` : '#/setup'
    case 'link':
      return '#/link'
    case 'pages':
      return '#/pages'
    case 'trash':
      return '#/trash'
    case 'not-found':
      return `#${route.hash}`
  }
}

export function navigate(to: Route | string, options: { replace?: boolean } = {}): void {
  const hash = typeof to === 'string' ? to : hrefFor(to)
  if (options.replace) {
    history.replaceState(history.state, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    location.hash = hash
  }
}

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

// useSyncExternalStore needs the same object back while the hash is unchanged, including the empty
// hash of the bare app URL; a fresh object every call re-renders forever (React error #185).
let cachedHash: string | null = null
let cachedRoute: Route = { name: 'home' }

function getRoute(): Route {
  if (location.hash !== cachedHash) {
    cachedHash = location.hash
    cachedRoute = parseHash(location.hash)
  }
  return cachedRoute
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute)
}

/**
 * A page's key changed under the open view (it received an id, DATA-9). Replace the URL without
 * remounting the page, so the editor keeps its caret.
 */
const follows = new Map<string, string>()

export function followKey(from: string, to: string): void {
  if (from === to) return
  follows.set(to, from)
  const route = parseHash(location.hash)
  if (route.name === 'page' && route.key === from) navigate({ name: 'page', key: to }, { replace: true })
}

/** True when `to` replaced `from` through `followKey`. */
export function isFollow(from: string, to: string): boolean {
  return follows.get(to) === from
}

/**
 * Links and attachments: what a click on a link means (UI-5), which hrefs are allowed, and the
 * download of file blocks (SEC-5).
 */
import type { EditorContext } from './context'

export type HrefKind = 'page' | 'external' | 'asset' | 'unsafe'

export function classifyHref(href: string): HrefKind {
  const h = href.trim()
  if (/^\/(?!\/)/.test(h)) {
    const path = h.split('#')[0].split('?')[0]
    return /\.md$/i.test(path) ? 'page' : 'asset'
  }
  if (/^(https?:\/\/|mailto:)/i.test(h)) return 'external'
  return 'unsafe'
}

/**
 * What the link field produced, as a stored href: root-relative paths, `http(s)` and `mailto`
 * links only. Bare domains get `https://`. Null for anything else (`javascript:` and friends).
 */
export function normalizeLinkInput(input: string): string | null {
  const v = input.trim()
  if (!v || /\s/.test(v)) return null
  if (/^\/(?!\/)/.test(v)) return v
  if (/^https?:\/\//i.test(v)) {
    try {
      return new URL(v).protocol.startsWith('http') ? v : null
    } catch {
      return null
    }
  }
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return v
  if (/^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(v)) return `mailto:${v}`
  if (/^(www\.)?[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?([/?#].*)?$/u.test(v)) return `https://${v}`
  return null
}

/** True when the pasted text is nothing but one URL. */
export function isSingleUrl(text: string): boolean {
  const v = text.trim()
  return /^https?:\/\/\S+$/i.test(v)
}

function clickAnchor(a: HTMLAnchorElement) {
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // Removed on the next tick so the browser has started the navigation or download.
  setTimeout(() => a.remove(), 0)
}

export function openExternal(href: string) {
  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  clickAnchor(a)
}

/** SEC-5: attachments are only ever downloaded, never navigated to. */
export async function downloadAsset(ctx: EditorContext, href: string, name: string): Promise<boolean> {
  const url = await ctx.assets.get(href)
  if (!url) return false
  const a = document.createElement('a')
  a.href = url
  a.download = name || decodeURIComponent(href.split('/').pop() ?? 'file')
  a.type = 'application/octet-stream'
  a.rel = 'noopener'
  clickAnchor(a)
  return true
}

/** UI-5: open a link from the editor. */
export function openLink(ctx: EditorContext, href: string, text = '') {
  switch (classifyHref(href)) {
    case 'page':
      ctx.services().openPage(href)
      break
    case 'external':
      openExternal(href)
      break
    case 'asset':
      void downloadAsset(ctx, href, text)
      break
    default:
      break
  }
}

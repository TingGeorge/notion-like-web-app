/**
 * DATA-17: internal links and attachment paths are root-relative (start with `/`).
 * In paths, these characters are percent-encoded: space % ( ) < > # ? [ ]. Everything else,
 * including Chinese, stays as it is.
 */
import { dirname } from './names'

const MUST_ENCODE = /[ %()<>#?[\]]/g

/** Repo path → root-relative href. `工作/專案 A.md` → `/工作/專案%20A.md`. */
export function encodeLinkPath(repoPath: string): string {
  return `/${repoPath.replace(MUST_ENCODE, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)}`
}

/** True for `https:`, `mailto:`, `//host` and other links that leave the repo. */
export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')
}

function safeDecode(s: string): string {
  // Decode valid %XX sequences only; leave stray `%` alone.
  return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (seq) => {
    try {
      return decodeURIComponent(seq)
    } catch {
      return seq
    }
  })
}

export interface ParsedHref {
  /** Repo path without a leading slash, decoded. */
  path: string
  /** The `#fragment` without `#`, or null. */
  fragment: string | null
}

/**
 * Root-relative href → repo path. Returns null for external links, `#anchors` and empty hrefs.
 * Relative hrefs (common in existing repos) are resolved against `fromPath`'s folder when given.
 */
export function parseHref(href: string, fromPath?: string): ParsedHref | null {
  const raw = href.trim()
  if (!raw || raw.startsWith('#') || isExternalHref(raw)) return null
  const hashAt = raw.indexOf('#')
  const beforeHash = hashAt === -1 ? raw : raw.slice(0, hashAt)
  const fragment = hashAt === -1 ? null : safeDecode(raw.slice(hashAt + 1))
  const queryAt = beforeHash.indexOf('?')
  const pathPart = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)
  let path: string
  if (pathPart.startsWith('/')) {
    path = safeDecode(pathPart.slice(1))
  } else if (fromPath !== undefined) {
    path = normalize(`${dirname(fromPath)}/${safeDecode(pathPart)}`)
  } else {
    return null
  }
  path = normalize(path)
  if (!path) return null
  return { path, fragment }
}

/** Resolve `.` and `..` segments and drop empty ones. */
function normalize(path: string): string {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** Re-attach a fragment to an encoded href. */
export function withFragment(href: string, fragment: string | null): string {
  return fragment === null ? href : `${href}#${encodeURIComponent(fragment)}`
}

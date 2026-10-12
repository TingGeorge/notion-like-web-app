/**
 * DATA-17 for paths the sync engine moves on its own (SYNC-5): an unpushed local page renamed per
 * DATA-6 because the remote took its path (rule 5), unpushed pages that follow a folder moved on
 * another device, and pages moved on another device. Links this device added to those pages
 * (links that are not in the GitHub version of the linking page) are rewritten to the new path.
 * Links that are also in the GitHub version are the other side's business (its own move rewrote
 * them, and the three-way merge brings that in).
 */
import { basename } from '../data/names'
import { encodeLinkPath, parseHref, withFragment } from '../data/links'
import { joinPageFile, rewriteLinks, splitPageFile } from '../markdown'
import type { WorkingSet } from './working'

/** Root-relative link targets in a page body (decoded repo paths). */
function linkTargets(body: string, fromPath: string): Set<string> {
  const out = new Set<string>()
  try {
    rewriteLinks(body, (link) => {
      const parsed = parseHref(link.href, fromPath)
      if (parsed) out.add(parsed.path)
      return null
    })
  } catch {
    // An unparsable body has no links we could rewrite anyway.
  }
  return out
}

/** Rewrites links to `map`'s old paths in pages with local changes. Returns the paths it changed. */
export function rewriteLocalLinks(work: WorkingSet, map: Map<string, string>, now: number): string[] {
  if (map.size === 0) return []
  const needles = new Set<string>()
  for (const oldPath of map.keys()) {
    needles.add(basename(oldPath))
    needles.add(encodeLinkPath(basename(oldPath)).slice(1))
  }
  const changed: string[] = []
  for (const row of work.values()) {
    if (row.kind !== 'page' || row.deleted || row.conflict || row.text === null) continue
    if (row.baseSha !== null && row.text === row.baseText) continue
    const text = row.text
    if (![...needles].some((n) => text.includes(n))) continue
    const { frontmatter, body } = splitPageFile(text)
    const inBase = row.baseText !== null ? linkTargets(splitPageFile(row.baseText).body, row.path) : new Set<string>()
    let next: string
    try {
      next = rewriteLinks(body, (link) => {
        if (!link.href.trim().startsWith('/')) return null
        const parsed = parseHref(link.href, row.path)
        const to = parsed ? map.get(parsed.path) : undefined
        if (!parsed || to === undefined || inBase.has(parsed.path)) return null
        return { href: withFragment(encodeLinkPath(to), parsed.fragment) }
      })
    } catch {
      continue
    }
    if (next === body) continue
    work.put({ ...row, text: joinPageFile(frontmatter, next), dirty: true, updatedAt: now })
    changed.push(row.path)
  }
  return changed
}

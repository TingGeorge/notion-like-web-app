import { diff3Merge } from 'node-diff3'

/**
 * Three-way line merge for the open editor: a remote change arrived while the user still had
 * unsaved typing. Returns null when the changes overlap.
 */
export function mergeLines(base: string, ours: string, theirs: string): string | null {
  if (ours === base) return theirs
  if (theirs === base || theirs === ours) return ours
  const regions = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), { excludeFalseConflicts: true })
  const out: string[] = []
  for (const region of regions) {
    if (region.ok) out.push(...region.ok)
    else return null
  }
  return out.join('\n')
}

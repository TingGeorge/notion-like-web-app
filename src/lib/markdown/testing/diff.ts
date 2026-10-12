/** Test helper: describe where two documents first differ, briefly. */
import type { Node as PMNode } from 'prosemirror-model'

export function firstDifference(a: PMNode, b: PMNode, path = 'doc'): string | null {
  if (a.eq(b)) return null
  if (a.type !== b.type || !a.sameMarkup(b) || a.childCount !== b.childCount || a.isText) {
    return `${path}\n  expected: ${JSON.stringify(a.toJSON())}\n  actual:   ${JSON.stringify(b.toJSON())}`
  }
  for (let i = 0; i < a.childCount; i++) {
    const d = firstDifference(a.child(i), b.child(i), `${path}/${i}:${a.child(i).type.name}`)
    if (d) {
      // Report the enclosing textblock whole: inline differences are easier to read in context.
      if (a.isTextblock) {
        return `${path}\n  expected: ${JSON.stringify(a.toJSON())}\n  actual:   ${JSON.stringify(b.toJSON())}`
      }
      return d
    }
  }
  return `${path}\n  expected: ${JSON.stringify(a.toJSON())}\n  actual:   ${JSON.stringify(b.toJSON())}`
}

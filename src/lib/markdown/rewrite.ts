/**
 * DATA-17 `rewriteLinks`: change link and image destinations (and, for links alone in a
 * paragraph, optionally the link text) in a body, leaving every other byte as it is. Uses the
 * source offsets recorded while parsing, so links inside code, math and raw HTML (which are not
 * links) are never touched, and reference-style links are rewritten in their definition.
 */
import type { Nodes, Parents } from 'mdast'
import type { LinkRef } from './index'
import { destinationOf, parseTopLevel } from './mdast'
import { linkLabelMarkdown } from './serialize'

interface Edit {
  start: number
  end: number
  text: string
}

function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/** A destination written so that it reads back as `href`. */
export function formatDestination(href: string): string {
  if (href !== '' && !/[\s<>()\\&]/.test(href) && !hasControl(href)) return href
  const escaped = href
    .replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\')
    .replace(/[<>]/g, (c) => `\\${c}`)
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;')
  return `<${escaped}>`
}

function plainText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'inlineMath') return node.value
  if (node.type === 'image') return node.alt ?? ''
  if ('children' in node) return node.children.map((c) => plainText(c as Nodes)).join('')
  return ''
}

export function rewrite(body: string, map: (link: LinkRef) => { href: string; text?: string } | null): string {
  const edits: Edit[] = []

  const visit = (node: Nodes, parent: Parents | null, base: number): void => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
      const dest = destinationOf(node)
      if (dest && dest.start >= 0 && node.position) {
        const alone = node.type !== 'definition' && parent?.type === 'paragraph' && parent.children.length === 1
        const ref: LinkRef = {
          href: node.url,
          text: node.type === 'definition' ? (node.label ?? '') : plainText(node),
          alone,
          image: node.type === 'image',
        }
        const result = map(ref)
        if (result) {
          if (result.href !== node.url) {
            edits.push({ start: base + dest.start, end: base + dest.end, text: formatDestination(result.href) })
          }
          if (result.text !== undefined && result.text !== ref.text && alone && node.type === 'link' && dest.resourceStart > 0) {
            // The label sits between `[` and the `]` right before the resource's `(`.
            const labelStart = base + (node.position.start.offset ?? 0) + 1
            const labelEnd = base + dest.resourceStart - 1
            edits.push({ start: labelStart, end: labelEnd, text: linkLabelMarkdown(result.text) })
          }
        }
      }
    }
    if ('children' in node) {
      for (const child of node.children) visit(child as Nodes, node, base)
    }
  }

  for (const { node, base } of parseTopLevel(body, true)) visit(node, null, base)
  if (edits.length === 0) return body

  edits.sort((a, b) => a.start - b.start)
  let out = ''
  let pos = 0
  for (const e of edits) {
    if (e.start < pos) continue
    out += body.slice(pos, e.start) + e.text
    pos = e.end
  }
  return out + body.slice(pos)
}

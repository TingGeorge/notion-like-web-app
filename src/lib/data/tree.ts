/**
 * The sidebar page tree (DATA-21): pure functions over `PageRow[]` and the settings.
 *
 * Children listed in `settings.order[parentKey]` (root pages: `order.root`) come first, in that
 * order; the rest follow by title with `Intl.Collator('zh-TW')`. Everything is O(n log n).
 */
import type { NotesSettings, PageRow } from '../types'

export const ROOT_ORDER_KEY = 'root'

export interface TreeNode {
  page: PageRow
  children: TreeNode[]
}

const collator = new Intl.Collator('zh-TW', { numeric: true })

function compareTitle(a: PageRow, b: PageRow): number {
  return collator.compare(a.title, b.title) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

/** `listed` pages first in that order (unknown and repeated keys skipped), then the rest by title. */
function orderChildren(children: PageRow[], listed: readonly string[] | undefined): PageRow[] {
  if (children.length < 2) return children
  const byKey = new Map(children.map((p) => [p.key, p]))
  const out: PageRow[] = []
  const used = new Set<string>()
  for (const key of listed ?? []) {
    const page = byKey.get(key)
    if (page && !used.has(key)) {
      out.push(page)
      used.add(key)
    }
  }
  const rest = children.filter((p) => !used.has(p.key)).sort(compareTitle)
  return out.length ? out.concat(rest) : rest
}

export class PageTree {
  private readonly byKey: Map<string, PageRow>
  private readonly children = new Map<string | null, PageRow[]>()

  constructor(pages: readonly PageRow[], settings: Pick<NotesSettings, 'order' | 'favorites'>) {
    this.byKey = new Map(pages.map((p) => [p.key, p]))
    this.favoriteKeys = settings.favorites
    const groups = new Map<string | null, PageRow[]>()
    for (const page of this.byKey.values()) {
      // A page whose parent is missing (or itself) is shown at the top level.
      const parent = page.parentKey !== null && page.parentKey !== page.key && this.byKey.has(page.parentKey) ? page.parentKey : null
      let group = groups.get(parent)
      if (!group) groups.set(parent, (group = []))
      group.push(page)
    }
    for (const [parent, group] of groups) {
      this.children.set(parent, orderChildren(group, settings.order?.[parent ?? ROOT_ORDER_KEY]))
    }
  }

  private readonly favoriteKeys: readonly string[]

  get size(): number {
    return this.byKey.size
  }

  get(key: string): PageRow | undefined {
    return this.byKey.get(key)
  }

  has(key: string): boolean {
    return this.byKey.has(key)
  }

  /** Top-level pages, in order. */
  get roots(): PageRow[] {
    return this.childrenOf(null)
  }

  /** Direct children in display order; `null` is the top level. Unknown keys give an empty list. */
  childrenOf(key: string | null): PageRow[] {
    return this.children.get(key) ?? []
  }

  /** 我的最愛: favourites resolved to pages, in the saved order; missing and repeated keys skipped. */
  get favorites(): PageRow[] {
    const seen = new Set<string>()
    const out: PageRow[] = []
    for (const key of this.favoriteKeys) {
      const page = this.byKey.get(key)
      if (page && !seen.has(key)) {
        seen.add(key)
        out.push(page)
      }
    }
    return out
  }

  /** The breadcrumb: parents of a page, outermost first, without the page itself. */
  ancestors(key: string): PageRow[] {
    const out: PageRow[] = []
    const seen = new Set<string>([key])
    let page = this.byKey.get(key)
    while (page && page.parentKey !== null && !seen.has(page.parentKey)) {
      const parent = this.byKey.get(page.parentKey)
      if (!parent) break
      seen.add(parent.key)
      out.push(parent)
      page = parent
    }
    return out.reverse()
  }

  /** All pages below a page, depth first in display order, without the page itself. */
  descendants(key: string): PageRow[] {
    const out: PageRow[] = []
    const seen = new Set<string>([key])
    const walk = (parent: string) => {
      for (const child of this.childrenOf(parent)) {
        if (seen.has(child.key)) continue
        seen.add(child.key)
        out.push(child)
        walk(child.key)
      }
    }
    if (this.byKey.has(key)) walk(key)
    return out
  }

  /** True when `maybeDescendant` is `key` or lies below it (used to refuse moving a page into itself). */
  isInside(maybeDescendant: string, key: string): boolean {
    if (maybeDescendant === key) return true
    return this.ancestors(maybeDescendant).some((p) => p.key === key)
  }

  /** The whole tree as nested nodes. `expanded` limits the depth: only those pages' children are filled in. */
  nodes(expanded?: ReadonlySet<string>): TreeNode[] {
    const build = (page: PageRow, seen: Set<string>): TreeNode => {
      seen.add(page.key)
      const open = !expanded || expanded.has(page.key)
      const children = open ? this.childrenOf(page.key).filter((c) => !seen.has(c.key)).map((c) => build(c, seen)) : []
      return { page, children }
    }
    const seen = new Set<string>()
    return this.roots.map((p) => build(p, seen))
  }
}

export function buildTree(pages: readonly PageRow[], settings: Pick<NotesSettings, 'order' | 'favorites'>): PageTree {
  return new PageTree(pages, settings)
}

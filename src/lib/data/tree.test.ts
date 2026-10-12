import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type PageRow } from '../types'
import { buildTree } from './tree'

function page(key: string, title: string, parentKey: string | null = null): PageRow {
  return {
    key,
    path: `${title}.md`,
    title,
    icon: null,
    cover: null,
    parentKey,
    links: [],
    excerpt: '',
    updatedAt: 0,
    created: null,
    virtual: false,
    childCount: 0,
  }
}

const settings = (extra: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...extra })
const titles = (pages: PageRow[]) => pages.map((p) => p.title)

describe('buildTree (DATA-21)', () => {
  const pages = [
    page('1', '工作'),
    page('2', '生活'),
    page('3', 'Apple'),
    page('4', '會議記錄', '1'),
    page('5', '專案', '1'),
    page('6', '週報', '4'),
  ]

  it('sorts unlisted children by title with the zh-TW collator', () => {
    const tree = buildTree(pages, settings())
    expect(titles(tree.roots)).toEqual(['Apple', '工作', '生活'].sort(new Intl.Collator('zh-TW').compare))
    expect(titles(tree.childrenOf('1'))).toEqual(['專案', '會議記錄'].sort(new Intl.Collator('zh-TW').compare))
  })

  it('lists ordered children first, then the rest by title', () => {
    const tree = buildTree(
      pages,
      settings({ order: { root: ['2', 'missing', '2'], '1': ['4'] } }),
    )
    expect(tree.roots[0].key).toBe('2')
    expect(tree.roots).toHaveLength(3)
    expect(tree.childrenOf('1')[0].key).toBe('4')
    expect(tree.childrenOf('1')).toHaveLength(2)
  })

  it('resolves favourites, skipping missing pages', () => {
    const tree = buildTree(pages, settings({ favorites: ['6', 'gone', '1', '6'] }))
    expect(tree.favorites.map((p) => p.key)).toEqual(['6', '1'])
  })

  it('gives ancestors (outermost first) and descendants', () => {
    const tree = buildTree(pages, settings())
    expect(tree.ancestors('6').map((p) => p.key)).toEqual(['1', '4'])
    expect(tree.ancestors('1')).toEqual([])
    expect(tree.ancestors('nope')).toEqual([])
    expect(tree.descendants('1').map((p) => p.key).sort()).toEqual(['4', '5', '6'])
    expect(tree.descendants('6')).toEqual([])
    expect(tree.isInside('6', '1')).toBe(true)
    expect(tree.isInside('1', '6')).toBe(false)
    expect(tree.childrenOf('nope')).toEqual([])
  })

  it('shows pages with a missing parent at the top level, and survives cycles', () => {
    const tree = buildTree([page('a', 'A', 'ghost'), page('b', 'B', 'c'), page('c', 'C', 'b')], settings())
    expect(titles(tree.roots)).toEqual(['A'])
    expect(tree.ancestors('b').map((p) => p.key)).toEqual(['c'])
    expect(tree.descendants('b').map((p) => p.key)).toEqual(['c'])
  })

  it('builds nested nodes, limited to expanded pages', () => {
    const tree = buildTree(pages, settings({ order: { root: ['1'] } }))
    const all = tree.nodes()
    expect(all[0].page.key).toBe('1')
    expect(all[0].children.flatMap((c) => c.children).map((n) => n.page.key)).toEqual(['6'])
    const collapsed = tree.nodes(new Set())
    expect(collapsed[0].children).toEqual([])
    const some = tree.nodes(new Set(['1']))
    expect(some[0].children.every((c) => c.children.length === 0)).toBe(true)
  })

  it('handles 5,000 pages quickly', () => {
    const many: PageRow[] = []
    for (let i = 0; i < 5000; i++) many.push(page(`k${i}`, `頁面 ${i}`, i < 50 ? null : `k${i % 50}`))
    const t0 = performance.now()
    const tree = buildTree(many, settings())
    tree.nodes()
    tree.ancestors('k4999')
    tree.descendants('k0')
    expect(performance.now() - t0).toBeLessThan(500)
    expect(tree.roots).toHaveLength(50)
  })
})

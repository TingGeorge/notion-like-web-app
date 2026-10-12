import { encodeLinkPath, parseHref } from '../../lib/data/links'
import { createPage, getPage, savePageBody } from '../../lib/workspace/ops'
import { getSearchIndex } from '../../lib/workspace/indexer'
import { readText } from '../../lib/workspace/files'
import { splitPageFile } from '../../lib/markdown'
import type { EditorServices, PageRef } from '../../editor/types'
import type { PageRow } from '../../lib/types'
import { localChange } from '../actions'
import { pagesCache } from '../hooks'
import { navigate } from '../router'
import { loadUi, updateUi } from '../session'
import { resolveAttachment, uploadAttachment } from './assets'

function toRef(page: PageRow): PageRef {
  const parent = page.parentKey ? pagesCache.byKey.get(page.parentKey) : undefined
  return { href: encodeLinkPath(page.path), title: page.title, icon: page.icon, parentTitle: parent?.title ?? null }
}

let lastColor: string | null = null
void loadUi().then((ui) => (lastColor = ui.lastColor))

/** Services for the editor of the page `pageKey`. */
export function editorServices(getPageKey: () => string): EditorServices {
  return {
    uploadFile: uploadAttachment,
    resolveAsset: resolveAttachment,
    async createChildPage() {
      const key = await createPage({ parentKey: getPageKey() })
      localChange()
      const page = await getPage(key)
      if (!page) throw new Error('page not created')
      return toRef(page)
    },
    openPage(href) {
      const parsed = parseHref(href)
      if (!parsed) return
      const page = pagesCache.byPath.get(parsed.path)
      if (page) navigate({ name: 'page', key: page.key })
    },
    async searchPages(query) {
      const q = query.trim()
      if (!q) {
        const ui = await loadUi()
        const recent = ui.recent.map((k) => pagesCache.byKey.get(k)).filter((p): p is PageRow => !!p)
        const rest = pagesCache.all.filter((p) => !ui.recent.includes(p.key)).slice(0, 20)
        return [...recent, ...rest].slice(0, 20).map(toRef)
      }
      try {
        const index = await getSearchIndex()
        return index
          .search(q, { titleOnly: true, limit: 20 })
          .map((r) => pagesCache.byKey.get(r.key))
          .filter((p): p is PageRow => !!p)
          .map(toRef)
      } catch {
        const lower = q.toLowerCase()
        return pagesCache.all.filter((p) => p.title.toLowerCase().includes(lower)).slice(0, 20).map(toRef)
      }
    },
    pageInfo(href) {
      const parsed = parseHref(href)
      if (!parsed) return null
      const page = pagesCache.byPath.get(parsed.path)
      return page ? toRef(page) : null
    },
    async moveBlocksToPage(markdown, href) {
      const parsed = parseHref(href)
      const page = parsed ? pagesCache.byPath.get(parsed.path) : undefined
      if (!page) throw new Error('page not found')
      const text = page.virtual ? '' : ((await readText(page.path)) ?? '')
      const body = splitPageFile(text).body.replace(/\n+$/, '')
      await savePageBody(page.key, body ? `${body}\n\n${markdown}` : markdown)
      localChange()
    },
    getLastColor: () => lastColor,
    setLastColor(value) {
      lastColor = value
      void updateUi({ lastColor: value })
    },
  }
}

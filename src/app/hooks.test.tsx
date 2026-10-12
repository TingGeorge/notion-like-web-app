// @vitest-environment happy-dom
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { NotesDB, db, setDb } from '../lib/store/db'
import type { FileRow, PageRow } from '../lib/types'
import { useFile, usePage } from './hooks'

let n = 0
beforeEach(() => {
  setDb(new NotesDB(`hooks-test-${n++}`))
})

function pageRow(key: string, path: string, title: string): PageRow {
  return { key, path, title, icon: null, cover: null, parentKey: null, links: [], excerpt: '', updatedAt: 0, created: null, virtual: false, childCount: 0 }
}

function fileRow(path: string, text: string): FileRow {
  return { path, kind: 'page', baseSha: null, baseText: null, text, pushing: null, dirty: true, deleted: false, conflict: null, movedTo: null, movedFrom: null, updatedAt: 0 }
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

describe('live queries never answer for another key', () => {
  it('usePage: switching pages never yields the previous page', async () => {
    await db().pages.bulkPut([pageRow('A', 'A.md', '甲'), pageRow('B', 'B.md', '乙')])
    const seen: Array<[string, string | null | undefined]> = []
    function Probe({ k }: { k: string }) {
      const page = usePage(k)
      seen.push([k, page === undefined ? undefined : (page?.key ?? null)])
      return null
    }
    const { rerender } = render(<Probe k="A" />)
    await settle()
    expect(seen.at(-1)).toEqual(['A', 'A'])
    rerender(<Probe k="B" />)
    await settle()
    expect(seen.at(-1)).toEqual(['B', 'B'])
    // While the query for B runs, the hook says "loading", not "A".
    for (const [k, got] of seen) if (got !== undefined && got !== null) expect(got).toBe(k)
  })

  it('usePage: a missing page is null only for its own key', async () => {
    await db().pages.put(pageRow('A', 'A.md', '甲'))
    const seen: Array<[string, string | null | undefined]> = []
    function Probe({ k }: { k: string }) {
      const page = usePage(k)
      seen.push([k, page === undefined ? undefined : (page?.key ?? null)])
      return null
    }
    const { rerender } = render(<Probe k="missing" />)
    await settle()
    expect(seen.at(-1)).toEqual(['missing', null])
    rerender(<Probe k="A" />)
    await settle()
    expect(seen.at(-1)).toEqual(['A', 'A'])
    expect(seen.filter(([k, got]) => k === 'A' && got === null)).toEqual([])
  })

  it('useFile: switching paths never yields the previous file', async () => {
    await db().files.bulkPut([fileRow('A.md', 'a'), fileRow('B.md', 'b')])
    const seen: Array<[string, string | null | undefined]> = []
    function Probe({ path }: { path: string }) {
      const file = useFile(path)
      seen.push([path, file === undefined ? undefined : (file?.path ?? null)])
      return null
    }
    const { rerender } = render(<Probe path="A.md" />)
    await settle()
    rerender(<Probe path="B.md" />)
    await settle()
    expect(seen.at(-1)).toEqual(['B.md', 'B.md'])
    for (const [path, got] of seen) if (got !== undefined && got !== null) expect(got).toBe(path)
  })
})

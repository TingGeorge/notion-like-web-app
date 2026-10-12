import { describe, expect, it } from 'vitest'
import { SearchIndex, type SearchDoc } from './index'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 12)

function doc(key: string, title: string, body = '', headings: string[] = [], daysAgo = 0): SearchDoc {
  return { key, title, path: `${title}.md`, headings, body, updatedAt: NOW - daysAgo * DAY }
}

function sample(): SearchIndex {
  const idx = SearchIndex.create()
  idx.upsert(doc('a', '會議記錄', '今天討論了預算與時程。', ['日期', '決議事項'], 1))
  idx.upsert(doc('b', '京都旅行計畫', '第一天去清水寺，晚上吃京都風親子丼。', ['行程'], 10))
  idx.upsert(doc('c', '讀書筆記', '這本書提到一次會議的流程，以及如何開會。', [], 40))
  idx.upsert(doc('d', 'Kyoto trip', 'Visit Fushimi Inari and eat tofu. Remember the temple tickets.', ['Budget'], 3))
  idx.upsert(doc('e', '食譜', '', ['京都風親子丼'], 5))
  return idx
}

describe('SearchIndex (UI-9)', () => {
  it('finds Chinese by a single character, by prefix', () => {
    const keys = sample().search('會').map((r) => r.key)
    expect(keys).toContain('a')
    expect(keys).toContain('c')
  })

  it('finds 會議記錄 by 會議 and 京都 in titles and body text', () => {
    const idx = sample()
    expect(idx.search('會議')[0].key).toBe('a')
    const kyoto = idx.search('京都')
    expect(kyoto.map((r) => r.key)).toEqual(expect.arrayContaining(['b', 'e']))
    const bodyHit = idx.search('親子丼').find((r) => r.key === 'b')
    expect(bodyHit?.matchedIn).toBe('body')
    expect(bodyHit?.snippet.text).toContain('京都風親子丼')
  })

  it('needs the characters of a Chinese word to be adjacent', () => {
    const idx = SearchIndex.create()
    idx.upsert(doc('x', '會計', '議題在後面'))
    expect(idx.search('會議')).toEqual([])
  })

  it('matches Latin by prefix, case-insensitively, and tolerates a typo in long words', () => {
    const idx = sample()
    expect(idx.search('kyo').map((r) => r.key)).toEqual(['d'])
    expect(idx.search('TEMPLE')[0].key).toBe('d')
    expect(idx.search('fushmi').map((r) => r.key)).toEqual(['d'])
  })

  it('uses AND across words, in any field', () => {
    const idx = sample()
    expect(idx.search('kyoto budget').map((r) => r.key)).toEqual(['d'])
    expect(idx.search('kyoto 預算')).toEqual([])
    expect(idx.search('預算 時程').map((r) => r.key)).toEqual(['a'])
  })

  it('ranks title, then headings, then body', () => {
    const idx = SearchIndex.create()
    idx.upsert(doc('body', '雜記', '這裡提到旅行的事情'))
    idx.upsert(doc('head', '雜記二', '', ['旅行']))
    idx.upsert(doc('title', '旅行', ''))
    const r = idx.search('旅行')
    expect(r.map((x) => x.key)).toEqual(['title', 'head', 'body'])
    expect(r.map((x) => x.matchedIn)).toEqual(['title', 'heading', 'body'])
    expect(r[0].titleHighlights).toEqual([[0, 2]])
  })

  it('titleOnly, since, sort and limit', () => {
    const idx = sample()
    expect(idx.search('京都', { titleOnly: true }).map((r) => r.key)).toEqual(['b'])
    expect(
      idx
        .search('會議', { since: NOW - 7 * DAY })
        .map((r) => r.key),
    ).toEqual(['a'])
    expect(idx.search('會議', { since: NOW - 30 * DAY }).map((r) => r.key)).toEqual(['a'])
    expect(idx.search('會議', { sort: 'recent' }).map((r) => r.key)).toEqual(['a', 'c'])
    expect(idx.search('會', { limit: 1 })).toHaveLength(1)
    expect(idx.search('')).toEqual([])
    expect(idx.search('  ！？ ')).toEqual([])
  })

  it('builds a snippet with … at cut ends and highlight ranges', () => {
    const idx = SearchIndex.create()
    const body = `${'前面的文字很長。'.repeat(12)}這裡是京都的重點，${'後面的文字也很長。'.repeat(12)}`
    idx.upsert(doc('s', '長文', body))
    const [r] = idx.search('京都')
    expect(r.snippet.text.startsWith('…')).toBe(true)
    expect(r.snippet.text.endsWith('…')).toBe(true)
    expect(r.snippet.text.length).toBeGreaterThanOrEqual(60)
    expect(r.snippet.text.length).toBeLessThanOrEqual(80)
    expect(r.snippet.highlights).toHaveLength(1)
    const [a, b] = r.snippet.highlights[0]
    expect(r.snippet.text.slice(a, b)).toBe('京都')
  })

  it('highlights expanded Latin matches', () => {
    const [r] = sample().search('kyo')
    expect(r.titleHighlights).toEqual([[0, 5]])
    const [t] = sample().search('tick')
    expect(t.snippet.text.slice(...t.snippet.highlights[0])).toBe('tickets')
  })

  it('upsert replaces, remove removes', () => {
    const idx = sample()
    expect(idx.size).toBe(5)
    idx.upsert(doc('a', '會議記錄', '改成討論旅遊'))
    expect(idx.size).toBe(5)
    expect(idx.search('預算')).toEqual([])
    expect(idx.search('旅遊').map((r) => r.key)).toEqual(['a'])
    idx.remove('a')
    expect(idx.has('a')).toBe(false)
    expect(idx.search('旅遊')).toEqual([])
    idx.remove('missing')
  })

  it('round-trips through toJSON / create', () => {
    const idx = sample()
    const copy = SearchIndex.create(idx.toJSON())
    expect(copy.size).toBe(5)
    expect(copy.search('京都').map((r) => r.key)).toEqual(idx.search('京都').map((r) => r.key))
    expect(copy.search('kyo')[0].snippet).toEqual(idx.search('kyo')[0].snippet)
    expect(SearchIndex.create('not json').size).toBe(0)
  })

  it('searches 5,000 pages within 100 ms (NFR-1)', () => {
    const topics = ['會議記錄', '旅行計畫', '讀書筆記', '專案規劃', '食譜收藏', '財務預算', '學習日誌', '產品需求']
    const latin = ['meeting', 'roadmap', 'budget', 'recipe', 'design', 'review', 'travel', 'notes']
    const idx = SearchIndex.create()
    for (let i = 0; i < 5000; i++) {
      const t = topics[i % 8]
      const l = latin[(i * 3) % 8]
      const body = Array.from(
        { length: 40 },
        (_, j) => `${topics[(i + j) % 8]}裡的第${j}段：我們討論了${l}與${topics[(i * 7 + j) % 8]}的細節，並且安排 ${latin[(i + j) % 8]} 的後續工作。`,
      ).join('\n')
      idx.upsert(doc(`k${i}`, `${t} ${i}`, body, [`${l} 概要`, `第${i % 50}章`], i % 90))
    }
    idx.search('會議') // warm up
    const queries = ['會議', '旅行計畫', 'meeting', 'budge', '財務 roadmap', '會']
    const times: number[] = []
    for (const q of queries) {
      const t0 = performance.now()
      const r = idx.search(q)
      times.push(performance.now() - t0)
      expect(r.length).toBeGreaterThan(0)
    }
    console.log(`search latency over 5000 pages (ms): ${queries.map((q, i) => `${q}=${times[i].toFixed(1)}`).join(', ')}`)
    expect(Math.max(...times)).toBeLessThanOrEqual(100)
  }, 120_000)
})

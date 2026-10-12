/**
 * Performance guards. micromark (the parser) dominates the cost of both directions (the
 * serializer parses back paragraphs with several emphasis spans). It is roughly linear when the
 * body is parsed in chunks, which these tests check; without chunking, micromark is quadratic on
 * bodies with many lists. Set MD_PERF=1 to also time a 1 MB page (slow under vitest, which loads
 * micromark's development build).
 */
import { describe, expect, it } from 'vitest'
import { parseMarkdown, serializeMarkdown } from './index'

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

const UNIT = `## 會議記錄 2026-10-12

今天討論了**專案 A** 的進度，以及 *下一步* 的安排。參考 [規格](/工作/規格.md) 和 \`npm test\`。
<span data-color="red">重要</span>：請在週五前完成 <u>測試</u>。

- [ ] 整理需求
- [x] 寫測試
  - 單元測試
  - 端對端測試
- 一般項目

1. 第一步
2. 第二步

> [!NOTE]
> 記得更新文件。

\`\`\`ts
const answer = 42
\`\`\`

| 項目 | 狀態 |
| --- | --- |
| A | 完成 |

[規格](/工作/規格.md)

`

function bigPage(size: number): string {
  let s = ''
  while (s.length < size) s += UNIT
  return s.replace(/\n+$/, '\n')
}

/** Best of three runs (other test files share the CPU). */
function time(fn: () => unknown): number {
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    fn()
    best = Math.min(best, performance.now() - t)
  }
  return best
}

describe('performance', () => {
  it('round-trips a large page exactly', () => {
    const md = bigPage(40_000)
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
  }, 60_000)

  it('stays linear: 4× the text takes far less than 16× the time', () => {
    const small = bigPage(15_000)
    const large = bigPage(60_000)
    parseMarkdown(small)
    const a = time(() => parseMarkdown(small))
    const b = time(() => parseMarkdown(large))
    expect(b / a).toBeLessThan(8)
    const docSmall = parseMarkdown(small)
    const docLarge = parseMarkdown(large)
    const c = time(() => serializeMarkdown(docSmall))
    const d = time(() => serializeMarkdown(docLarge))
    expect(d / c).toBeLessThan(8)
  }, 60_000)

  it.runIf(env.MD_PERF === '1')('parses and serializes a 1 MB page', () => {
    const md = bigPage(1_000_000)
    const doc = parseMarkdown(md)
    const parseMs = time(() => parseMarkdown(md))
    const serializeMs = time(() => serializeMarkdown(doc))
    console.warn(`1 MB page: parse ${parseMs.toFixed(0)} ms, serialize ${serializeMs.toFixed(0)} ms`)
    expect(parseMs + serializeMs).toBeLessThan(20_000)
  }, 120_000)
})

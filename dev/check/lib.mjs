/**
 * Browser checks for the block editor (Playwright, Chromium). Start the dev server first:
 *   npm run dev            (then EDITOR_URL=http://localhost:<port>/dev/editor.html if the port differs)
 *   node dev/check/run-all.mjs
 * Screenshots go to dev/check/shots (or $SHOTS_DIR). Every line prints PASS or FAIL.
 */
import { chromium } from 'playwright'
export const OUT = process.env.SHOTS_DIR ?? new URL('./shots', import.meta.url).pathname
export const BASE = process.env.EDITOR_URL ?? 'http://localhost:5173/dev/editor.html'

import { mkdirSync } from 'node:fs'
mkdirSync(OUT, { recursive: true })

export async function launch(opts = {}) {
  const browser = await chromium.launch()
  const mobile = !!opts.mobile
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }
      : { viewport: { width: 1440, height: 900 } },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  const qs = []
  if (opts.theme) qs.push(`theme=${opts.theme}`)
  if (mobile) qs.push('mobile=1')
  if (opts.empty) qs.push('empty=1')
  if (opts.readonly) qs.push('readonly=1')
  await page.goto(`${BASE}?${qs.join('&')}`)
  await page.waitForSelector('.gn-prose')
  await page.waitForTimeout(300)
  return { browser, page, errors }
}

export const docJSON = (page) => page.evaluate(() => window.__gn.handle.getDoc().toJSON())
export const docText = (page) => page.evaluate(() => window.__gn.handle.getDoc().textContent)

/** Set a text selection by searching for a string in the doc. */
export async function selectText(page, str, { caretAt } = {}) {
  await page.evaluate(
    ([s, caret]) => {
      const view = window.__gn.handle.view
      let found = null
      view.state.doc.descendants((node, pos) => {
        if (found) return false
        if (node.isText && node.text.includes(s)) found = pos + node.text.indexOf(s)
      })
      if (found === null) throw new Error('text not found: ' + s)
      const TS = view.state.selection.constructor
      const sel = caret === 'end' ? TS.create(view.state.doc, found + s.length) : caret === 'start' ? TS.create(view.state.doc, found) : TS.create(view.state.doc, found, found + s.length)
      view.dispatch(view.state.tr.setSelection(sel))
      view.focus()
    },
    [str, caretAt],
  )
  await page.waitForTimeout(80)
}

export function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!cond) process.exitCode = 1
}

// Renders public/icon.svg to the PNG icons the manifest and iOS need. Run: node scripts/make-icons.mjs
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, size, pad] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
]) {
  await page.setViewportSize({ width: size, height: size })
  // iOS rounds the corners itself, so the touch icon is a full square.
  const body = name === 'apple-touch-icon.png' ? svg.replace('rx="112"', 'rx="0"') : svg
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;padding:${pad}px">${body.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`,
  )
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: true })
}
await browser.close()

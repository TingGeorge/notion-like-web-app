import { describe, expect, it } from 'vitest'
import { create } from 'qrcode'
import { decodeQr, qrMatrix, qrSvg } from './qr'
import { encryptLinkPayload } from './crypto'

/** Render a matrix to an RGBA buffer: `scale` pixels per module, `quiet` modules of white around it. */
function render(size: number, data: Uint8Array, scale = 4, quiet = 4) {
  const px = (size + quiet * 2) * scale
  const rgba = new Uint8ClampedArray(px * px * 4).fill(255)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!data[y * size + x]) continue
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * px + (x + quiet) * scale + dx) * 4
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 0
        }
    }
  return { data: rgba, width: px, height: px }
}

/** Parse the SVG path back into a matrix, to check that it draws exactly the modules. */
function svgToMatrix(svg: string) {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!
  const total = Number(viewBox[1])
  const d = /<path[^>]* d="([^"]*)"/.exec(svg)![1]
  const cells = new Uint8Array(total * total)
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])]
    for (let i = 0; i < w; i++) cells[y * total + x + i] = 1
  }
  return { total, cells }
}

describe('qrSvg (LINK-1: error correction M)', () => {
  it('uses error correction level M', () => {
    expect(create('ghnotes:1:abc', { errorCorrectionLevel: 'M' }).errorCorrectionLevel.bit).toBe(0)
    // A long text needs a bigger symbol at M than at L.
    const text = 'x'.repeat(150)
    expect(qrMatrix(text).size).toBe(create(text, { errorCorrectionLevel: 'M' }).modules.size)
    expect(qrMatrix(text).size).toBeGreaterThan(create(text, { errorCorrectionLevel: 'L' }).modules.size)
  })

  it('is a currentColor SVG with a quiet zone, drawing the matrix', () => {
    const svg = qrSvg('hello', { margin: 3 })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('fill="currentColor"')
    expect(svg).not.toContain('<script')
    const { size, data } = qrMatrix('hello')
    const { total, cells } = svgToMatrix(svg)
    expect(total).toBe(size + 6)
    for (let y = 0; y < total; y++)
      for (let x = 0; x < total; x++) {
        const inside = x >= 3 && y >= 3 && x < size + 3 && y < size + 3
        expect(cells[y * total + x]).toBe(inside ? data[(y - 3) * size + (x - 3)] : 0)
      }
  })

  it('clamps the margin to 2–4 and supports colours and a label', () => {
    expect(/viewBox="0 0 (\d+)/.exec(qrSvg('a', { margin: 0 }))![1]).toBe(String(qrMatrix('a').size + 4))
    expect(/viewBox="0 0 (\d+)/.exec(qrSvg('a', { margin: 9 }))![1]).toBe(String(qrMatrix('a').size + 8))
    const svg = qrSvg('a', { color: '#000', background: '#fff', label: 'QR "code"' })
    expect(svg).toContain('<rect')
    expect(svg).toContain('fill="#000"')
    expect(svg).toContain('aria-label="QR &quot;code&quot;"')
  })
})

describe('decodeQr', () => {
  it('round-trips a link payload', async () => {
    const payload = await encryptLinkPayload(
      { o: 'alice', r: 'notes', b: 'main', t: 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz', e: '2027-01-31' },
      'K7QM2XPA',
    )
    const { size, data } = qrMatrix(payload)
    expect(decodeQr(render(size, data))).toBe(payload)
  }, 30_000)

  it('decodes text with Chinese characters and the SVG-parsed matrix', () => {
    const text = '歡迎使用 GitHub Notes'
    const svg = qrSvg(text, { margin: 4 })
    const { total, cells } = svgToMatrix(svg)
    expect(decodeQr(render(total, cells, 5, 0))).toBe(text)
  })

  it('returns null when there is no QR code', () => {
    expect(decodeQr({ data: new Uint8ClampedArray(50 * 50 * 4).fill(255), width: 50, height: 50 })).toBeNull()
  })
})

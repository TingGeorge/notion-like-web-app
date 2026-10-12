import { describe, expect, it } from 'vitest'
import { t } from '../../strings/zh-TW'
import {
  FileTooLargeError,
  MAX_UPLOAD_BYTES,
  assetExtension,
  assetPathFor,
  checkUploadSize,
  fitWithin,
  placeAsset,
  prepareImage,
  sha256Hex,
} from './assets'

const bytes = new TextEncoder().encode('hello')
// SHA-256("hello")
const HELLO = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
const date = new Date(2026, 9, 12)

describe('assetPathFor (DATA-18)', () => {
  it('hashes with SHA-256', async () => {
    expect(await sha256Hex(bytes)).toBe(HELLO)
  })

  it('uses year, month and the first 8 hex characters', async () => {
    expect(await assetPathFor(bytes, 'png', date, () => false)).toBe('_assets/2026/10/2cf24dba.png')
    expect(await assetPathFor(bytes, 'JPG', new Date(2027, 0, 5), () => false)).toBe('_assets/2027/01/2cf24dba.jpg')
  })

  it('lengthens the prefix by 4 characters while the path holds different content', async () => {
    const taken = new Set(['_assets/2026/10/2cf24dba.png', '_assets/2026/10/2cf24dba5fb0.png'])
    const path = await assetPathFor(
      bytes,
      'png',
      date,
      async (p) => taken.has(p),
      () => false,
    )
    expect(path).toBe('_assets/2026/10/2cf24dba5fb0a30e.png')
  })

  it('reuses a path that already holds the same content, and never overwrites', async () => {
    const same = await placeAsset(bytes, 'png', date, () => true, () => true)
    expect(same).toEqual({ path: '_assets/2026/10/2cf24dba.png', existing: true })
    // Without a content check, a taken path is the same file.
    expect((await placeAsset(bytes, 'png', date, () => true)).existing).toBe(true)
    const fresh = await placeAsset(bytes, 'png', date, () => false)
    expect(fresh.existing).toBe(false)
  })

  it('falls back to bin for a bad extension', async () => {
    expect(await assetPathFor(bytes, '../x', date, () => false)).toBe('_assets/2026/10/2cf24dba.bin')
  })
})

describe('assetExtension', () => {
  it.each([
    ['photo.JPG', 'image/jpeg', 'jpg'],
    ['photo.jpeg', '', 'jpg'],
    ['報告.PDF', 'application/pdf', 'pdf'],
    ['archive.tar.gz', '', 'gz'],
    ['image', 'image/png', 'png'],
    ['image', 'image/svg+xml', 'svg'],
    ['IMG_0001', 'image/jpeg; charset=binary', 'jpg'],
    ['noext', '', 'bin'],
    ['weird.ext!', '', 'bin'],
    ['.hidden', '', 'bin'],
    ['file.', 'text/plain', 'txt'],
    ['a.verylongextension', '', 'bin'],
  ])('%s (%s) → %s', (name, mime, ext) => {
    expect(assetExtension(name, mime)).toBe(ext)
  })
})

describe('checkUploadSize (DATA-19)', () => {
  it('accepts up to 25 MB and rejects more, with the string from zh-TW', () => {
    expect(() => checkUploadSize({ size: MAX_UPLOAD_BYTES })).not.toThrow()
    expect(() => checkUploadSize(new File(['x'], 'a.txt'))).not.toThrow()
    expect(() => checkUploadSize({ size: MAX_UPLOAD_BYTES + 1 })).toThrow(t.editor.fileTooLarge)
    expect(() => checkUploadSize({ size: MAX_UPLOAD_BYTES + 1 })).toThrow(FileTooLargeError)
  })
})

describe('fitWithin', () => {
  it('scales the long edge down to 2560 and keeps the ratio', () => {
    expect(fitWithin(5120, 2560)).toEqual({ width: 2560, height: 1280, scaled: true })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1920, height: 2560, scaled: true })
    expect(fitWithin(2560, 100)).toEqual({ width: 2560, height: 100, scaled: false })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false })
    expect(fitWithin(100000, 1).height).toBe(1)
  })
})

describe('prepareImage (DATA-19)', () => {
  it('passes GIF and SVG through unchanged', async () => {
    const gif = new File([new Uint8Array([71, 73, 70])], 'a.gif', { type: 'image/gif' })
    expect(await prepareImage(gif)).toEqual({ blob: gif, ext: 'gif' })
    const svg = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })
    expect(await prepareImage(svg)).toEqual({ blob: svg, ext: 'svg' })
  })

  it('passes non-images and undecodable files through (no createImageBitmap here)', async () => {
    const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    expect(await prepareImage(pdf)).toEqual({ blob: pdf, ext: 'pdf' })
    const png = new File([new Uint8Array([1, 2, 3])], 'a.PNG', { type: 'image/png' })
    expect(await prepareImage(png)).toEqual({ blob: png, ext: 'png' })
  })
})

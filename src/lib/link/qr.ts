/**
 * QR code helpers for device linking (LINK-1, LINK-3).
 * Encoding builds an SVG path from the module matrix (no canvas); decoding wraps jsQR.
 */
import { create } from 'qrcode'
import jsQR from 'jsqr'

export interface QrOptions {
  /** Quiet zone in modules (the QR spec asks for 4; 2–4 is accepted by phone scanners). Default 3. */
  margin?: number
  /** Module colour. Default `currentColor`, so the page's text colour applies. */
  color?: string
  /** Background colour; `null` (default) leaves it transparent. */
  background?: string | null
  /** Accessible label for the image. */
  label?: string
}

export interface QrMatrix {
  size: number
  /** Row-major, 1 = dark. */
  data: Uint8Array
}

/** The module matrix of `text` at error correction level M (LINK-1). */
export function qrMatrix(text: string): QrMatrix {
  const qr = create(text, { errorCorrectionLevel: 'M' })
  const { size, data } = qr.modules
  return { size, data: Uint8Array.from(data as ArrayLike<number>, (v) => (v ? 1 : 0)) }
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** A compact SVG string for the QR code of `text` (error correction level M). */
export function qrSvg(text: string, options: QrOptions = {}): string {
  const margin = Math.min(4, Math.max(2, Math.round(options.margin ?? 3)))
  const { size, data } = qrMatrix(text)
  const total = size + margin * 2
  // One path: each horizontal run of dark modules is a rectangle.
  let path = ''
  for (let y = 0; y < size; y++) {
    let x = 0
    while (x < size) {
      if (!data[y * size + x]) {
        x++
        continue
      }
      const start = x
      while (x < size && data[y * size + x]) x++
      path += `M${start + margin} ${y + margin}h${x - start}v1h-${x - start}z`
    }
  }
  const bg =
    options.background == null ? '' : `<rect width="${total}" height="${total}" fill="${escapeAttr(options.background)}"/>`
  const label = options.label ? ` role="img" aria-label="${escapeAttr(options.label)}"` : ' aria-hidden="true"'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"${label}>` +
    `${bg}<path fill="${escapeAttr(options.color ?? 'currentColor')}" d="${path}"/></svg>`
  )
}

export interface ImageLike {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Decode a QR code from camera or canvas pixels (RGBA). Returns the text, or null if none was found. */
export function decodeQr(image: ImageData | ImageLike): string | null {
  const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
  return result ? result.data : null
}

/**
 * Local QR renderer (level M, LINK-1) on top of the installed `qrcode` package.
 * Placeholder for `qrSvg` in `src/lib/link/qr.ts`; swap the import in LinkDeviceDialog when that exists.
 */
import QRCode from 'qrcode'

export interface QrPath {
  /** Modules per side (without a quiet zone). */
  size: number
  /** SVG path data in module units; fill it with `currentColor`. */
  d: string
}

export function qrPath(text: string): QrPath {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const { size, data } = qr.modules
  let d = ''
  for (let y = 0; y < size; y++) {
    let x = 0
    while (x < size) {
      if (data[y * size + x]) {
        const start = x
        while (x < size && data[y * size + x]) x++
        d += `M${start} ${y}h${x - start}v1h-${x - start}z`
      } else {
        x++
      }
    }
  }
  return { size, d }
}

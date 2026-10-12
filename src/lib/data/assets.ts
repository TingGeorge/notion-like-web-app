/**
 * Attachments (DATA-18, DATA-19): where an upload is stored, and image preparation.
 * The path functions are pure; `prepareImage` needs a browser (createImageBitmap + canvas).
 */
import { t } from '../../strings/zh-TW'
import { ASSETS_DIR } from '../types'

/** DATA-19: any file over this is rejected. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
/** DATA-19: images are scaled down so their long edge is at most this. */
export const MAX_IMAGE_EDGE = 2560
export const JPEG_QUALITY = 0.85

const FIRST_PREFIX = 8
const PREFIX_STEP = 4

export class FileTooLargeError extends Error {
  constructor() {
    super(t.editor.fileTooLarge)
    this.name = 'FileTooLargeError'
  }
}

/** DATA-19: throws `FileTooLargeError` (message `t.editor.fileTooLarge`) for a file over 25 MB. */
export function checkUploadSize(file: { size: number }): void {
  if (file.size > MAX_UPLOAD_BYTES) throw new FileTooLargeError()
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
}

/** Lowercase extension from the file name, else from the MIME type, else `bin`. `jpeg` becomes `jpg`. */
export function assetExtension(fileName: string | null | undefined, mime?: string | null): string {
  const dot = fileName ? fileName.lastIndexOf('.') : -1
  if (fileName && dot > 0) {
    const ext = fileName.slice(dot + 1).toLowerCase()
    if (/^[a-z0-9]{1,8}$/.test(ext)) return ext === 'jpeg' || ext === 'jpe' ? 'jpg' : ext
  }
  const fromMime = mime ? MIME_EXTENSIONS[mime.split(';')[0].trim().toLowerCase()] : undefined
  return fromMime ?? 'bin'
}

export type PathCheck = (path: string) => boolean | Promise<boolean>

export interface AssetPlacement {
  path: string
  /** True when the path already holds this exact content: do not upload it again. */
  existing: boolean
}

/**
 * DATA-18: `_assets/<YYYY>/<MM>/<first 8 hex of SHA-256>.<ext>`. While that path holds different
 * content, the prefix is lengthened by 4 hex characters. An existing file is never overwritten.
 *
 * `exists` says whether a path is taken. `sameContent` says whether the file at a taken path has
 * the same bytes; without it a taken path is assumed to hold the same content (equal SHA-256 prefix
 * and extension), which is what makes uploading the same image twice a no-op.
 */
export async function placeAsset(
  bytes: Uint8Array,
  ext: string,
  date: Date,
  exists: PathCheck,
  sameContent?: PathCheck,
): Promise<AssetPlacement> {
  const hex = await sha256Hex(bytes)
  const dir = `${ASSETS_DIR}${String(date.getFullYear()).padStart(4, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/`
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext.toLowerCase()) ? ext.toLowerCase() : 'bin'
  for (let length = FIRST_PREFIX; length <= hex.length; length += PREFIX_STEP) {
    const path = `${dir}${hex.slice(0, length)}.${safeExt}`
    if (!(await exists(path))) return { path, existing: false }
    if (!sameContent || (await sameContent(path))) return { path, existing: true }
  }
  // The full SHA-256 collided with different content: impossible in practice.
  throw new Error('asset path space exhausted')
}

export async function assetPathFor(
  bytes: Uint8Array,
  ext: string,
  date: Date,
  exists: PathCheck,
  sameContent?: PathCheck,
): Promise<string> {
  return (await placeAsset(bytes, ext, date, exists, sameContent)).path
}

/** Scale (width, height) so the long edge is at most `max`; never enlarges. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height)
  if (long <= max) return { width, height, scaled: false }
  const k = max / long
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true }
}

export interface PreparedImage {
  blob: Blob
  ext: string
}

function hasAlpha(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * DATA-19 (browser only): scale an image whose long edge is over 2560 px, and re-encode it as JPEG
 * (quality 0.85), or as PNG when it has transparency. GIF and SVG are passed through unchanged, and
 * so is anything that cannot be decoded here (for example HEIC outside Safari).
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const original: PreparedImage = { blob: file, ext: assetExtension(file.name, file.type) }
  const type = file.type.toLowerCase()
  if (original.ext === 'gif' || original.ext === 'svg' || type === 'image/gif' || type === 'image/svg+xml') return original
  if (type !== '' && !type.startsWith('image/')) return original
  if (typeof createImageBitmap !== 'function') return original
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const { width, height, scaled } = fitWithin(bitmap.width, bitmap.height)
      const canvas: OffscreenCanvas | HTMLCanvasElement =
        typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
      if (!ctx) return original
      ctx.drawImage(bitmap, 0, 0, width, height)
      // JPEG cannot have transparency, so only formats that can are checked.
      const mayHaveAlpha = type !== 'image/jpeg' && original.ext !== 'jpg'
      const transparent = mayHaveAlpha && hasAlpha(ctx.getImageData(0, 0, width, height).data)
      if (transparent) {
        const png = await encode(canvas, 'image/png')
        if (!png) return original
        // A PNG that did not need scaling is already as small as it gets: keep the original bytes.
        return !scaled && original.ext === 'png' && png.size >= file.size ? original : { blob: png, ext: 'png' }
      }
      if (mayHaveAlpha) {
        // Opaque PNG/WebP: draw again on white so any fully-opaque rounding cannot leave black pixels.
        ctx.globalCompositeOperation = 'destination-over'
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, width, height)
      }
      const jpeg = await encode(canvas, 'image/jpeg', JPEG_QUALITY)
      if (!jpeg || jpeg.type !== 'image/jpeg') return original
      // Re-encoding a small JPEG can make it bigger; keep the original then.
      if (!scaled && (type === 'image/jpeg' || original.ext === 'jpg') && jpeg.size >= file.size) return original
      return { blob: jpeg, ext: 'jpg' }
    } finally {
      bitmap.close?.()
    }
  } catch {
    return original
  }
}

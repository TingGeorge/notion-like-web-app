/**
 * Attachments (DATA-18, DATA-19, SEC-5). New uploads live in the `uploads` table until pushed;
 * downloaded ones in the `assets` cache (≤ 200 MB, least recently used evicted).
 * Everything is shown through `blob:` URLs.
 */
import { assetPathFor, checkUploadSize, prepareImage } from '../../lib/data/assets'
import { encodeLinkPath, parseHref } from '../../lib/data/links'
import { db } from '../../lib/store/db'
import type { UploadResult } from '../../editor/types'
import { session } from '../session'

const ASSET_CACHE_LIMIT = 200 * 1024 * 1024
const urls = new Map<string, string>()

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function pathExistsWithOtherContent(path: string, sha256: string): Promise<boolean> {
  const upload = await db().uploads.get(path)
  if (upload) return upload.sha256 !== sha256
  const state = await db().sync.get('state')
  // An attachment already on GitHub at this path: assume different content (never overwrite).
  return !!state?.tree?.[path]
}

export async function uploadAttachment(file: File): Promise<UploadResult> {
  checkUploadSize(file)
  const isImage = file.type.startsWith('image/')
  const prepared = isImage ? await prepareImage(file) : { blob: file as Blob, ext: '' }
  const bytes = await prepared.blob.arrayBuffer()
  const sha256 = await sha256Hex(bytes)
  const ext = prepared.ext || (file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin')
  const path = await assetPathFor(new Uint8Array(bytes), ext, new Date(), (p) => pathExistsWithOtherContent(p, sha256))
  const existing = await db().uploads.get(path)
  if (!existing) {
    await db().uploads.put({ path, blob: prepared.blob, sha256, createdAt: Date.now() })
    await db().assets.put({ path, blob: prepared.blob, size: prepared.blob.size, lastUsed: Date.now() })
  }
  session()?.engine.notifyLocalChange()
  return { href: encodeLinkPath(path), name: file.name, isImage }
}

async function evictIfNeeded(): Promise<void> {
  const rows = await db().assets.orderBy('lastUsed').toArray()
  let total = rows.reduce((n, r) => n + r.size, 0)
  for (const row of rows) {
    if (total <= ASSET_CACHE_LIMIT) break
    if (await db().uploads.get(row.path)) continue
    await db().assets.delete(row.path)
    total -= row.size
  }
}

/** A `blob:` URL for an attachment href, or null when it is not available. */
export async function resolveAttachment(href: string): Promise<string | null> {
  if (href.startsWith('blob:') || href.startsWith('data:')) return href
  if (/^https:\/\//i.test(href)) return href
  const parsed = parseHref(href)
  if (!parsed) return null
  const path = parsed.path
  const cached = urls.get(path)
  if (cached) return cached
  let blob: Blob | null = null
  const upload = await db().uploads.get(path)
  if (upload) blob = upload.blob
  if (!blob) {
    const asset = await db().assets.get(path)
    if (asset) {
      blob = asset.blob
      void db().assets.update(path, { lastUsed: Date.now() })
    }
  }
  if (!blob) {
    const s = session()
    if (!s || !navigator.onLine) return null
    try {
      const { owner, repo, branch } = s.workspace
      blob = await s.client.getFileBlob(owner, repo, path, branch)
      await db().assets.put({ path, blob, size: blob.size, lastUsed: Date.now() })
      void evictIfNeeded()
    } catch {
      return null
    }
  }
  // SEC-5: only raster images are shown (through <img>); anything else, including .svg and
  // .html, is retyped so it can only be downloaded.
  const shown = IMAGE_EXT.test(path) ? blob : new Blob([blob], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(shown)
  urls.set(path, url)
  return url
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i

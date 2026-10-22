/**
 * DATA-19 image resizing and cropping: the geometry, without DOM. Rectangles are in the image's
 * natural pixels.
 */
import { IMAGE_WIDTH_MAX, IMAGE_WIDTH_MIN } from '../lib/schema'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** What is dragged: the whole frame, an edge or a corner. */
export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const CROP_HANDLES: readonly Exclude<CropHandle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The crop frame after dragging `handle` by (dx, dy) natural pixels from `start`. It stays inside
 * the image and at least `min` pixels wide and high; moving keeps its size.
 */
export function dragCrop(start: Rect, handle: CropHandle, dx: number, dy: number, image: { w: number; h: number }, min = 16): Rect {
  const minW = Math.min(min, image.w)
  const minH = Math.min(min, image.h)
  if (handle === 'move') {
    return { x: clamp(start.x + dx, 0, image.w - start.w), y: clamp(start.y + dy, 0, image.h - start.h), w: start.w, h: start.h }
  }
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minW)
  if (handle.includes('e')) right = clamp(right + dx, left + minW, image.w)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minH)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minH, image.h)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** Whole pixels, still inside the image (for drawing the crop). */
export function roundRect(r: Rect, image: { w: number; h: number }): Rect {
  const x = clamp(Math.round(r.x), 0, image.w - 1)
  const y = clamp(Math.round(r.y), 0, image.h - 1)
  return { x, y, w: clamp(Math.round(r.w), 1, image.w - x), h: clamp(Math.round(r.h), 1, image.h - y) }
}

/** True when the frame is the whole image (nothing to crop). */
export function isWholeImage(r: Rect, image: { w: number; h: number }): boolean {
  const k = roundRect(r, image)
  return k.x === 0 && k.y === 0 && k.w === image.w && k.h === image.h
}

/**
 * The width to keep after cropping `naturalWidth` down to `cropWidth`, so the picture keeps its
 * scale on the page. No width stays no width.
 */
export function widthAfterCrop(width: number | null, naturalWidth: number, cropWidth: number): number | null {
  if (width === null || naturalWidth <= 0) return null
  return clamp(Math.round((width * cropWidth) / naturalWidth), IMAGE_WIDTH_MIN, IMAGE_WIDTH_MAX)
}

/**
 * The width after a resize drag. Dragging back to how the image shows without a width (its natural
 * width, at most the page width) clears it.
 */
export function widthAfterResize(dragged: number, naturalWidth: number, pageWidth: number): number | null {
  const unsized = Math.min(naturalWidth, pageWidth)
  const w = clamp(Math.round(dragged), IMAGE_WIDTH_MIN, Math.max(IMAGE_WIDTH_MIN, Math.floor(pageWidth)))
  return Math.abs(w - unsized) <= 2 ? null : w
}

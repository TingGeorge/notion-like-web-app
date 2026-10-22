import { describe, expect, it } from 'vitest'
import { dragCrop, isWholeImage, roundRect, widthAfterCrop, widthAfterResize } from './crop'

const image = { w: 1000, h: 500 }
const whole = { x: 0, y: 0, w: 1000, h: 500 }

describe('crop frame (DATA-19)', () => {
  it('drags corners and edges, keeping the opposite side', () => {
    expect(dragCrop(whole, 'se', -200, -100, image)).toEqual({ x: 0, y: 0, w: 800, h: 400 })
    expect(dragCrop(whole, 'nw', 100, 50, image)).toEqual({ x: 100, y: 50, w: 900, h: 450 })
    expect(dragCrop(whole, 'e', -300, 999, image)).toEqual({ x: 0, y: 0, w: 700, h: 500 })
    expect(dragCrop(whole, 'n', 999, 120, image)).toEqual({ x: 0, y: 120, w: 1000, h: 380 })
  })

  it('stays inside the image and keeps a minimum size', () => {
    expect(dragCrop(whole, 'nw', -50, -50, image)).toEqual(whole)
    expect(dragCrop(whole, 'w', 5000, 0, image, 16)).toEqual({ x: 984, y: 0, w: 16, h: 500 })
    expect(dragCrop({ x: 100, y: 100, w: 200, h: 200 }, 'se', 5000, 5000, image)).toEqual({ x: 100, y: 100, w: 900, h: 400 })
  })

  it('moves the frame without changing its size, within the image', () => {
    const r = { x: 100, y: 100, w: 200, h: 200 }
    expect(dragCrop(r, 'move', 50, -30, image)).toEqual({ x: 150, y: 70, w: 200, h: 200 })
    expect(dragCrop(r, 'move', 5000, 5000, image)).toEqual({ x: 800, y: 300, w: 200, h: 200 })
    expect(dragCrop(r, 'move', -5000, -5000, image)).toEqual({ x: 0, y: 0, w: 200, h: 200 })
  })

  it('rounds to whole pixels inside the image', () => {
    expect(roundRect({ x: 10.4, y: 0.6, w: 99.5, h: 499.9 }, image)).toEqual({ x: 10, y: 1, w: 100, h: 499 })
    expect(isWholeImage({ x: 0.2, y: 0, w: 999.9, h: 500 }, image)).toBe(true)
    expect(isWholeImage({ x: 0, y: 0, w: 900, h: 500 }, image)).toBe(false)
  })
})

describe('image width (DATA-19)', () => {
  it('keeps the scale after a crop', () => {
    expect(widthAfterCrop(400, 1000, 500)).toBe(200)
    expect(widthAfterCrop(null, 1000, 500)).toBeNull()
    expect(widthAfterCrop(100, 1000, 100)).toBe(40) // at least the minimum
  })

  it('clears the width when dragged back to the unsized size; keeps it within the page', () => {
    expect(widthAfterResize(320.4, 1200, 700)).toBe(320)
    expect(widthAfterResize(699, 1200, 700)).toBeNull()
    expect(widthAfterResize(301, 300, 700)).toBeNull()
    expect(widthAfterResize(500, 300, 700)).toBe(500)
    expect(widthAfterResize(9000, 1200, 700)).toBeNull()
    expect(widthAfterResize(5, 1200, 700)).toBe(40)
  })
})

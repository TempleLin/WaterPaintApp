import { describe, expect, it } from 'vitest'
import { resizeTransform } from '../src/shared/transform'
import type { RasterTransform } from '../src/shared/types'

const image: RasterTransform = { x: 100, y: 80, width: 120, height: 60, rotation: 0, flipX: false, flipY: false }
describe('image transforms', () => {
  it('keeps the opposite corner fixed during proportional scaling', () => {
    const t = resizeTransform(image, 'se', 60, 30, true)
    expect(t.width).toBe(180); expect(t.height).toBe(90)
    expect(t.x - t.width / 2).toBe(40); expect(t.y - t.height / 2).toBe(50)
  })
  it('resizes along rotated local axes, with a stationary opposite corner', () => {
    const t = resizeTransform({ ...image, rotation: 90 }, 'se', -30, 60, false)
    expect(t.width).toBeCloseTo(180); expect(t.height).toBeCloseTo(90)
    expect(t.x).toBeCloseTo(85); expect(t.y).toBeCloseTo(110)
    expect(t.x + t.height / 2).toBeCloseTo(130); expect(t.y - t.width / 2).toBeCloseTo(20)
  })
  it('allows free edge stretching without changing the other dimension', () => {
    const t = resizeTransform(image, 'w', -40, 100, false)
    expect(t.width).toBe(160); expect(t.height).toBe(60); expect(t.x + t.width / 2).toBe(160)
  })
  it('does not invert or collapse an image when a handle crosses its anchor', () => {
    const t = resizeTransform(image, 'se', -300, -300, true)
    expect(t.width).toBe(2); expect(t.height).toBe(1)
  })
})

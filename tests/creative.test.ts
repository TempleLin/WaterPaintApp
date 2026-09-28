import { describe, expect, it } from 'vitest'
import { StrokeSmoother, symmetrySamples, validPaper } from '../src/shared/creative'
import { mixPigments } from '../src/engine/spectral'
import { validBrush } from '../src/renderer/src/preferences'
import { DEFAULT_BRUSH } from '../src/shared/types'

describe('creative painting tools', () => {
  it('mirrors around the document center while preserving pressure', () => {
    expect(symmetrySamples({ x: 20, y: 30, pressure: .6 }, 'quad', 200, 100)).toEqual([
      { x: 20, y: 30, pressure: .6 }, { x: 180, y: 30, pressure: .6 },
      { x: 20, y: 70, pressure: .6 }, { x: 180, y: 70, pressure: .6 }
    ])
  })
  it('does not multiply paint on symmetry axes or at the radial center', () => {
    expect(symmetrySamples({ x: 100, y: 30, pressure: 1 }, 'quad', 200, 100)).toHaveLength(2)
    expect(symmetrySamples({ x: 100, y: 50, pressure: 1 }, 'radial', 200, 100)).toHaveLength(1)
    const petals = symmetrySamples({ x: 120, y: 50, pressure: 1 }, 'radial', 200, 100)
    expect(petals).toHaveLength(6)
    petals.forEach(p => expect(Math.hypot(p.x - 100, p.y - 50)).toBeCloseTo(20))
  })
  it('suppresses jitter and trails the input by the chosen radius', () => {
    const smooth = new StrokeSmoother(10)
    smooth.push({ x: 0, y: 0, pressure: 1 })
    expect(smooth.push({ x: 4, y: 3, pressure: .7 })).toEqual({ x: 0, y: 0, pressure: .7 })
    expect(smooth.push({ x: 30, y: 0, pressure: .8 })).toEqual({ x: 20, y: 0, pressure: .8 })
    expect(new StrokeSmoother(0).push({ x: 4, y: 3, pressure: 1 })).toEqual({ x: 4, y: 3, pressure: 1 })
  })
  it('mixes blue and yellow into green and preserves unmixed endpoints', () => {
    const blue = '#2461b0', yellow = '#f5d62a', mixed = mixPigments(blue, yellow, .5)
    const rgb = mixed.slice(1).match(/../g)!.map(v => parseInt(v, 16))
    expect(rgb[1]).toBeGreaterThan(rgb[0]); expect(rgb[1]).toBeGreaterThan(rgb[2])
    expect(mixPigments(blue, yellow, 0)).toBe(blue); expect(mixPigments(blue, yellow, 1)).toBe(yellow)
  })
  it('validates stored preferences before using them', () => {
    expect(validBrush(DEFAULT_BRUSH)).toBe(true)
    expect(validBrush({ ...DEFAULT_BRUSH, color: 'bad' })).toBe(false)
    expect(validBrush({ ...DEFAULT_BRUSH, size: Infinity })).toBe(false)
    expect(validPaper({ color: '#abcdef', grain: 0 })).toBe(true)
    expect(validPaper({ color: '#abcdef', grain: 3 })).toBe(false)
  })
})

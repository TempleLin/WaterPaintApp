import { describe, expect, it } from 'vitest'
import { StrokeSampler } from '../src/engine/stroke'
import { pigmentKS, spectralRGB } from '../src/engine/spectral'
describe('continuous brush paths', () => {
  it('covers a fast sparse pointer movement without gaps', () => {
    const sampler = new StrokeSampler(2)
    const points = [...sampler.push({ x: 0, y: 0, pressure: .2 }), ...sampler.push({ x: 100, y: 0, pressure: 1 })]
    expect(points.length).toBe(51)
    for (let i = 1; i < points.length; i++) expect(points[i].x - points[i - 1].x).toBeCloseTo(2)
    expect(points[25].pressure).toBeCloseTo(.6)
  })
  it('produces the same stamps at different event frequencies', () => {
    const a = new StrokeSampler(3), b = new StrokeSampler(3)
    const sparse = [0, 30].flatMap(x => a.push({ x, y: 0, pressure: 1 }))
    const dense = Array.from({ length: 31 }, (_, x) => b.push({ x, y: 0, pressure: 1 })).flat()
    expect(dense).toEqual(sparse)
  })
})
describe('pigment mixing', () => {
  it('mixes yellow and blue toward green rather than RGB gray', () => {
    const yellow = pigmentKS('#f5d62a'), blue = pigmentKS('#2461b0')
    const rgb = spectralRGB(yellow.map((v, i) => (v + blue[i]) / 2))
    expect(rgb[1]).toBeGreaterThan(rgb[0]); expect(rgb[1]).toBeGreaterThan(rgb[2])
  })
  it('does not change hue when mixing a pigment with itself', () => {
    const ks = pigmentKS('#315d91'), rgb = spectralRGB(ks)
    spectralRGB(ks.map(v => (v * .3 + v * .7))).forEach((value, i) => expect(value).toBeCloseTo(rgb[i], 12))
  })
  it('produces finite bounded colors including white and black', () => {
    for (const color of ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff']) {
      const rgb = spectralRGB(pigmentKS(color))
      expect(rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true)
    }
  })
})

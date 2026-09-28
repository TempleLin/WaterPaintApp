import type { BrushSample, Guide, PaperSettings, Symmetry } from './types'

export function validPaper(value: unknown): value is PaperSettings {
  const p = value as PaperSettings | null
  return !!p && typeof p.color === 'string' && /^#[\da-f]{6}$/i.test(p.color) && Number.isFinite(p.grain) && p.grain >= 0 && p.grain <= 2
}

/** Mirror each resampled dab; points on an axis are deposited just once. */
export function symmetrySamples(sample: BrushSample, mode: Symmetry, width: number, height: number): BrushSample[] {
  const { x, y } = sample
  let points = [[x, y]]
  if (mode === 'vertical' || mode === 'quad') points.push([width - x, y])
  if (mode === 'horizontal' || mode === 'quad') points.push([x, height - y])
  if (mode === 'quad') points.push([width - x, height - y])
  if (mode === 'radial') points = Array.from({ length: 6 }, (_, i) => {
    const a = i * Math.PI / 3, dx = x - width / 2, dy = y - height / 2
    return [width / 2 + dx * Math.cos(a) - dy * Math.sin(a), height / 2 + dx * Math.sin(a) + dy * Math.cos(a)]
  })
  return points.filter(([px, py], i) => !points.slice(0, i).some(([qx, qy]) => Math.hypot(px - qx, py - qy) < .01))
    .map(([px, py]) => ({ ...sample, x: px, y: py }))
}

/** A distance-based trailing pen, independent of input event rate. */
export class StrokeSmoother {
  private previous: BrushSample | null = null
  constructor(private radius: number) {}
  push(sample: BrushSample): BrushSample {
    if (!this.previous || this.radius <= 0) return this.previous = sample
    const distance = Math.hypot(sample.x - this.previous.x, sample.y - this.previous.y)
    if (distance <= this.radius) return { ...this.previous, pressure: sample.pressure }
    const t = (distance - this.radius) / distance
    return this.previous = { x: this.previous.x + (sample.x - this.previous.x) * t, y: this.previous.y + (sample.y - this.previous.y) * t, pressure: sample.pressure }
  }
}

export const GUIDES: { value: Guide; label: string }[] = [{ value: 'none', label: 'No guide' }, { value: 'thirds', label: 'Rule of thirds' }, { value: 'grid', label: 'Grid' }, { value: 'diagonal', label: 'Diagonals' }]
export const SYMMETRIES: { value: Symmetry; label: string }[] = [{ value: 'off', label: 'Off' }, { value: 'vertical', label: 'Mirror left / right' }, { value: 'horizontal', label: 'Mirror top / bottom' }, { value: 'quad', label: 'Four-way mirror' }, { value: 'radial', label: 'Six-petal radial' }]

import type { BrushSample } from '../shared/types'

/** Arc-length resampling is independent of browser event frequency. */
export class StrokeSampler {
  private previous: BrushSample | null = null
  private remaining = 0
  constructor(private spacing: number) {}
  start(sample: BrushSample): BrushSample[] {
    this.previous = sample; this.remaining = this.spacing
    return [sample]
  }
  push(sample: BrushSample): BrushSample[] {
    if (!this.previous) return this.start(sample)
    const a = this.previous, dx = sample.x - a.x, dy = sample.y - a.y
    const length = Math.hypot(dx, dy), result: BrushSample[] = []
    if (length > 0) {
      let distance = this.remaining
      for (; distance <= length; distance += this.spacing) {
        const t = distance / length
        result.push({ x: a.x + dx * t, y: a.y + dy * t, pressure: a.pressure + (sample.pressure - a.pressure) * t })
      }
      this.remaining = distance - length
    }
    this.previous = sample
    return result
  }
}

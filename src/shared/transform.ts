import type { RasterTransform } from './types'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
export const handleAxes = (handle: Handle): [number, number] => [handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0, handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0]
export const angle = (degrees: number): number => ((degrees + 180) % 360 + 360) % 360 - 180
export function validTransform(t: RasterTransform): boolean {
  return !!t && [t.x, t.y, t.width, t.height, t.rotation].every(Number.isFinite) &&
    Math.abs(t.x) <= 32768 && Math.abs(t.y) <= 32768 && t.width >= 1 && t.width <= 32768 &&
    t.height >= 1 && t.height <= 32768 && Math.abs(t.rotation) <= 360 && typeof t.flipX === 'boolean' && typeof t.flipY === 'boolean'
}
// Resize in the image's local axes, keeping the opposite edge/corner fixed.
export function resizeTransform(t: RasterTransform, handle: Handle, dx: number, dy: number, proportional: boolean): RasterTransform {
  const [hx, hy] = handleAxes(handle), radians = t.rotation * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians)
  const lx = c * dx + s * dy, ly = -s * dx + c * dy
  let width = hx ? Math.max(1, Math.min(32768, t.width + hx * lx)) : t.width
  let height = hy ? Math.max(1, Math.min(32768, t.height + hy * ly)) : t.height
  if (proportional) {
    const scale = hx && (!hy || Math.abs(width / t.width - 1) >= Math.abs(height / t.height - 1)) ? width / t.width : height / t.height
    const bounded = Math.max(1 / Math.min(t.width, t.height), Math.min(32768 / Math.max(t.width, t.height), scale))
    width = t.width * bounded; height = t.height * bounded
  }
  const cx = hx * (width - t.width) / 2, cy = hy * (height - t.height) / 2
  return { ...t, width, height, x: t.x + c * cx - s * cy, y: t.y + s * cx + c * cy }
}

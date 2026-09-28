import { DEFAULT_BRUSH, type BrushSettings } from '../../shared/types'

export interface SavedBrush { id: string; name: string; settings: BrushSettings }
export interface Library { swatches: string[]; brushes: SavedBrush[] }
const HEX = /^#[\da-f]{6}$/i
export function validBrush(value: unknown): value is BrushSettings {
  const b = value as BrushSettings | null
  return !!b && HEX.test(b.color) && ['round', 'wash', 'dry'].includes(b.preset) &&
    ['brush', 'water', 'lift', 'eraser', 'eyedropper', 'pan', 'image-move', 'image-transform', 'image-rotate'].includes(b.tool) &&
    [['size', 2, 400], ['water', 0, 1], ['pigment', 0, 1], ['softness', 0, 1], ['spread', 1, 8]].every(([key, min, max]) => {
      const n = b[key as keyof BrushSettings]; return typeof n === 'number' && Number.isFinite(n) && n >= Number(min) && n <= Number(max)
    })
}
export function readPreference<T>(key: string, fallback: T, validate: (value: unknown) => value is T): T {
  try { const value: unknown = JSON.parse(localStorage.getItem(`waterpaint.${key}`) ?? 'null'); return validate(value) ? value : fallback } catch { return fallback }
}
export function writePreference(key: string, value: unknown): boolean {
  try { localStorage.setItem(`waterpaint.${key}`, JSON.stringify(value)); return true } catch { return false }
}
export function loadBrush(): BrushSettings { return readPreference('brush', { ...DEFAULT_BRUSH }, validBrush) }
export function loadLibrary(): Library {
  return readPreference('library', { swatches: [], brushes: [] }, (value): value is Library => {
    const l = value as Library | null
    return !!l && Array.isArray(l.swatches) && l.swatches.length <= 24 && l.swatches.every(c => typeof c === 'string' && HEX.test(c)) &&
      Array.isArray(l.brushes) && l.brushes.length <= 12 && l.brushes.every(b => b && typeof b.id === 'string' && typeof b.name === 'string' && b.name.length <= 40 && validBrush(b.settings))
  })
}

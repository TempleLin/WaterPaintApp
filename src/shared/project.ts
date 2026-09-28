import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { DocumentSnapshot, LayerSnapshot, Rect } from './types'
import { MAX_LAYERS, MAX_SIZE } from './types'
import { validTransform } from './transform'

const CELL_BYTES = 80
export const MAX_PROJECT_BYTES = 512 * 1024 * 1024
const MAX_LAYER_BYTES = 1024 * 1024 * CELL_BYTES
type Manifest = Omit<DocumentSnapshot, 'layers'> & { layers: Omit<LayerSnapshot, 'state' | 'raster'>[] }
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid WaterPaint project: ${message}`)
}
function integer(value: unknown, min: number, max: number): value is number { return Number.isInteger(value) && Number(value) >= min && Number(value) <= max }
export function encodeProject(document: DocumentSnapshot): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const manifest: Manifest = { ...document, layers: document.layers.map(({ state, raster, ...layer }, index) => {
    files[`layers/${index}.bin`] = state
    if (raster) files[`layers/${index}.png`] = raster
    return layer
  }) }
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  return zipSync(files, { level: 3 })
}
export function decodeProject(bytes: Uint8Array): DocumentSnapshot {
  check(bytes.length <= MAX_PROJECT_BYTES, 'file exceeds the 512 MB limit.')
  let total = 0
  const files = unzipSync(bytes, { filter: entry => {
    total += entry.originalSize
    check(entry.originalSize <= MAX_LAYER_BYTES && total <= MAX_LAYER_BYTES * 9, 'uncompressed data is too large.')
    return /^(manifest\.json|layers\/[0-7]\.(bin|png))$/.test(entry.name)
  } })
  check(files['manifest.json'] && files['manifest.json'].length < 64 * 1024, 'missing or oversized manifest.')
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as Manifest
  check(manifest.version === 1, 'this file version is not supported.')
  check(integer(manifest.width, 64, MAX_SIZE) && integer(manifest.height, 64, MAX_SIZE), 'unsupported canvas size.')
  check(integer(manifest.seed, 0, 0xffffffff) && integer(manifest.tick, 0, Number.MAX_SAFE_INTEGER), 'invalid simulation state.')
  check(typeof manifest.title === 'string' && manifest.title.length <= 200, 'invalid document title.')
  check(Array.isArray(manifest.layers) && manifest.layers.length > 0 && manifest.layers.length <= MAX_LAYERS, 'invalid layer count.')
  const ratio = Math.min(1, 1024 / Math.max(manifest.width, manifest.height))
  const gw = Math.ceil(manifest.width * ratio), gh = Math.ceil(manifest.height * ratio)
  const ids = new Set<string>()
  const layers = manifest.layers.map((layer, index): LayerSnapshot => {
    const m = layer.meta
    check(m && typeof m.id === 'string' && m.id.length <= 100 && !ids.has(m.id), 'invalid layer identifier.'); ids.add(m.id)
    check(typeof m.name === 'string' && m.name.length <= 100, 'invalid layer name.')
    check(m.kind === 'paint' || m.kind === 'raster', 'invalid layer type.')
    check(typeof m.locked === 'boolean' && typeof m.visible === 'boolean' && Number.isFinite(m.opacity) && m.opacity >= 0 && m.opacity <= 1, 'invalid layer settings.')
    check(integer(layer.wetUntil, 0, Number.MAX_SAFE_INTEGER), 'invalid drying time.')
    check(layer.spread === undefined || (Number.isFinite(layer.spread) && layer.spread >= 1 && layer.spread <= 8), 'invalid paint spread.')
    check(m.transform === undefined || (m.kind === 'raster' && validTransform(m.transform)), 'invalid image transform.')
    const b: Rect | null = layer.bounds
    if (b !== null) {
      check(b && integer(b.x, 0, gw - 1) && integer(b.y, 0, gh - 1) && integer(b.width, 1, gw - b.x) && integer(b.height, 1, gh - b.y), 'invalid paint bounds.')
    }
    const state = files[`layers/${index}.bin`]
    const expected = m.kind === 'paint' && b ? b.width * b.height * CELL_BYTES : 0
    check(state && state.byteLength === expected, 'pigment data does not match the canvas.')
    const floats = new Float32Array(state.slice().buffer)
    check(floats.every(v => Number.isFinite(v) && v >= 0 && v < 1e9), 'pigment data contains invalid values.')
    const raster = files[`layers/${index}.png`]
    if (m.kind === 'raster') {
      check(raster && raster.length > 24 && raster[0] === 137 && raster[1] === 80 && raster[2] === 78 && raster[3] === 71, 'missing raster image.')
      const header = new DataView(raster.buffer, raster.byteOffset, raster.byteLength)
      const width = header.getUint32(16), height = header.getUint32(20)
      check(m.transform ? integer(width, 1, MAX_SIZE) && integer(height, 1, MAX_SIZE) : width === manifest.width && height === manifest.height, 'invalid raster dimensions.')
    }
    return { meta: { ...m }, state, bounds: b, wetUntil: layer.wetUntil, ...(layer.spread === undefined ? {} : { spread: layer.spread }), raster }
  })
  check(ids.has(manifest.activeId), 'missing active layer.')
  return { version: 1, width: manifest.width, height: manifest.height, seed: manifest.seed, tick: manifest.tick, title: manifest.title, activeId: manifest.activeId, layers }
}

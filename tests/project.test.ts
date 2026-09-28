import { describe, expect, it } from 'vitest'
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate'
import { decodeProject, encodeProject } from '../src/shared/project'
import type { DocumentSnapshot } from '../src/shared/types'

function sample(): DocumentSnapshot {
  const floats = new Float32Array(4 * 3 * 20)
  floats[0] = 3.145; floats[16] = .75; floats[17] = .12
  return { version: 1, width: 64, height: 64, seed: 7, tick: 120, title: 'Wet study', activeId: 'paint-1', layers: [{ meta: { id: 'paint-1', name: 'Blue wash', kind: 'paint', visible: true, locked: false, opacity: .75 }, bounds: { x: 10, y: 20, width: 4, height: 3 }, wetUntil: 3600, state: new Uint8Array(floats.buffer) }] }
}
function tamper(change: (manifest: any) => void): Uint8Array {
  const files = unzipSync(encodeProject(sample())), manifest = JSON.parse(strFromU8(files['manifest.json']))
  change(manifest); files['manifest.json'] = strToU8(JSON.stringify(manifest)); return zipSync(files)
}
describe('project persistence', () => {
  it('round-trips exact water, pigment, paper seed, clock, and layers', () => {
    const original = sample(), restored = decodeProject(encodeProject(original))
    expect(restored).toEqual(original)
  })
  it('rejects future versions without guessing at their schema', () => expect(() => decodeProject(tamper(m => m.version = 2))).toThrow('version'))
  it('rejects out-of-bounds data before it reaches the GPU', () => expect(() => decodeProject(tamper(m => m.layers[0].bounds.width = 2048))).toThrow('bounds'))
  it('rejects inconsistent pigment data sizes', () => expect(() => decodeProject(tamper(m => m.layers[0].bounds.width = 3))).toThrow('pigment data'))
  it('rejects duplicate layer identifiers', () => expect(() => decodeProject(tamper(m => m.layers.push(m.layers[0])))).toThrow('identifier'))
  it('rejects NaN or negative simulation values', () => {
    const document = sample(); new Float32Array(document.layers[0].state.buffer)[0] = NaN
    expect(() => decodeProject(encodeProject(document))).toThrow('invalid values')
  })
  it('rejects truncated and unrelated files', () => expect(() => decodeProject(new Uint8Array([1,2,3]))).toThrow())
  it('rejects dimensions beyond the advertised maximum', () => expect(() => decodeProject(tamper(m => m.width = 4096))).toThrow('canvas size'))
  it('requires the selected layer to exist', () => expect(() => decodeProject(tamper(m => m.activeId = 'missing'))).toThrow('active layer'))
  it('retains stronger spread and accepts older projects without it', () => {
    const document = sample(); document.layers[0].spread = 8
    expect(decodeProject(encodeProject(document)).layers[0].spread).toBe(8)
    expect(decodeProject(encodeProject(sample())).layers[0].spread).toBeUndefined()
  })
  it('rejects unsafe spread and malformed transforms', () => {
    expect(() => decodeProject(tamper(m => m.layers[0].spread = 20))).toThrow('spread')
    expect(() => decodeProject(tamper(m => m.layers[0].meta.transform = { x: 0 }))).toThrow('transform')
  })
  it('retains paper appearance and rejects malformed paper settings', () => {
    const document = sample(); document.paper = { color: '#eee2c8', grain: 1.7 }
    expect(decodeProject(encodeProject(document)).paper).toEqual(document.paper)
    expect(decodeProject(encodeProject(sample())).paper).toBeUndefined()
    expect(() => decodeProject(tamper(m => m.paper = { color: 'url(invalid)', grain: 1 }))).toThrow('paper')
    expect(() => decodeProject(tamper(m => m.paper = { color: '#ffffff', grain: -1 }))).toThrow('paper')
  })
})

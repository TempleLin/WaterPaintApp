// The spectral upsampling and D65 color matching data come from Spectral.js
// (MIT, Ronald van Wijnen). See THIRD_PARTY_NOTICES.md.
import { Color } from 'spectral.js'

// Eight integrated wavelength bands keep pigment transport affordable. Unlike
// RGB interpolation, absorption coefficients are additive under mixing.
export const BANDS = [0, 6, 10, 13, 16, 19, 22, 26, 38]
export const CMF = Array.from({ length: 38 }, (_, i) => {
  const r = Array(38).fill(0); r[i] = 1
  return new Color(r).XYZ
})
export const BAND_XYZ = BANDS.slice(0, -1).map((start, band) =>
  [0, 1, 2].map(c => CMF.slice(start, BANDS[band + 1]).reduce((s, xyz) => s + xyz[c], 0)))

const cache = new Map<string, number[]>()
export function pigmentKS(hex: string): number[] {
  const cached = cache.get(hex)
  if (cached) return cached
  const reflectance = new Color(hex).R
  const coefficients = BANDS.slice(0, -1).map((start, band) => {
    let value = 0, weight = 0
    for (let i = start; i < BANDS[band + 1]; i++) {
      const w = CMF[i][0] + CMF[i][1] + CMF[i][2]
      value += reflectance[i] * w; weight += w
    }
    const r = Math.max(.001, Math.min(1, value / weight))
    return (1 - r) ** 2 / (2 * r)
  })
  if (cache.size > 512) cache.clear()
  cache.set(hex, coefficients)
  return coefficients
}
export function reflectance(ks: number): number {
  // Rationalized form avoids catastrophic cancellation for dark pigments.
  return 1 / (1 + ks + Math.sqrt(ks * ks + 2 * ks))
}
export function spectralRGB(ks: number[]): number[] {
  const xyz = [0, 0, 0]
  ks.forEach((k, i) => BAND_XYZ[i].forEach((w, c) => { xyz[c] += reflectance(k) * w }))
  const linear = [
    3.24096994 * xyz[0] - 1.53738318 * xyz[1] - .49861076 * xyz[2],
    -.96924364 * xyz[0] + 1.87596750 * xyz[1] + .04155506 * xyz[2],
    .05563008 * xyz[0] - .20397696 * xyz[1] + 1.05697151 * xyz[2]
  ]
  return linear.map(v => Math.max(0, Math.min(1, v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055)))
}

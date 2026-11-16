import { describe, expect, it } from 'vitest'
import { chartOffsetMagnitude, chartPointError, chartScrollMagnitude } from './chartGeometry'

describe('cotas de las mediciones HTML de Chart', () => {
  it('encierra offsets usados tras ToFloat, división Float32, trunc6 y Round', () => {
    // Recorrido hacia delante de HTMLElement::AdjustedOffsetForZoom; la cota
    // inversa no conoce estos enteros ni usa el offset como posición exportada.
    for (const e of [1 / 16, 1, Math.fround(1.4), 1.75, Math.fround(2.1), 64]) {
      for (const rawUnit of [-(2 ** 26) + 1, -123457, -33, -1, 0, 1, 31, 33, 123457, 2 ** 26 - 1]) {
        const raw = rawUnit / 64
        const divided = Math.fround((Math.fround(rawUnit) / 64) / e)
        const adjusted = Math.trunc(divided * 64)
        const rounded = Math.trunc(adjusted / 64) + ((adjusted % 64 + 32) >> 6)
        const bound = chartOffsetMagnitude(rounded, { lo: e, hi: e })
        expect(bound).toBeGreaterThanOrEqual(Math.abs(raw))
      }
    }
  })

  it('acota la pérdida por aplanado y cancelación sin usar el residuo observado', () => {
    const paths = [
      { offsets: [1000 + 1 / 64, -997 + 3 / 64], scales: [Math.fround(0.37), 1] },
      { offsets: [-2048 + 31 / 64, 2047 + 1 / 64], scales: [Math.fround(1.4), Math.fround(1.8)] },
      { offsets: [4096 + 1 / 64, -4095 + 3 / 64, 2 + 1 / 64], scales: [1, 1, 1] }
    ]
    for (const path of paths) {
      const start = 103 / 64
      let rounded = start, exact = start, magnitude = Math.abs(start), amplification = 1
      path.offsets.forEach((offset, i) => {
        const scale = path.scales[i]
        rounded = Math.fround(Math.fround(rounded + Math.fround(offset)) * scale)
        exact = (exact + offset) * scale
        magnitude = (magnitude + Math.abs(offset)) * Math.max(1, scale)
        amplification *= Math.max(1, scale)
      })
      const bound = chartPointError(magnitude, path.offsets.length, amplification)
      expect(Math.abs(rounded - exact)).toBeLessThanOrEqual(bound)
    }
  })

  it('mantiene el scroll de ventana en InitialZoom aunque el elemento raíz tenga CSS zoom menor que uno', () => {
    const rawScroll = 100000 + 1 / 64, initialZoom = 2
    const windowScroll = rawScroll / initialZoom
    const rootEffectiveZoom = { lo: 0.25, hi: 0.25 }
    for (const sign of [-1, 1]) {
      expect(chartScrollMagnitude(sign * windowScroll, rootEffectiveZoom, initialZoom)).toBeGreaterThanOrEqual(rawScroll)
      // La otra rama representa un scroll de elemento ordinario y no puede
      // sustituir a la de ventana: aquí omitiría casi todo el desplazamiento.
      expect(chartScrollMagnitude(sign * windowScroll, rootEffectiveZoom)).toBeLessThan(rawScroll / 4)
    }
  })

  it('rechaza offsets saturados, ramas sin límite y magnitudes fuera del dominio demostrado', () => {
    for (const offset of [NaN, Infinity, 0.5, 2 ** 25 - 1, -(2 ** 25 - 1)]) {
      expect(() => chartOffsetMagnitude(offset, { lo: 1, hi: 1 })).toThrow()
    }
    for (const args of [[-1, 0, 1], [1, 129, 1], [1, 0.5, 1], [1, 1, 0.5], [Infinity, 1, 1], [2 ** 18, 1, 1]]) {
      expect(() => chartPointError(args[0], args[1], args[2])).toThrow()
    }
  })
})

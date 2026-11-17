import { describe, expect, it } from 'vitest'
import { rootFontSize } from './theme'

describe('tamaño del texto', () => {
  it('la raíz crece en la misma proporción que el ajuste (la escala t-* va en rem)', () => {
    expect(rootFontSize(1)).toBe(15)
    expect(rootFontSize(1.3) / rootFontSize(1)).toBeCloseTo(1.3, 5)
    expect(rootFontSize(1.05)).toBe(15.75)
    expect(rootFontSize(0.85)).toBe(12.75)
  })
  it('se queda dentro de sus límites', () => {
    expect(rootFontSize(3)).toBe(21)
    expect(rootFontSize(0.1)).toBe(12.75)
    expect(rootFontSize(Number.NaN)).toBe(15)
  })
})

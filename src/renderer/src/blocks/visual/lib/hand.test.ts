import { describe, expect, it } from 'vitest'
import { handPath } from './hand'

describe('trazo a mano: coste acotado', () => {
  it('usa el camino original si decorarlo produciría demasiados puntos', () => {
    // DrawingCanvas ya usa p.d cuando handPath devuelve una cadena vacía.
    expect(handPath([[-100000, -100000], [100000, 100000]], false, 1, 1.4).length).toBe(0)
    const zigzag: [number, number][] = Array.from({ length: 2000 }, (_, i) => i % 2 ? [400, 300] : [0, 0])
    expect(handPath(zigzag, false, 1, 1.4).length).toBe(0)
  })

  it('conserva el temblor determinista en un trazo normal', () => {
    const points: [number, number][] = [[0, 0], [200, 0]]
    expect(handPath(points, false, 7, 1.4)).toMatch(/^M.+C/)
    expect(handPath(points, false, 7, 1.4)).toBe(handPath(points, false, 7, 1.4))
    expect(handPath(points, false, 7, 1.4)).not.toBe(handPath(points, false, 8, 1.4))
  })
})

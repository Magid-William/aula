import { describe, expect, it } from 'vitest'
import { Fingers, middle, pinchFactor, spread } from './pinch'

describe('pellizcar una gráfica', () => {
  it('separar los dedos acerca (factor < 1) y juntarlos aleja, con tope', () => {
    expect(pinchFactor(100, 200)).toBeCloseTo(0.5)
    expect(pinchFactor(200, 100)).toBeCloseTo(2)
    expect(pinchFactor(100, 10000)).toBeCloseTo(1 / 8)
    expect(pinchFactor(0, 50)).toBe(1)
    expect(spread({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(middle({ x: 0, y: 0 }, { x: 4, y: 2 })).toEqual({ x: 2, y: 1 })
  })

  it('con dos dedos hay pellizco; al levantar uno, el otro sigue arrastrando', () => {
    const f = new Fingers<string>()
    expect(f.down(1, { x: 0, y: 0 }, 'vista')).toBe(false)
    expect(f.move(1, { x: 5, y: 0 })).toBeNull()
    expect(f.down(2, { x: 100, y: 0 }, 'vista')).toBe(true)
    expect(f.pinch).toMatchObject({ spread: 95, from: 'vista' })
    expect(f.move(2, { x: 205, y: 0 })).toEqual({ spread: 200, mid: { x: 105, y: 0 } })
    expect(f.up(1)).toEqual({ x: 205, y: 0 })
    expect(f.pinch).toBeNull()
    expect(f.up(2)).toBeNull()
    expect(f.count).toBe(0)
  })
})

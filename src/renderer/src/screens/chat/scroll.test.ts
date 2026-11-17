import { describe, expect, it } from 'vitest'
import { anchorCap, isNearBottom } from './scroll'

describe('isNearBottom', () => {
  it('pegado al final con un margen', () => {
    expect(isNearBottom(500, 400, 900)).toBe(true)
    expect(isNearBottom(470, 400, 900)).toBe(true)
    expect(isNearBottom(300, 400, 900)).toBe(false)
    expect(isNearBottom(0, 400, 300)).toBe(true)
  })
})

describe('anchorCap', () => {
  it('la pregunta se queda arriba con aire: no se baja más allá de su principio', () => {
    // la pregunta, 300 px por debajo del borde de arriba del desplazador, que ya bajó 1000 px
    expect(anchorCap(400, 100, 1000)).toBe(1284)
    expect(anchorCap(400, 100, 1000, 0)).toBe(1300)
    // nunca por encima del principio
    expect(anchorCap(50, 100, 10)).toBe(0)
  })
})

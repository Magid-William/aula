// Las fichas del mes: cuántas caben y cuáles van en dos líneas.
import { describe, expect, it } from 'vitest'
import { CHIP, fitChips, hourLabel, swipeStep } from './util'

describe('fichas del mes', () => {
  it('sin sitio o sin eventos, ninguna (quedan los puntos)', () => {
    expect(fitChips(10, 3)).toEqual({ shown: 0, wrap: 0 })
    expect(fitChips(80, 0)).toEqual({ shown: 0, wrap: 0 })
  })

  it('un evento con sitio de sobra va en dos líneas (el título entero)', () => {
    expect(fitChips(CHIP.wrap, 1)).toEqual({ shown: 1, wrap: 1 })
    expect(fitChips(CHIP.wrap - 1, 1)).toEqual({ shown: 1, wrap: 0 })
  })

  it('si caben todos en una línea, el sitio que sobra se da a los primeros', () => {
    const two = 2 * CHIP.line + CHIP.gap
    expect(fitChips(two, 2)).toEqual({ shown: 2, wrap: 0 })
    expect(fitChips(two + (CHIP.wrap - CHIP.line), 2)).toEqual({ shown: 2, wrap: 1 })
  })

  it('si no caben todos, van en una línea y la última lleva «+N»', () => {
    expect(fitChips(2 * CHIP.line + CHIP.gap, 5)).toEqual({ shown: 2, wrap: 0 })
  })
})

describe('horas de la semana', () => {
  it('cada idioma con su reloj', () => {
    expect(hourLabel(13, 'es-ES')).toBe('13:00')
    expect(hourLabel(8, 'es-ES')).toBe('08:00')
    expect(hourLabel(13, 'en-US').replace(/\s/g, ' ')).toBe('1 PM')
  })
})

describe('deslizar con el dedo', () => {
  it('a la izquierda, lo siguiente; a la derecha, lo anterior', () => {
    expect(swipeStep(-80, 5)).toBe(1)
    expect(swipeStep(90, -10)).toBe(-1)
  })
  it('un toque o un desplazamiento vertical no cambian nada', () => {
    expect(swipeStep(-20, 0)).toBe(0)
    expect(swipeStep(-60, 70)).toBe(0)
  })
})

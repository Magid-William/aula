// Frases con huecos para las cifras.
import { describe, expect, it } from 'vitest'
import { slot, splitSlots } from './sentence'

describe('frases con cifras dentro', () => {
  it('parte el texto en trozos y huecos, en orden', () => {
    const text = `En 12 semanas has estudiado ${slot('time')} en ${slot('days')} días.`
    expect(splitSlots(text)).toEqual([
      { kind: 'text', text: 'En 12 semanas has estudiado ' },
      { kind: 'slot', name: 'time' },
      { kind: 'text', text: ' en ' },
      { kind: 'slot', name: 'days' },
      { kind: 'text', text: ' días.' }
    ])
  })

  it('sin huecos, el texto entero; un hueco al principio o al final no deja trozos vacíos', () => {
    expect(splitSlots('Hola')).toEqual([{ kind: 'text', text: 'Hola' }])
    expect(splitSlots(`${slot('a')} y ${slot('b')}`)).toEqual([{ kind: 'slot', name: 'a' }, { kind: 'text', text: ' y ' }, { kind: 'slot', name: 'b' }])
  })

  it('una marca suelta (sin pareja) se queda como texto', () => {
    expect(splitSlots('a⁣b')).toEqual([{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }])
  })
})

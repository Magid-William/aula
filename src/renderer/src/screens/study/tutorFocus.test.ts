// El foco al cerrar el tutor en columna: vuelve a lo que lo abrió, o al botón del tutor, o al ejercicio.
import { describe, expect, it } from 'vitest'
import { canTakeFocus, exerciseTarget, focusBackTarget, shouldMoveFocus, type FocusCandidate } from './tutorFocus'

function el(name: string, opts: { connected?: boolean; visible?: boolean; blocked?: boolean } = {}): FocusCandidate & { name: string } {
  const { connected = true, visible = true, blocked = false } = opts
  return {
    name,
    isConnected: connected,
    getClientRects: () => ({ length: visible ? 1 : 0 }),
    closest: () => (blocked ? {} : null)
  }
}

describe('el foco al cerrar el tutor', () => {
  it('vuelve a lo que lo abrió si sigue en la página', () => {
    const opener = el('explicar')
    expect(focusBackTarget([opener, el('tutor'), el('ejercicio')])).toBe(opener)
  })

  it('si lo que lo abrió ya no está, se ve o se puede pulsar, prueba el botón del tutor y luego el ejercicio', () => {
    const button = el('tutor')
    expect(focusBackTarget([el('explicar', { connected: false }), button, el('ejercicio')])).toBe(button)
    expect(focusBackTarget([el('explicar', { visible: false }), null, el('ejercicio')])?.name).toBe('ejercicio')
    expect(focusBackTarget([el('explicar', { blocked: true }), undefined, el('ejercicio')])?.name).toBe('ejercicio')
    expect(focusBackTarget([null, undefined])).toBeNull()
  })

  it('no se enfoca nada desactivado ni de una pantalla inerte', () => {
    expect(canTakeFocus(el('x', { blocked: true }))).toBe(false)
    expect(canTakeFocus(el('x'))).toBe(true)
    expect(canTakeFocus(null)).toBe(false)
  })

  it('en el ejercicio, el campo de la respuesta antes que «Salir» de la cápsula', () => {
    const exit = { tagName: 'BUTTON' }
    const answer = { tagName: 'INPUT' }
    expect(exerciseTarget([exit, answer, { tagName: 'BUTTON' }])).toBe(answer)
    expect(exerciseTarget([exit, { tagName: 'TEXTAREA' }])?.tagName).toBe('TEXTAREA')
    expect(exerciseTarget([exit])).toBe(exit)
    expect(exerciseTarget([])).toBeNull()
  })

  it('solo se mueve si estaba dentro del tutor o se perdió en <body>', () => {
    const body = {}
    expect(shouldMoveFocus(body, body, false)).toBe(true)
    expect(shouldMoveFocus(null, body, false)).toBe(true)
    expect(shouldMoveFocus({}, body, true)).toBe(true)
    // lo cerró con el botón del tutor: el foco ya está ahí
    expect(shouldMoveFocus({}, body, false)).toBe(false)
  })
})

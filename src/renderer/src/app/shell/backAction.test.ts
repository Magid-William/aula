import { describe, expect, it } from 'vitest'
import { backAction } from './backAction'

describe('«atrás» del sistema en un dispositivo', () => {
  it('primero cierra lo que está abierto encima, luego vuelve atrás', () => {
    expect(backAction({ overlay: true, canBack: true, compact: true, route: 'course' })).toBe('overlay')
    expect(backAction({ overlay: false, canBack: true, compact: true, route: 'course' })).toBe('back')
  })
  it('en el teléfono, desde otra pestaña sin historial va a «Hoy»; en «Hoy» sale de la app', () => {
    expect(backAction({ overlay: false, canBack: false, compact: true, route: 'calendar' })).toBe('home')
    expect(backAction({ overlay: false, canBack: false, compact: true, route: 'home' })).toBeNull()
  })
  it('en la tableta (sin pestañas abajo), sin historial no hace nada', () => {
    expect(backAction({ overlay: false, canBack: false, compact: false, route: 'calendar' })).toBeNull()
  })
})

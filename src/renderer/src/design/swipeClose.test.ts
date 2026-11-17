import { describe, expect, it } from 'vitest'
import { canScrollWith, shouldClose } from './swipeClose'

describe('arrastrar una hoja para cerrarla', () => {
  it('se cierra si llega lejos o va rápida; un roce rápido no', () => {
    expect(shouldClose(130, 0)).toBe(true)
    expect(shouldClose(60, 900)).toBe(true)
    expect(shouldClose(60, 200)).toBe(false)
    expect(shouldClose(10, 2000)).toBe(false)
  })
  it('lo que aún se desplaza hacia el dedo se queda el gesto', () => {
    // una lista a medio leer: el dedo hacia abajo la lleva hacia arriba
    expect(canScrollWith({ scroll: 200, size: 1000, view: 400 }, 1)).toBe(true)
    // arriba del todo: el gesto es de la hoja
    expect(canScrollWith({ scroll: 0, size: 1000, view: 400 }, 1)).toBe(false)
    // sin nada que desplazar, nunca
    expect(canScrollWith({ scroll: 0, size: 400, view: 400 }, -1)).toBe(false)
    // hacia la izquierda (el panel de la izquierda): solo si queda contenido a la derecha
    expect(canScrollWith({ scroll: 0, size: 900, view: 300 }, -1)).toBe(true)
    expect(canScrollWith({ scroll: 600, size: 900, view: 300 }, -1)).toBe(false)
  })
})

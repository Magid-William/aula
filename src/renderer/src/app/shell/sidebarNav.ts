// Ir a una pantalla desde la barra lateral sin dejarle el foco a la fila cuando se pulsa con el ratón.
import type { MouseEvent } from 'react'
import { navigate, type Route } from '../router'

/** Con el ratón, la fila no se queda con el foco: si no, la primera tecla que se pulse después (Esc, una flecha) le pone el
 *  anillo de foco aunque ya se esté en otra pantalla. Con el teclado (Intro, Espacio: `detail` 0), sí se lo queda. */
export function goFromSidebar(e: MouseEvent<HTMLElement>, route: Route): void {
  navigate(route)
  if (e.detail > 0) e.currentTarget.blur()
}

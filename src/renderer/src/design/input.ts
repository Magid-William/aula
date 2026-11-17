// Con qué se maneja la pantalla: ratón y teclado (el Mac, el PC, un iPad con trackpad) o solo el dedo (teléfono, tableta).
// Lo de ratón y teclado (teclas de atajo, pistas al pasar por encima, «haz clic», autofoco que saca el teclado) no se enseña
// en una pantalla táctil. La misma consulta que la variante `touch:` de styles.css.
import { useMedia } from './theme'

/** Pantalla táctil sin ratón: sin «hover» o con un puntero grueso (el dedo). */
export const TOUCH_QUERY = '(hover: none), (pointer: coarse)'

/** ¿Se maneja con el dedo? (en el escritorio, nunca). */
export function isTouchOnly(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(TOUCH_QUERY).matches
}

/** ¿Se puede enfocar un campo solo, sin que lo pidan? Con el dedo no: sacaría el teclado de la pantalla. */
export function canAutoFocus(): boolean {
  return !isTouchOnly()
}

/** `isTouchOnly`, al día si cambia (un iPad al que se le conecta un trackpad). */
export function useTouchOnly(): boolean {
  return useMedia(TOUCH_QUERY)
}

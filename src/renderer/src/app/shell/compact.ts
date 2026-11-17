// ¿Pantalla de teléfono? (pestañas abajo y sin barra lateral; App.tsx pone `compact` en <html>). Se decide por el ancho y
// por el aparato, nunca por la altura: en el iPad apaisado, al abrir el teclado la vista web encoge a unos 500 px y, con
// una regla de altura, la app se pasaba al diseño de teléfono mientras se escribía (y volvía al cerrar el teclado).
//  - estrecha (hasta 700 px de ancho): un teléfono en vertical, el iPad partido o en Slide Over, una ventana estrecha;
//  - un teléfono también girado: táctil y con el lado corto de la PANTALLA (no de la ventana) de teléfono.
import { useSyncExternalStore } from 'react'

export const NARROW_QUERY = '(max-width: 700px)'
const COARSE_QUERY = '(pointer: coarse)'
/** El lado corto de la pantalla de un teléfono, como mucho (el iPhone más grande mide 440; el iPad más pequeño, 744). */
export const PHONE_SCREEN_MAX = 500

/** La decisión, sin tocar la página (para probarla sola). `screenShort`: el lado corto de la pantalla (0 si no se sabe). */
export function decideCompact(s: { narrow: boolean; coarse: boolean; screenShort: number }): boolean {
  return s.narrow || (s.coarse && s.screenShort > 0 && s.screenShort <= PHONE_SCREEN_MAX)
}

function read(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  const screen = window.screen
  return decideCompact({
    narrow: window.matchMedia(NARROW_QUERY).matches,
    coarse: window.matchMedia(COARSE_QUERY).matches,
    screenShort: screen ? Math.min(screen.width, screen.height) : 0
  })
}

let current = false
let wired = false
const listeners = new Set<() => void>()

function update(): void {
  const next = read()
  if (next === current) return
  current = next
  for (const fn of listeners) fn()
}

/** Se escucha una sola vez para toda la app: el ancho, el puntero y girar (la pantalla no avisa por sí sola). */
function wire(): void {
  if (wired || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  wired = true
  current = read()
  window.matchMedia(NARROW_QUERY).addEventListener('change', update)
  window.matchMedia(COARSE_QUERY).addEventListener('change', update)
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
}

/** ¿Pantalla de teléfono, ahora? */
export function isCompact(): boolean {
  wire()
  return current
}

function subscribe(fn: () => void): () => void {
  wire()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** ¿La ventana es de teléfono? (se entera si cambia: girar el dispositivo, partir la pantalla del iPad). */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribe, isCompact, () => false)
}

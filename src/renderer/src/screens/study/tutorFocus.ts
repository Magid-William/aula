// Adónde vuelve el foco al cerrar el tutor en columna (el cajón ya lo devuelve él, como todo diálogo): a lo que lo abrió si
// sigue en la página; si no, al botón del tutor o al ejercicio. Sin esto, Esc o × dejaban el foco en <body> y Tab volvía a
// empezar por la barra lateral.

/** Lo que hace falta de un elemento para decidir (así se prueba sin DOM). */
export interface FocusCandidate {
  readonly isConnected: boolean
  getClientRects(): { readonly length: number }
  closest(selectors: string): unknown
}

/** Sigue en la página, se ve, y no está desactivado ni en una pantalla que se va (inerte u oculta). */
export function canTakeFocus<T extends FocusCandidate>(el: T | null | undefined): el is T {
  return !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[inert], [disabled], [aria-hidden="true"]')
}

/** El primero de la lista (por orden de preferencia) que puede recibir el foco. */
export function focusBackTarget<T extends FocusCandidate>(candidates: readonly (T | null | undefined)[]): T | null {
  return candidates.find((el): el is T => canTakeFocus(el)) ?? null
}

/** En el ejercicio, el campo de la respuesta; si no hay, lo primero que se puede enfocar (la cápsula de arriba). */
export function exerciseTarget<T extends { readonly tagName: string }>(tabbables: readonly T[]): T | null {
  return tabbables.find((el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ?? tabbables[0] ?? null
}

/** Al cerrarse, el foco solo se mueve si estaba dentro del tutor o se había perdido en <body>: si el estudiante ya está en
 *  otro sitio (lo cerró con el botón del tutor), se respeta. */
export function shouldMoveFocus(active: unknown, body: unknown, inPanel: boolean): boolean {
  return active === null || active === body || inPanel
}

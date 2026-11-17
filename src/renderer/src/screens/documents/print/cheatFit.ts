// La chuleta cabe en una sola página: si no cabe, se quita primero lo menos importante (la prioridad de cada sección: 0 =
// imprescindible, nunca se quita). La medida la hace la vista de impresión; aquí, qué se quita y la búsqueda del corte.
import type { DocumentSection } from '@shared/documents'

/** Cuántas cosas se podrían quitar: todo lo que no es imprescindible. */
export function removable(sections: readonly DocumentSection[]): number {
  return sections.reduce((n, s) => n + (s.priority > 0 ? s.items.length : 0), 0)
}

/** La chuleta sin las `cut` cosas menos importantes: desde el final de la sección de menor prioridad (la de número más alto),
 *  y así hacia las más importantes. Una sección que se queda vacía desaparece; el orden de las secciones no cambia. */
export function trimCheat(sections: readonly DocumentSection[], cut: number): DocumentSection[] {
  const keep = new Map(sections.map((s, i) => [i, s.items.length]))
  let left = Math.max(0, Math.floor(cut))
  const order = sections.map((s, i) => ({ s, i })).filter(({ s }) => s.priority > 0).sort((a, b) => b.s.priority - a.s.priority || b.i - a.i)
  for (const { s, i } of order) {
    if (left <= 0) break
    const take = Math.min(left, s.items.length)
    keep.set(i, s.items.length - take)
    left -= take
  }
  return sections.flatMap((s, i) => {
    const n = keep.get(i) ?? s.items.length
    if (n === s.items.length) return [s]
    return n > 0 ? [{ ...s, items: s.items.slice(0, n) }] : []
  })
}

/** Búsqueda binaria del menor corte que cabe (caber es monótono: quitar más nunca hace que deje de caber).
 *  `lo`: el mayor corte que se sabe que NO cabe; `hi`: el menor que se sabe que sí (max + 1 si ninguno). */
export interface FitSearch {
  lo: number
  hi: number
  /** El corte que se está probando (o el elegido, al terminar). */
  cut: number
  done: boolean
  /** Ni quitándolo todo cabe: va entera, en varias páginas. */
  overflow: boolean
}

export function startFit(): FitSearch {
  return { lo: -1, hi: Number.POSITIVE_INFINITY, cut: 0, done: false, overflow: false }
}

/** Un paso: con `fits` (¿cabe con `s.cut`?) decide el siguiente corte o termina. */
export function stepFit(s: FitSearch, fits: boolean, max: number): FitSearch {
  const lo = fits ? s.lo : s.cut
  const hi = fits ? s.cut : Math.min(s.hi, max + 1)
  if (hi - lo <= 1) return hi > max ? { lo, hi, cut: 0, done: true, overflow: true } : { lo, hi, cut: hi, done: true, overflow: false }
  return { lo, hi, cut: Math.floor((lo + hi) / 2), done: false, overflow: false }
}

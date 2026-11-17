// Lógica pura de Repasar: qué pasos del plan de hoy son repaso (tarjetas, errores y práctica; sin la hoja de fórmulas), lo que
// suman (para la frase de arriba, sin ceros y con lo que cabe: «8 de tus 33 errores»), lo firme que está un mazo, «9 de 10 bien» de un tema y el pegamento que evita
// que la última palabra de un título se quede sola en su línea.
import { FSRS, type PlanItem } from '@engine/learn'
import type { Attempt, CardProgress } from '@shared/schema'

/** Ejercicios de una sesión de práctica (la práctica es de 10). */
export const PRACTICE_SESSION = 10

/** Los pasos de repaso del plan de hoy, en su orden: tarjetas, errores y práctica (la hoja de fórmulas es otra cosa). */
export function reviewPlanItems(items: readonly PlanItem[]): PlanItem[] {
  return items.filter((i) => i.minutes > 0 && ((i.kind === 'review' && i.id !== 'formulas') || i.kind === 'mistakes' || i.kind === 'practice'))
}

export interface ReviewCounts {
  /** Tarjetas que tocan (las mismas que cuenta el plan), si hay paso de tarjetas. */
  cards?: number
  /** Las que caben en el paso de tarjetas, si son menos de las que tocan. */
  cardsFit?: number
  /** Errores que tocan hoy, si hay paso de errores. */
  mistakes?: number
  /** Los que caben en el paso de errores, si son menos de los que tocan («8 de tus 33»). */
  mistakesFit?: number
  /** Ejercicios de práctica (10 por paso), si hay pasos de práctica. */
  practice?: number
  minutes: number
}

/** Lo que suma el repaso de hoy, con las cifras del plan (las mismas que Hoy y el Resumen). Solo cuenta lo que tiene su paso
 *  en el plan y nunca un cero; si el paso no da para todo, cuántos caben. */
export function reviewCounts(items: readonly PlanItem[], due: { cards: number; mistakes: number }): ReviewCounts {
  const step = (k: PlanItem['kind']): PlanItem | undefined => items.find((i) => i.kind === k && i.id !== 'formulas')
  const fit = (s: PlanItem | undefined, n: number): number | undefined => (s?.count !== undefined && s.count > 0 && s.count < n ? s.count : undefined)
  const cards = step('review')
  const mistakes = step('mistakes')
  const practice = items.filter((i) => i.kind === 'practice').length * PRACTICE_SESSION
  const cardsFit = fit(cards, due.cards)
  const mistakesFit = fit(mistakes, due.mistakes)
  return {
    ...(cards && due.cards > 0 ? { cards: due.cards, ...(cardsFit ? { cardsFit } : {}) } : {}),
    ...(mistakes && due.mistakes > 0 ? { mistakes: due.mistakes, ...(mistakesFit ? { mistakesFit } : {}) } : {}),
    ...(practice > 0 ? { practice } : {}),
    minutes: items.reduce((a, i) => a + i.minutes, 0)
  }
}

/** Días que estabiliza una tarjeta bien aprendida: a partir de aquí cuenta entera. */
const FIRM_DAYS = 21

/**
 * Lo firme que está un mazo (0…1): la media de sus tarjetas, cada una con la probabilidad de recordarla hoy por lo asentada que
 * está (estabilidad hasta 21 días). Una tarjeta nueva cuenta 0: así la barra no sale llena por haberlas visto una vez.
 */
export function deckStrength(cards: ReadonlyArray<CardProgress | undefined>, now: Date): number {
  if (!cards.length) return 0
  const one = (p: CardProgress | undefined): number => {
    if (!p || p.reps === 0 || !(p.stability > 0)) return 0
    const last = p.lastReview ? new Date(p.lastReview).getTime() : NaN
    const days = Number.isFinite(last) ? Math.max(0, (now.getTime() - last) / 86_400_000) : 0
    return FSRS.retrievability(days, p.stability) * Math.min(1, p.stability / FIRM_DAYS)
  }
  return cards.reduce((a, p) => a + one(p), 0) / cards.length
}

/** «9 de 10 bien»: aciertos enteros en los últimos `n` intentos de un tema (sin intentos, nada). */
export function rightOfLast(attempts: readonly Pick<Attempt, 'credit'>[], n = 10): { right: number; total: number } | undefined {
  const last = attempts.slice(-n)
  if (!last.length) return undefined
  return { right: last.filter((a) => a.credit >= 0.999).length, total: last.length }
}

/** Une la última palabra (corta, o una fórmula como «$t$») a la anterior con un espacio duro: no se queda sola en su línea. */
export function glueLastWord(text: string): string {
  return text.replace(/ ((?:\$[^$\s]{1,6}\$|[^\s$]{1,3})[.,;:!?)]?)$/u, ' $1')
}

/** Los primeros `limit` elementos de una lista agrupada (por tema), en su orden y sin grupos vacíos: el cuaderno de errores
 *  plegado enseña unos pocos con su tema encima, no los 33. */
export function previewGroups<K, T>(groups: ReadonlyArray<{ skill: K; items: readonly T[] }>, limit: number): Array<{ skill: K; items: T[] }> {
  const out: Array<{ skill: K; items: T[] }> = []
  let left = limit
  for (const g of groups) {
    if (left <= 0) break
    const items = g.items.slice(0, left)
    if (!items.length) continue
    out.push({ skill: g.skill, items })
    left -= items.length
  }
  return out
}

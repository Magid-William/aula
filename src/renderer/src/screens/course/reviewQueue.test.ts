import { describe, expect, it } from 'vitest'
import type { PlanItem } from '@engine/learn'
import type { CardProgress } from '@shared/schema'
import { deckStrength, glueLastWord, previewGroups, reviewCounts, reviewPlanItems, rightOfLast } from './reviewQueue'

const item = (id: string, kind: PlanItem['kind'], minutes = 5): PlanItem => ({ id, kind, skillID: null, title: id, minutes, reason: '' })

describe('reviewPlanItems', () => {
  it('se queda con tarjetas, errores y práctica, sin la hoja de fórmulas ni lo demás', () => {
    const plan = [item('review', 'review'), item('formulas', 'review'), item('mistakes', 'mistakes'), item('learn:a', 'learn'), item('practice:b', 'practice'), item('mock', 'mock'), item('rest', 'rest', 0)]
    expect(reviewPlanItems(plan).map((i) => i.id)).toEqual(['review', 'mistakes', 'practice:b'])
  })
})

describe('reviewCounts', () => {
  it('suma lo que tiene paso y los minutos', () => {
    const items = reviewPlanItems([item('review', 'review', 2), item('mistakes', 'mistakes', 13), item('practice:a', 'practice', 8)])
    expect(reviewCounts(items, { cards: 4, mistakes: 31 })).toEqual({ cards: 4, mistakes: 31, practice: 10, minutes: 23 })
  })
  it('lo que cabe en cada paso, si no da para todo (la cifra del plan: «8 de tus 33 errores»)', () => {
    const items = [{ ...item('review', 'review', 2), count: 4 }, { ...item('mistakes', 'mistakes', 13), count: 8 }]
    expect(reviewCounts(items, { cards: 4, mistakes: 33 })).toEqual({ cards: 4, mistakes: 33, mistakesFit: 8, minutes: 15 })
    // la hoja de fórmulas no es el paso de tarjetas
    expect(reviewCounts([{ ...item('formulas', 'review', 5), count: 1 }], { cards: 9, mistakes: 0 })).toEqual({ minutes: 5 })
  })
  it('nunca un cero: sin tarjetas o sin paso, no sale', () => {
    expect(reviewCounts([item('review', 'review')], { cards: 0, mistakes: 3 })).toEqual({ minutes: 5 })
    expect(reviewCounts([], { cards: 4, mistakes: 3 })).toEqual({ minutes: 0 })
  })
})

describe('deckStrength', () => {
  const now = new Date('2026-11-16T12:00:00Z')
  const card = (stability: number, daysAgo: number, reps = 3): CardProgress => ({ phase: 'review', due: now.toISOString(), stability, difficulty: 5, reps, lapses: 0, step: 0, lastReview: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() })
  it('las nuevas cuentan cero: vistas una vez no llenan la barra', () => {
    expect(deckStrength([undefined, undefined], now)).toBe(0)
    expect(deckStrength([card(1, 0, 0)], now)).toBe(0)
  })
  it('una tarjeta recién repasada pero poco asentada pesa poco; una asentada, casi entera', () => {
    expect(deckStrength([card(2, 0)], now)).toBeCloseTo(2 / 21, 3)
    expect(deckStrength([card(60, 0)], now)).toBeCloseTo(1, 3)
    expect(deckStrength([card(60, 30)], now)).toBeLessThan(1)
    expect(deckStrength([card(60, 0), undefined], now)).toBeCloseTo(0.5, 3)
  })
  it('sin tarjetas, cero', () => {
    expect(deckStrength([], now)).toBe(0)
  })
})

describe('rightOfLast', () => {
  it('cuenta los aciertos enteros de los últimos 10', () => {
    const credits = [0, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 1, 1]
    expect(rightOfLast(credits.map((credit) => ({ credit })))).toEqual({ right: 9, total: 10 })
    expect(rightOfLast([])).toBeUndefined()
  })
})

describe('glueLastWord', () => {
  it('pega una palabra corta o una fórmula al final', () => {
    expect(glueLastWord('Unit-circle coordinates and arc distance t')).toBe('Unit-circle coordinates and arc distance t')
    expect(glueLastWord('Arc distance $t$')).toBe('Arc distance $t$')
    expect(glueLastWord('Graphs of sine and cosine')).toBe('Graphs of sine and cosine')
    expect(glueLastWord('one')).toBe('one')
  })
})

describe('previewGroups', () => {
  const groups = [{ skill: 'a', items: [1, 2, 3, 4] }, { skill: 'b', items: [] }, { skill: 'c', items: [5, 6, 7] }]
  it('los primeros, con su tema encima y sin temas vacíos', () => {
    expect(previewGroups(groups, 6)).toEqual([{ skill: 'a', items: [1, 2, 3, 4] }, { skill: 'c', items: [5, 6] }])
    expect(previewGroups(groups, 2)).toEqual([{ skill: 'a', items: [1, 2] }])
  })
  it('desplegado, todos', () => {
    expect(previewGroups(groups, Infinity)).toEqual([{ skill: 'a', items: [1, 2, 3, 4] }, { skill: 'c', items: [5, 6, 7] }])
  })
})

import { describe, expect, it } from 'vitest'
import { firstSentence, nextTopicId, shownMastery, type TopicMastery } from './topics'

const order = ['a', 'b', 'c', 'd']
const m = (entries: Array<[string, number, boolean]>): Map<string, TopicMastery> => new Map(entries.map(([id, mastery, seen]) => [id, { mastery, seen }]))
const all = (): boolean => true

describe('nextTopicId', () => {
  it('sigue por el tema que propone el plan, si se abre', () => {
    expect(nextTopicId(order, m([]), all, 'c')).toBe('c')
    expect(nextTopicId(order, m([]), (id) => id !== 'c', 'c')).toBe('a')
  })
  it('sin plan, el primero que aún no se domina (sin ver o por debajo del 85 %)', () => {
    expect(nextTopicId(order, m([['a', 0.9, true], ['b', 0.5, true]]), all)).toBe('b')
    expect(nextTopicId(order, m([['a', 0.9, true], ['b', 0.86, true]]), all)).toBe('c')
  })
  it('no propone uno que no se abre ni uno que no es del curso', () => {
    expect(nextTopicId(order, m([['a', 0.9, true]]), (id) => id !== 'b', 'zz')).toBe('c')
  })
  it('todo dominado: ninguno', () => {
    expect(nextTopicId(['a'], m([['a', 0.95, true]]), all)).toBeUndefined()
  })
})

describe('shownMastery', () => {
  it('un tema sin ver no enseña cifra (ni un cero)', () => {
    expect(shownMastery(undefined)).toBeUndefined()
    expect(shownMastery({ mastery: 0, seen: false })).toBeUndefined()
    expect(shownMastery({ mastery: 0.71, seen: true })).toBe(0.71)
    expect(shownMastery({ mastery: 1.4, seen: true })).toBe(1)
  })
})

describe('firstSentence', () => {
  it('se queda con la primera frase entera', () => {
    expect(firstSentence('Find the reference angle. Then switch units.')).toBe('Find the reference angle.')
    expect(firstSentence('Halla el ángulo. ¿Y después? Cambia de unidades.')).toBe('Halla el ángulo.')
  })
  it('no corta en abreviaturas ni decimales', () => {
    expect(firstSentence('Use s = rθ, e.g. for wheels.')).toBe('Use s = rθ, e.g. for wheels.')
    expect(firstSentence('Round to 3.5 cm and stop.')).toBe('Round to 3.5 cm and stop.')
  })
  it('vacío: vacío', () => {
    expect(firstSentence(undefined)).toBe('')
    expect(firstSentence('  ')).toBe('')
  })
})

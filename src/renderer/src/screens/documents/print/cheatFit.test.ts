// La chuleta en una página: qué se quita primero y la búsqueda del corte.
import { describe, expect, it } from 'vitest'
import type { DocumentItem, DocumentSection } from '@shared/documents'
import { removable, startFit, stepFit, trimCheat } from './cheatFit'

const items = (n: number, tag: string): DocumentItem[] => Array.from({ length: n }, (_, i) => ({ type: 'markdown', md: `${tag}${i}` }))
const sec = (id: string, priority: number, n: number): DocumentSection => ({ id, role: 'content', title: id, toc: false, newPage: false, priority, items: items(n, id) })
const ids = (ss: DocumentSection[]) => ss.map((s) => `${s.id}:${s.items.length}`)

describe('la chuleta cabe en una página', () => {
  const sheet = [sec('formulas', 0, 5), sec('definitions', 1, 4), sec('mistakes', 2, 3), sec('terms', 3, 6)]

  it('lo imprescindible no cuenta como quitable', () => {
    expect(removable(sheet)).toBe(13)
  })

  it('quita primero lo de menor prioridad, desde el final, y deja el orden de las secciones', () => {
    expect(ids(trimCheat(sheet, 0))).toEqual(['formulas:5', 'definitions:4', 'mistakes:3', 'terms:6'])
    expect(ids(trimCheat(sheet, 2))).toEqual(['formulas:5', 'definitions:4', 'mistakes:3', 'terms:4'])
    const t = trimCheat(sheet, 2)[3]
    expect(t.items.map((x) => (x.type === 'markdown' ? x.md : ''))).toEqual(['terms0', 'terms1', 'terms2', 'terms3'])
    // una sección vacía desaparece; después, los errores
    expect(ids(trimCheat(sheet, 7))).toEqual(['formulas:5', 'definitions:4', 'mistakes:2'])
    // todo lo quitable fuera: solo las fórmulas
    expect(ids(trimCheat(sheet, 99))).toEqual(['formulas:5'])
  })

  it('busca el menor corte que cabe', () => {
    const max = 13
    const fitsFrom = 6 // cabe con 6 o más quitadas
    let s = startFit()
    let tries = 0
    while (!s.done && tries < 20) {
      s = stepFit(s, s.cut >= fitsFrom, max)
      tries++
    }
    expect(s).toMatchObject({ done: true, overflow: false, cut: 6 })
    expect(tries).toBeLessThanOrEqual(6)
  })

  it('si cabe entera, no quita nada (una sola prueba)', () => {
    expect(stepFit(startFit(), true, 13)).toMatchObject({ done: true, overflow: false, cut: 0 })
  })

  it('si ni quitándolo todo cabe, va entera en varias páginas', () => {
    let s = startFit()
    while (!s.done) s = stepFit(s, false, 4)
    expect(s).toMatchObject({ done: true, overflow: true, cut: 0 })
  })
})

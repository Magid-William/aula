import { describe, expect, it } from 'vitest'
import { parseBlock, parseDeck } from './parser'

describe('dibujos guardados en chats y diapositivas', () => {
  it.each(['axis', 'ground', 'grid'])('conserva %s con extremos al volver a leer el JSON original', (kind) => {
    const raw = { type: 'drawing', width: 400, height: 300, items: [
      { kind, x1: 20, y1: 250, x2: 380, y2: 250, label: 'referencia' }
    ] }
    const expected = { type: 'drawing', items: [{ kind: 'line', x1: 20, y1: 250, x2: 380, y2: 250, label: 'referencia' }] }
    expect(parseBlock(JSON.stringify(raw))).toMatchObject(expected)
    const deck = parseDeck(JSON.stringify({ slides: [{ blocks: [raw] }] }))
    expect(deck?.slides).toHaveLength(1)
    expect(deck?.slides[0].blocks).toHaveLength(1)
    expect(deck?.slides[0].blocks[0]).toMatchObject(expected)
  })
})

describe('diagramas guardados con nombres de forma antiguos', () => {
  const nodes = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  const edges = [{ from: 'a', to: 'b' }]

  it.each(['venn', 'Venn', 'sets', 'euler'])('conserva los nodos y flechas de kind=%s sin conjuntos', (kind) => {
    const raw = { type: 'diagram', kind, nodes, edges }
    const block = parseBlock(JSON.stringify(raw))
    expect(block).toMatchObject({ type: 'diagram', kind: 'flow', nodes, edges })
    expect(block).not.toHaveProperty('form')
    const deck = parseDeck(JSON.stringify({ slides: [{ blocks: [raw] }] }))
    expect(deck?.slides[0].blocks[0]).toMatchObject({ type: 'diagram', kind: 'flow', nodes, edges })
  })

  it('sigue rechazando un Venn explícito inválido y leyendo los conjuntos válidos', () => {
    for (const raw of [
      { type: 'diagram', form: 'venn', nodes, edges },
      { type: 'venn', nodes, edges },
      { type: 'diagram', kind: 'venn', sets: [{ label: 'Solo uno' }], nodes, edges }
    ]) expect(parseBlock(JSON.stringify(raw))).toBeUndefined()
    expect(parseBlock(JSON.stringify({ type: 'diagram', kind: 'venn', nodes: nodes.map((n) => ({ ...n, shape: 'circle' })) })))
      .toMatchObject({ type: 'diagram', kind: 'concept', form: 'venn' })
    expect(parseBlock(JSON.stringify({ type: 'diagram', kind: 'venn', sets: ['A', 'B'] })))
      .toMatchObject({ type: 'diagram', kind: 'concept', form: 'venn' })
  })
})

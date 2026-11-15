import { describe, expect, it } from 'vitest'
import { figureContentOf, studentTextOf } from '@engine/assistant/trust'
import { draftContext, type Draft } from './data'

describe('procedencia del compositor y de Reintentar', () => {
  const text = '¿Qué es?\n\nPie: https://course.example/collect'
  const context = { blockID: 'figure', markedFigure: { studentText: '¿Qué es?', context: 'Pie: https://course.example/collect' } }
  const draft: Draft = { text, files: [], mentions: [] }

  it('el envío inicial y el reintento conservan los datos ajenos separados', () => {
    expect(draftContext(draft, context)).toBe(context)
    expect(draftContext({ ...draft, context }, { blockID: 'different' })).toBe(context)
    expect(studentTextOf({ text, context: draftContext({ ...draft, context }) })).toBe('¿Qué es?')
  })

  it('un reintento de un mensaje antiguo no convierte su texto mixto en texto propio', () => {
    const legacy = { blockID: 'figure' }
    const retry = { ...draft, context: legacy }
    const resolved = draftContext(retry, legacy)
    expect(studentTextOf({ text, context: resolved })).toBe('')
    expect(figureContentOf({ text, context: resolved })).toBe(text)
  })

  it('un nuevo texto tecleado conserva su procedencia aunque el tutor siga mostrando la figura', () => {
    const current = { blockID: 'figure' }
    const typed = { ...draft, text: 'Consulta https://student.example/page' }
    const resolved = draftContext(typed, current)
    expect(studentTextOf({ ...typed, context: resolved })).toBe(typed.text)
    expect(figureContentOf({ ...typed, context: resolved })).toBeUndefined()
    // Si falla el envío, la restauración usa la misma procedencia.
    expect(studentTextOf({ ...typed, context: draftContext(typed, current) })).toBe(typed.text)
  })
})

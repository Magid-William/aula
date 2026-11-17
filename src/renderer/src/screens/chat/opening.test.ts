import { describe, expect, it } from 'vitest'
import type { HomeSummary } from '@shared/ipc/home'
import { keepWhole, openingFor, topicOf } from './opening'

const now = new Date(2026, 10, 16, 14, 0)
const base: Pick<HomeSummary, 'exams' | 'plan' | 'courses'> = {
  courses: [{ id: 'c', title: 'Exam #2', subject: 'Math', icon: 'x', hue: 0, readiness: 0.7, coverage: 1, started: true, dueCards: 4, mistakes: 32, skillCount: 7, readyCount: 7, writtenCount: 7 }],
  exams: [{ courseId: 'c', title: 'Exam #2 — Trigonometry', courseTitle: 'Exam #2', icon: 'x', hue: 0, date: new Date(2026, 11, 6, 9).toISOString(), readiness: 0.74, readinessLow: 0.68, readinessHigh: 0.8, coverage: 1, started: true }],
  plan: [
    { id: '1', courseId: 'c', courseTitle: 'Exam #2', icon: 'x', hue: 0, kind: 'cards', title: 'Review 4 cards and 32 mistakes', detail: '', minutes: 20 },
    { id: '2', courseId: 'c', courseTitle: 'Exam #2', icon: 'x', hue: 0, kind: 'learn', title: 'Learn: Exact values of the six trig functions', detail: '', minutes: 12 }
  ]
}

describe('lo primero que dice Aula en el chat', () => {
  it('quita el tipo de paso del título del plan', () => {
    expect(topicOf('Learn: Exact values of the six trig functions')).toBe('Exact values of the six trig functions')
    expect(topicOf('Aprende: Valores exactos')).toBe('Valores exactos')
    expect(topicOf('Practice: Limits: the definition')).toBe('Limits: the definition')
    expect(topicOf('Sin prefijo')).toBe('Sin prefijo')
  })

  it('habla del examen más cercano y sugiere cosas de sus cursos', () => {
    const o = openingFor(base, now)!
    expect(o.exam).toEqual({ title: 'Exam #2 — Trigonometry', days: 20 })
    expect(o.suggestions).toEqual([
      { kind: 'topic', topic: 'Exact values of the six trig functions' },
      { kind: 'mistakes', count: 32 },
      { kind: 'exam', title: 'Exam #2 — Trigonometry' }
    ])
  })

  it('sin errores sugiere las tarjetas; un examen pasado no cuenta', () => {
    const o = openingFor({ ...base, courses: [{ ...base.courses[0], mistakes: 0 }], exams: [{ ...base.exams[0], date: new Date(2026, 10, 1).toISOString() }] }, now)!
    expect(o.exam).toBeUndefined()
    expect(o.suggestions.map((s) => s.kind)).toEqual(['topic', 'cards'])
  })

  it('sin cursos no hay nada que decir con datos', () => {
    expect(openingFor({ ...base, courses: [] }, now)).toBeNull()
  })

  it('el curso de ejemplo no cuenta: ni su examen ni sus errores son del estudiante', () => {
    const sample = (id: string) => id === 'c'
    expect(openingFor(base, now, sample)).toBeNull()
    const mine = { ...base.courses[0], id: 'm', title: 'Physics', mistakes: 2, dueCards: 0 }
    const o = openingFor({ ...base, courses: [...base.courses, mine] }, now, sample)!
    expect(o.exam).toBeUndefined()
    expect(o.mistakes).toBe(2)
    expect(o.dueCards).toBe(0)
    expect(o.suggestions).toEqual([{ kind: 'mistakes', count: 2 }])
  })
})

describe('keepWhole', () => {
  it('un nombre corto va entero; uno largo puede partirse', () => {
    expect(keepWhole('Exam #2 — Trigonometry')).toBe(true)
    expect(keepWhole('Final exam of Introduction to Organic Chemistry II')).toBe(false)
  })
})

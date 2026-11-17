// Resumen de la mañana sin IA: la primera línea lleva los datos (es la vista previa de la Bandeja) y nunca un cero.
import { afterEach, describe, expect, it } from 'vitest'
import { makeInstant } from '@engine/calendar/time'
import { setAILocale } from '@shared/ai/i18n'
import { previewLine } from '@shared/automations'
import type { HomePlanItem, HomeSummary } from '@shared/ipc/home'
import { morning, morningFacts, morningHeadline, type RoutineEvent } from './routines'

const TZ = 'Europe/Madrid'
const at = (y: number, m: number, d: number, h: number, min = 0) => makeInstant(y, m, d, h, min, 0, TZ)
const ev = (id: string, title: string, kind: string, start: number): RoutineEvent => ({ id, title, kind, start: new Date(start), allDay: false })
const step = (id: string, courseId: string, minutes: number, done = false): HomePlanItem => ({ id, courseId, courseTitle: 'Trigonometría', icon: 'math', hue: 0.1, kind: 'cards', title: 'repasar identidades', detail: '', minutes, done })

function study(plan: HomePlanItem[]): HomeSummary {
  return { name: '', today: { minutesDone: 0, minutesGoal: 30, itemsDone: 0, itemsTotal: plan.length }, streak: { days: 0, best: 0, week: [] }, plan, exams: [], courses: [], upcoming: [], dueCards: 0, mistakes: 0, aiReady: true }
}

afterEach(() => setAILocale('es'))

describe('resumen de la mañana', () => {
  const now = at(2026, 10, 12, 7, 45)
  const events = [ev('c', 'Trigonometría', 'lecture', at(2026, 10, 12, 10)), ev('e', 'Ensayo de inglés', 'assignment', at(2026, 10, 13, 23, 59))]
  const plan = study([step('a', 'trig', 15), step('b', 'trig', 10, true)])

  it('la primera línea dice las cifras del día y la vista previa no se queda en «Hoy:»', () => {
    const c = morning(events, plan, now, TZ)
    const first = c.text.split('\n')[0]
    expect(first).toBe('Hoy: 1 clase, 1 entrega pronto y 15 min de estudio.')
    expect(previewLine(c.text)).toBe(first)
    expect(c.text).toContain('**Clases de hoy:** Trigonometría')
    expect(c.noticeBody).toBe('1 clase, 1 entrega pronto y 15 min de estudio')
  })

  it('en inglés, igual', () => {
    setAILocale('en')
    const c = morning(events, plan, now, TZ)
    expect(previewLine(c.text)).toBe('Today: 1 class, 1 deadline soon, and 15 min of study.')
  })

  it('un día vacío es una sola línea, sin ceros', () => {
    const c = morning([], null, now, TZ)
    expect(c.text.startsWith('Hoy: sin clases, entregas ni exámenes apuntados.')).toBe(true)
    expect(c.text).not.toContain('\n')
    expect(previewLine(c.text)).toBe(c.text)
    expect(c.text).not.toMatch(/(^|\s)0 /)
  })

  it('los trozos no enseñan ceros', () => {
    expect(morningFacts({ classes: 0, due: 2, exams: 0, minutes: 0 })).toEqual(['2 entregas pronto'])
    expect(morningHeadline([])).toBe('Hoy: sin clases, entregas ni exámenes apuntados.')
  })
})

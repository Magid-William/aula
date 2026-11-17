import { describe, expect, it } from 'vitest'
import type { HomeExam, HomePlanItem } from '@shared/ipc/home'
import { mixesCourses, ownExams, planLeft } from './derive'

const now = new Date(2026, 10, 16, 12)
const exam = (courseId: string, date: Date): HomeExam => ({ courseId, title: courseId, courseTitle: courseId, icon: 'math', hue: 0.1, date: date.toISOString(), readiness: 0.7, readinessLow: 0.6, readinessHigh: 0.8, coverage: 0.5, started: true })
const step = (id: string, courseId: string, minutes: number, done = false): HomePlanItem => ({ id, courseId, courseTitle: courseId, icon: 'math', hue: 0.1, kind: 'cards', title: id, detail: '', minutes, done })

describe('Hoy', () => {
  it('el examen de ejemplo no cuenta y los pasados tampoco; el más cercano va primero', () => {
    const exams = [exam('mine-late', new Date(2026, 11, 6, 9)), exam('sample', new Date(2026, 10, 20, 9)), exam('past', new Date(2026, 10, 10, 9)), exam('mine-soon', new Date(2026, 10, 18, 9))]
    expect(ownExams(exams, (id) => id === 'sample', now).map((e) => e.courseId)).toEqual(['mine-soon', 'mine-late'])
  })

  it('el examen de hoy sigue contando aunque ya haya pasado la hora', () => {
    expect(ownExams([exam('today', new Date(2026, 10, 16, 9))], () => false, now)).toHaveLength(1)
  })

  it('el nombre del curso solo sale si el plan mezcla varios', () => {
    expect(mixesCourses([step('a', 'trig', 10), step('b', 'trig', 5)])).toBe(false)
    expect(mixesCourses([step('a', 'trig', 10), step('b', 'chem', 5)])).toBe(true)
    expect(mixesCourses([])).toBe(false)
  })

  it('lo que queda del plan no cuenta lo hecho y empieza por el primer paso pendiente', () => {
    expect(planLeft([step('a', 'trig', 10, true), step('b', 'chem', 12), step('c', 'trig', 8)])).toEqual({ steps: 2, minutes: 20, courseId: 'chem' })
    expect(planLeft([step('a', 'trig', 10, true)])).toEqual({ steps: 0, minutes: 0, courseId: undefined })
  })
})

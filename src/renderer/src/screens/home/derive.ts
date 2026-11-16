// Cuentas de Hoy a partir de `HomeSummary` (puras, con pruebas al lado).
import type { HomeExam, HomePlanItem } from '@shared/ipc/home'
import { civilDaysBetween } from '@renderer/lib/civil'

/** Los exámenes que cuentan en Hoy: los del estudiante (el del curso de ejemplo no es suyo), del más cercano al más lejano. */
export function ownExams(exams: readonly HomeExam[], isSample: (courseId: string) => boolean, now = new Date()): HomeExam[] {
  return exams.filter((e) => !isSample(e.courseId) && civilDaysBetween(now, new Date(e.date)) >= 0).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
}

/** ¿Mezcla el plan pasos de más de un curso? (entonces cada paso dice de cuál es) */
export function mixesCourses(plan: readonly HomePlanItem[]): boolean {
  return new Set(plan.map((p) => p.courseId)).size > 1
}

/** Lo que queda del plan de hoy: cuántos pasos, cuántos minutos y por qué curso empieza la sesión guiada. */
export function planLeft(plan: readonly HomePlanItem[]): { steps: number; minutes: number; courseId: string | undefined } {
  const pending = plan.filter((p) => !p.done)
  return { steps: pending.length, minutes: pending.reduce((a, p) => a + Math.max(0, p.minutes), 0), courseId: pending[0]?.courseId }
}

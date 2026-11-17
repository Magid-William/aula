// Lo que Aula dice primero en una conversación nueva, con los datos del estudiante (no frases de plantilla): el examen más
// cercano, lo pendiente de hoy y tres sugerencias sacadas de sus cursos (el tema que más sube la nota, sus errores, qué entra en
// el examen). Puro: recibe el resumen de Hoy y devuelve qué decir; los textos los pone la pantalla con i18n. Los cursos de
// ejemplo no cuentan: con solo esos, Aula pregunta qué estudiamos.
import type { HomeSummary } from '@shared/ipc/home'

export type OpeningSuggestion =
  | { kind: 'topic'; topic: string }
  | { kind: 'mistakes'; count: number }
  | { kind: 'cards'; count: number }
  | { kind: 'exam'; title: string }

export interface Opening {
  /** El examen más cercano que aún no ha pasado. */
  exam?: { title: string; days: number }
  mistakes: number
  dueCards: number
  suggestions: OpeningSuggestion[]
}

/** «Learn: Exact values…» / «Aprende: Valores exactos…» → «Exact values…» (el plan antepone el tipo de paso). */
export function topicOf(planTitle: string): string {
  return planTitle.replace(/^[^:]{1,20}:\s+/u, '').trim()
}

const DAY = 86_400_000

/** Un nombre corto («Exam #2 — Trigonometry») no se parte en el título: va entero a su línea. Uno largo sí puede partirse. */
export function keepWhole(name: string, max = 32): boolean {
  return name.length <= max
}

/** Días civiles hasta `date` (0 = hoy). */
function daysUntil(date: string, now: Date): number {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const d = new Date(date)
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((b - a) / DAY)
}

/** `isSample`: los cursos de ejemplo no cuentan (su examen no es del estudiante, ni sus errores: A4-P1-1). */
export function openingFor(
  s: Pick<HomeSummary, 'exams' | 'plan' | 'courses'>,
  now = new Date(),
  isSample: (courseId: string) => boolean = () => false
): Opening | null {
  const courses = s.courses.filter((c) => !isSample(c.id))
  if (!courses.length) return null
  const upcoming = s.exams
    .filter((e) => !isSample(e.courseId))
    .map((e) => ({ title: e.title, days: daysUntil(e.date, now) }))
    .filter((e) => e.days >= 0)
    .sort((a, b) => a.days - b.days)[0]
  // lo pendiente de hoy, de sus cursos (el resumen de Hoy suma lo mismo, con los de ejemplo)
  const mistakes = courses.reduce((n, c) => n + c.mistakes, 0)
  const dueCards = courses.reduce((n, c) => n + c.dueCards, 0)
  const suggestions: OpeningSuggestion[] = []
  // el tema que más sube la nota: el primero del plan que se aprende o se practica
  const step = s.plan.find((p) => !p.done && !isSample(p.courseId) && (p.kind === 'learn' || p.kind === 'practice'))
  const topic = step ? topicOf(step.title) : ''
  if (topic) suggestions.push({ kind: 'topic', topic })
  if (mistakes > 0) suggestions.push({ kind: 'mistakes', count: mistakes })
  else if (dueCards > 0) suggestions.push({ kind: 'cards', count: dueCards })
  if (upcoming) suggestions.push({ kind: 'exam', title: upcoming.title })
  return { exam: upcoming, mistakes, dueCards, suggestions: suggestions.slice(0, 3) }
}

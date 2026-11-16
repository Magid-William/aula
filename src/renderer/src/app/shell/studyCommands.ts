// Las acciones de estudio de ⌘K (el primer grupo, sin escribir nada): seguir con el plan de hoy, repasar, el simulacro,
// añadir materiales y preguntar a Aula. Sin React para poder probarlo: qué curso y adónde lleva cada una.
import type { Route } from '../router'

export interface StudyCandidate {
  id: string
  title: string
  examDate?: string | null
  skillCount: number
  readyCount?: number
  /** Curso de ejemplo: su examen no es del estudiante (A4-P1-1), así que no cuenta para elegir. */
  sample?: boolean
}

/** El curso de las acciones: el del examen más cercano que no haya pasado o, si no hay, el primero. Se prefieren los cursos
 *  con algún tema listo (uno que se está creando sin temas aún no tiene nada que repasar) y los que no son de ejemplo. */
export function studyCourse<C extends StudyCandidate>(courses: readonly C[], daysUntil: (date: string) => number): C | null {
  const ready = courses.filter((c) => (c.readyCount ?? c.skillCount) > 0)
  const pool = ready.length ? ready : courses
  let best: C | null = null
  let bestDays = Infinity
  for (const c of pool) {
    if (c.sample || !c.examDate) continue
    const days = daysUntil(c.examDate)
    if (days >= 0 && days < bestDays) {
      best = c
      bestDays = days
    }
  }
  return best ?? pool.find((c) => !c.sample) ?? pool[0] ?? null
}

export type StudyCommandId = 'continue' | 'review' | 'exam' | 'materials' | 'ask'

export interface StudyCommandSpec {
  id: StudyCommandId
  route: Route
}

/** Las cinco acciones, en su orden. Sin cursos solo queda preguntar a Aula. */
export function studyCommandSpecs(course: Pick<StudyCandidate, 'id'> | null): StudyCommandSpec[] {
  const ask: StudyCommandSpec = { id: 'ask', route: { name: 'chat' } }
  if (!course) return [ask]
  const id = course.id
  return [
    // la sesión guiada, ya dentro del primer paso
    { id: 'continue', route: { name: 'study', id, mode: 'plan', start: true } },
    { id: 'review', route: { name: 'course', id, tab: 'review' } },
    { id: 'exam', route: { name: 'study', id, mode: 'exam' } },
    { id: 'materials', route: { name: 'course', id, tab: 'materials' } },
    ask
  ]
}

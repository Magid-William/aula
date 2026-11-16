import { describe, expect, it } from 'vitest'
import { studyCommandSpecs, studyCourse, type StudyCandidate } from './studyCommands'

// días hasta cada fecha, fijos para la prueba
const DAYS: Record<string, number> = { past: -3, soon: 4, later: 20, far: 60 }
const until = (d: string) => DAYS[d]

const course = (id: string, extra: Partial<StudyCandidate> = {}): StudyCandidate => ({ id, title: id, skillCount: 5, ...extra })

describe('curso de las acciones de estudio', () => {
  it('elige el del examen más cercano, sin contar los que ya pasaron', () => {
    const list = [course('a', { examDate: 'later' }), course('b', { examDate: 'past' }), course('c', { examDate: 'soon' }), course('d')]
    expect(studyCourse(list, until)?.id).toBe('c')
  })
  it('sin exámenes, el primero', () => {
    expect(studyCourse([course('a'), course('b')], until)?.id).toBe('a')
  })
  it('el examen de un curso de ejemplo no cuenta, y se prefiere uno propio', () => {
    const list = [course('demo', { examDate: 'soon', sample: true }), course('mine', { examDate: 'far' })]
    expect(studyCourse(list, until)?.id).toBe('mine')
    expect(studyCourse([course('demo', { examDate: 'soon', sample: true }), course('mine')], until)?.id).toBe('mine')
    // si solo está el de ejemplo, ese
    expect(studyCourse([course('demo', { examDate: 'soon', sample: true })], until)?.id).toBe('demo')
  })
  it('un curso que aún no tiene temas listos no gana a uno que sí', () => {
    const list = [course('building', { examDate: 'soon', readyCount: 0 }), course('ready', { examDate: 'later', readyCount: 4 })]
    expect(studyCourse(list, until)?.id).toBe('ready')
    // si ninguno tiene temas, se usa igual
    expect(studyCourse([course('building', { readyCount: 0 })], until)?.id).toBe('building')
  })
  it('sin cursos, ninguno', () => {
    expect(studyCourse([], until)).toBeNull()
  })
})

describe('acciones de estudio', () => {
  it('con curso: el plan arranca solo, repasar, simulacro, materiales y preguntar', () => {
    const specs = studyCommandSpecs({ id: 'trig' })
    expect(specs.map((s) => s.id)).toEqual(['continue', 'review', 'exam', 'materials', 'ask'])
    expect(specs[0].route).toEqual({ name: 'study', id: 'trig', mode: 'plan', start: true })
    expect(specs[1].route).toEqual({ name: 'course', id: 'trig', tab: 'review' })
    expect(specs[2].route).toEqual({ name: 'study', id: 'trig', mode: 'exam' })
    expect(specs[3].route).toEqual({ name: 'course', id: 'trig', tab: 'materials' })
    expect(specs[4].route).toEqual({ name: 'chat' })
  })
  it('sin curso, solo preguntar a Aula', () => {
    expect(studyCommandSpecs(null).map((s) => s.id)).toEqual(['ask'])
  })
})

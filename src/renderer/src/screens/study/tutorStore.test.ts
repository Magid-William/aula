// A3-P1-1: el tutor no se reabre en otras pantallas ni repite su pregunta inicial.
import { beforeEach, describe, expect, it } from 'vitest'
import { navigate, routeKey, useNav, type Route } from '@renderer/app/router'
import { tutorLooking, tutorVisibleFor, useTutor } from './tutorStore'

const practice: Route = { name: 'study', id: 'c1', mode: 'practice', skill: 's1' }
const ctx = { courseID: 'c1', skillID: 's1', screen: 'practice' }

beforeEach(() => {
  useTutor.getState().close()
  useNav.setState({ stack: [practice], index: 0, route: practice, canBack: false, canForward: false })
})

describe('tutor (A3-P1-1)', () => {
  it('la procedencia de Marcar no sustituye las preguntas posteriores del compositor', () => {
    const context = { ...ctx, markedFigure: { studentText: '¿Qué es?', context: 'Una figura' } }
    useTutor.getState().show(context, '¿Qué es?\n\nUna figura')
    // El panel tiene esta instantánea para enviar la pregunta inicial.
    const initial = useTutor.getState().context
    expect(useTutor.getState().takePrompt()).toBe('¿Qué es?\n\nUna figura')
    expect(initial?.markedFigure).toEqual(context.markedFigure)
    expect(useTutor.getState().context?.markedFigure).toBeUndefined()
    expect(useTutor.getState().context?.courseID).toBe(ctx.courseID)
  })
  it('la pregunta inicial es de un solo uso', () => {
    useTutor.getState().show(ctx, 'Explain my mistake')
    expect(useTutor.getState().takePrompt()).toBe('Explain my mistake')
    // otro montaje del panel (otra capa, otra pantalla) ya no la encuentra
    expect(useTutor.getState().takePrompt()).toBeNull()
    expect(useTutor.getState().open).toBe(true)
  })

  it('solo lo enseña la pantalla que lo abrió', () => {
    useTutor.getState().show(ctx, 'Explain my mistake')
    const s = useTutor.getState()
    expect(tutorVisibleFor(s, routeKey(practice))).toBe(true)
    expect(tutorVisibleFor(s, routeKey({ name: 'study', id: 'c1', mode: 'cards' }))).toBe(false)
    expect(tutorVisibleFor(s, routeKey({ name: 'study', id: 'c1', mode: 'exam' }))).toBe(false)
  })

  it('ir a otra pantalla lo cierra y borra la pregunta pendiente', () => {
    useTutor.getState().show(ctx, 'Explain my mistake')
    navigate({ name: 'home' })
    expect(useTutor.getState().open).toBe(false)
    expect(useTutor.getState().prompt).toBeNull()
    // volver a estudiar no lo reabre
    navigate({ name: 'study', id: 'c1', mode: 'cards' })
    expect(useTutor.getState().open).toBe(false)
    navigate(practice)
    expect(tutorVisibleFor(useTutor.getState(), routeKey(practice))).toBe(false)
  })

  it('atrás también lo cierra', () => {
    navigate({ name: 'study', id: 'c1', mode: 'learn', skill: 's2' })
    useTutor.getState().show(ctx, 'Explain it another way')
    useNav.getState().back()
    expect(useTutor.getState().open).toBe(false)
  })

  it('una navegación a la misma pantalla no lo cierra', () => {
    useTutor.getState().show(ctx, 'Explain my mistake')
    navigate(practice)
    expect(useTutor.getState().open).toBe(true)
  })
})

describe('lo que se está mirando (el botón fijo del tutor)', () => {
  beforeEach(() => useTutor.setState({ published: null, publisher: null, publishedPosition: null, position: null }))

  it('la pantalla que se va no borra lo que ya publicó la siguiente', () => {
    const before = Symbol('antes')
    const after = Symbol('después')
    useTutor.getState().publish({ ...ctx, screen: 'learn' }, before)
    useTutor.getState().publish(ctx, after)
    useTutor.getState().unpublish(before)
    expect(useTutor.getState().published).toEqual(ctx)
    useTutor.getState().unpublish(after)
    expect(useTutor.getState().published).toBeNull()
  })

  it('abrir con lo publicado no lleva pregunta: sale el vacío con las preguntas rápidas', () => {
    useTutor.getState().publish(ctx, Symbol('modo'))
    const { published, show } = useTutor.getState()
    if (published) show(published)
    expect(useTutor.getState().open).toBe(true)
    expect(useTutor.getState().prompt).toBeNull()
    expect(tutorVisibleFor(useTutor.getState(), routeKey(practice))).toBe(true)
  })
})

describe('la línea «Mirando: …» del tutor', () => {
  const exercise = { courseID: 'c1', skillID: 's1', exerciseID: 'e3', screen: 'practice' }
  beforeEach(() => useTutor.setState({ open: false, context: null, prompt: null, owner: null, published: null, publisher: null, publishedPosition: null, position: null }))

  it('dice el ejercicio de la sesión, el paso de la lección o el tema; sin datos, nada', () => {
    expect(tutorLooking(exercise, { n: 1, m: 10 }, 'Reference angles')).toEqual({ kind: 'exercise', n: 1, m: 10 })
    expect(tutorLooking(exercise, null, 'Reference angles')).toEqual({ kind: 'topicExercise', skill: 'Reference angles' })
    expect(tutorLooking({ courseID: 'c1', skillID: 's1', screen: 'lesson', lessonBlock: 1 }, null, 'Reference angles')).toEqual({ kind: 'lesson', skill: 'Reference angles', step: 2 })
    expect(tutorLooking({ courseID: 'c1', skillID: 's1', screen: 'cards' }, null, ' Reference angles ')).toEqual({ kind: 'topic', skill: 'Reference angles' })
    expect(tutorLooking({ courseID: 'c1', screen: 'cards' }, null, undefined)).toBeNull()
    expect(tutorLooking(null, { n: 1, m: 10 }, 'Reference angles')).toBeNull()
    // una posición rota no se enseña
    expect(tutorLooking(exercise, { n: 0, m: 10 }, 'Reference angles')).toEqual({ kind: 'topicExercise', skill: 'Reference angles' })
  })

  it('«Explícame mi error» sabe en qué ejercicio va si es el publicado; si es otro, no se lo inventa', () => {
    useTutor.getState().publish(exercise, Symbol('modo'), { n: 3, m: 10 })
    useTutor.getState().show({ ...exercise, lastInput: '27' }, 'Explain my mistake')
    expect(useTutor.getState().position).toEqual({ n: 3, m: 10 })
    useTutor.getState().close()
    useTutor.getState().show({ ...exercise, exerciseID: 'otro' }, 'Explain my mistake')
    expect(useTutor.getState().position).toBeNull()
  })

  it('abierto, sigue al ejercicio siguiente; con la pregunta inicial aún sin enviar, no la pisa', () => {
    const marked = { ...exercise, markedFigure: { studentText: '¿Qué es?', context: 'Una figura' } }
    useTutor.getState().show(marked, '¿Qué es?')
    useTutor.getState().publish({ ...exercise, exerciseID: 'e4' }, Symbol('modo'), { n: 4, m: 10 })
    expect(useTutor.getState().context).toEqual(marked)
    expect(useTutor.getState().takePrompt()).toBe('¿Qué es?')
    useTutor.getState().publish({ ...exercise, exerciseID: 'e5' }, Symbol('modo'), { n: 5, m: 10 })
    expect(useTutor.getState().context?.exerciseID).toBe('e5')
    expect(useTutor.getState().position).toEqual({ n: 5, m: 10 })
    // otro curso no se mezcla
    useTutor.getState().publish({ ...exercise, courseID: 'c2', exerciseID: 'x' }, Symbol('modo'))
    expect(useTutor.getState().context?.courseID).toBe('c1')
  })

  it('cerrado, publicar no lo abre ni cambia su contexto', () => {
    useTutor.getState().publish(exercise, Symbol('modo'), { n: 2, m: 10 })
    expect(useTutor.getState().open).toBe(false)
    expect(useTutor.getState().context).toBeNull()
  })
})

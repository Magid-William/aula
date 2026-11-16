// Estado del tutor del curso (el panel de la derecha en los modos de estudio). Es global, pero pertenece a la pantalla que lo
// abrió: solo esa lo pinta, se cierra al ir a otra pantalla y su pregunta inicial se envía UNA vez (A3-P1-1: antes cada
// pantalla de estudio nueva lo reabría y repetía «Explícame mi error», con una llamada de IA de más cada vez).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { TutorContext } from '@shared/assistant/types'
import { routeKey, useNav, useScreenActive } from '@renderer/app/router'

/** Dónde está el ejercicio en su sesión (el «1 de 10» de la cápsula), si el modo lo dice. */
export interface TutorPosition {
  n: number
  m: number
}

interface TutorState {
  open: boolean
  context: TutorContext | null
  /** Dónde está lo que se mira en su sesión (para «Mirando: ejercicio 1 de 10»). */
  position: TutorPosition | null
  /** Pregunta que se envía nada más abrir (p. ej. «Explícamelo de otra forma»). De un solo uso: ver `takePrompt`. */
  prompt: string | null
  /** La pantalla (clave de ruta) que lo abrió: solo esa lo enseña. */
  owner: string | null
  /** Lo que se está mirando ahora en la pantalla de estudio de delante (lo publica cada modo): con esto abre el botón fijo
   *  del tutor, sin pregunta. */
  published: TutorContext | null
  /** Quién lo publicó: al irse, una pantalla solo lo borra si sigue siendo el suyo. */
  publisher: symbol | null
  publishedPosition: TutorPosition | null
  publish: (context: TutorContext, publisher: symbol, position?: TutorPosition) => void
  unpublish: (publisher: symbol) => void
  show: (context: TutorContext, prompt?: string, owner?: string, position?: TutorPosition) => void
  /** Devuelve la pregunta inicial y la borra: aunque el panel se monte otra vez, no se reenvía. */
  takePrompt: () => string | null
  close: () => void
}

export const useTutor = create<TutorState>((set, get) => ({
  open: false,
  context: null,
  position: null,
  prompt: null,
  owner: null,
  published: null,
  publisher: null,
  publishedPosition: null,
  publish: (context, publisher, position) => {
    const s = get()
    const next = { published: context, publisher, publishedPosition: position ?? null }
    // abierto en esta pantalla y sin pregunta pendiente, el tutor sigue a lo que se mira (el ejercicio siguiente, otro paso):
    // la línea «Mirando: …» y lo que se le pregunta después hablan de lo que está delante
    const follows = s.open && s.prompt === null && s.owner === routeKey(useNav.getState().route) && s.context?.courseID === context.courseID
    set(follows ? { ...next, context, position: position ?? null } : next)
  },
  unpublish: (publisher) => {
    if (get().publisher === publisher) set({ published: null, publisher: null, publishedPosition: null })
  },
  show: (context, prompt, owner, position) => {
    // «Explícame mi error» no sabe en qué ejercicio de la sesión va: si es el que está publicado, se sabe por él
    const { published, publishedPosition } = get()
    const known = context.exerciseID && published?.exerciseID === context.exerciseID ? publishedPosition : null
    set({ open: true, context, position: position ?? known, prompt: prompt ?? null, owner: owner ?? routeKey(useNav.getState().route) })
  },
  takePrompt: () => {
    const p = get().prompt
    if (p !== null) {
      // La procedencia corresponde solo a esta pregunta. Las siguientes se escriben en el compositor.
      const context = get().context
      if (context?.markedFigure) {
        const { markedFigure: _marked, ...rest } = context
        set({ prompt: null, context: rest })
      } else set({ prompt: null })
    }
    return p
  },
  close: () => set({ open: false, prompt: null, owner: null, position: null })
}))

/** Cada modo de estudio dice qué se está mirando (el ejercicio, el paso de la lección) y, si lo sabe, en qué ejercicio de la
 *  sesión va (`position`). Solo la pantalla de delante lo publica, y al irse lo borra si nadie lo ha cambiado. `null`: nada que
 *  preguntar (p. ej. el simulacro). */
export function usePublishTutorContext(context: TutorContext | null, position?: TutorPosition): void {
  const active = useScreenActive()
  // el contexto llega como objeto nuevo en cada pintado: solo cuenta si cambia lo que dice
  const key = context ? JSON.stringify([context, position ?? null]) : null
  useEffect(() => {
    if (!active || !context) return
    const publisher = Symbol('tutor')
    useTutor.getState().publish(context, publisher, position)
    return () => useTutor.getState().unpublish(publisher)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key])
}

/** La línea de debajo del título del tutor: qué está mirando («ejercicio 1 de 10», «Ángulos de referencia, paso 2»). */
export type TutorLooking =
  | { kind: 'exercise'; n: number; m: number }
  | { kind: 'lesson'; skill: string; step: number }
  | { kind: 'topicExercise'; skill: string }
  | { kind: 'topic'; skill: string }

/** Lo que dice esa línea con lo que se sabe (el contexto, la posición en la sesión y el título del tema). Sin datos, nada. */
export function tutorLooking(context: TutorContext | null, position: TutorPosition | null, skillTitle?: string): TutorLooking | null {
  if (!context) return null
  const skill = skillTitle?.trim()
  if (context.exerciseID && position && position.n >= 1 && position.m >= position.n) return { kind: 'exercise', n: position.n, m: position.m }
  if (!skill) return null
  if (context.exerciseID) return { kind: 'topicExercise', skill }
  if (context.lessonBlock !== undefined && context.lessonBlock >= 0) return { kind: 'lesson', skill, step: context.lessonBlock + 1 }
  return { kind: 'topic', skill }
}

/** ¿Lo pinta la pantalla con esta clave de ruta? */
export function tutorVisibleFor(state: Pick<TutorState, 'open' | 'owner'>, key: string): boolean {
  return state.open && state.owner === key
}

// ir a otra pantalla (⌘1–7, ⌘K, atrás, un enlace de la respuesta…) cierra el tutor: su contexto era el de esa pantalla
useNav.subscribe((nav) => {
  const { open, owner, close } = useTutor.getState()
  if (open && owner !== routeKey(nav.route)) close()
})

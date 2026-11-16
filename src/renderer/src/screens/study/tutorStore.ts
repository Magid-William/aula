// Estado del tutor del curso (el panel de la derecha en los modos de estudio). Es global, pero pertenece a la pantalla que lo
// abrió: solo esa lo pinta, se cierra al ir a otra pantalla y su pregunta inicial se envía UNA vez (A3-P1-1: antes cada
// pantalla de estudio nueva lo reabría y repetía «Explícame mi error», con una llamada de IA de más cada vez).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { TutorContext } from '@shared/assistant/types'
import { routeKey, useNav, useScreenActive } from '@renderer/app/router'

interface TutorState {
  open: boolean
  context: TutorContext | null
  /** Pregunta que se envía nada más abrir (p. ej. «Explícamelo de otra forma»). De un solo uso: ver `takePrompt`. */
  prompt: string | null
  /** La pantalla (clave de ruta) que lo abrió: solo esa lo enseña. */
  owner: string | null
  /** Lo que se está mirando ahora en la pantalla de estudio de delante (lo publica cada modo): con esto abre el botón fijo
   *  del tutor, sin pregunta. */
  published: TutorContext | null
  /** Quién lo publicó: al irse, una pantalla solo lo borra si sigue siendo el suyo. */
  publisher: symbol | null
  publish: (context: TutorContext, publisher: symbol) => void
  unpublish: (publisher: symbol) => void
  show: (context: TutorContext, prompt?: string, owner?: string) => void
  /** Devuelve la pregunta inicial y la borra: aunque el panel se monte otra vez, no se reenvía. */
  takePrompt: () => string | null
  close: () => void
}

export const useTutor = create<TutorState>((set, get) => ({
  open: false,
  context: null,
  prompt: null,
  owner: null,
  published: null,
  publisher: null,
  publish: (context, publisher) => set({ published: context, publisher }),
  unpublish: (publisher) => {
    if (get().publisher === publisher) set({ published: null, publisher: null })
  },
  show: (context, prompt, owner) => set({ open: true, context, prompt: prompt ?? null, owner: owner ?? routeKey(useNav.getState().route) }),
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
  close: () => set({ open: false, prompt: null, owner: null })
}))

/** Cada modo de estudio dice qué se está mirando (el ejercicio, el paso de la lección). Solo la pantalla de delante lo publica,
 *  y al irse lo borra si nadie lo ha cambiado. `null`: nada que preguntar (p. ej. el simulacro). */
export function usePublishTutorContext(context: TutorContext | null): void {
  const active = useScreenActive()
  // el contexto llega como objeto nuevo en cada pintado: solo cuenta si cambia lo que dice
  const key = context ? JSON.stringify(context) : null
  useEffect(() => {
    if (!active || !context) return
    const publisher = Symbol('tutor')
    useTutor.getState().publish(context, publisher)
    return () => useTutor.getState().unpublish(publisher)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key])
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

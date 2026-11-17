// Título de la barra superior (cada pantalla pone el suyo) y acciones extra a la derecha.
import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { useScreenActive } from './router'

interface TitleState {
  title: ReactNode
  right: ReactNode
  /** El título ya sale en la pantalla (su h1): en escritorio la barra no lo repite; en el teléfono, sí. */
  compactOnly: boolean
  /** Quién lo puso: al irse una pantalla solo borra el título si sigue siendo el suyo. */
  owner: symbol | null
}
export const useTitleStore = create<TitleState>(() => ({ title: null, right: null, compactOnly: false, owner: null }))

export interface ScreenTitleOptions {
  /** La pantalla ya enseña su título (el curso, el monitor de creación): la barra solo lo pone en el teléfono. */
  compactOnly?: boolean
}

/** El título de la pantalla de delante. Las pantallas que se desvanecen ya no lo tocan, y al desmontarse no borran el de la
 * siguiente (las dos conviven unos milisegundos durante la transición). */
export function useScreenTitle(title: ReactNode, right: ReactNode = null, deps: unknown[] = [], opts: ScreenTitleOptions = {}): void {
  const active = useScreenActive()
  const compactOnly = opts.compactOnly ?? false
  useEffect(() => {
    if (!active) return
    const owner = Symbol('title')
    useTitleStore.setState({ title, right, compactOnly, owner })
    return () => {
      if (useTitleStore.getState().owner === owner) useTitleStore.setState({ title: null, right: null, compactOnly: false, owner: null })
    }
    // si el título es texto, también se actualiza cuando cambia (p. ej. al cambiar el idioma)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, active, compactOnly, typeof title === 'string' ? title : null])
}

/** ¿Se ve aún el elemento (el h1 de la pantalla)? Cuando sale por arriba al desplazarse, la pantalla le pasa su título a la barra
 *  de arriba: una página larga no se queda sin contexto. Sin elemento (aún cargando), se da por visto. */
export function useInView(node: Element | null): boolean {
  const [seen, setSeen] = useState(true)
  useEffect(() => {
    if (!node || typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0 })
    io.observe(node)
    return () => io.disconnect()
  }, [node])
  return seen
}

// Llevar la vista hasta una sección del curso: los ids de antes («cards», «mistakes», «practice», «reference») abren su vista
// nueva (Repasar o Aprender) y bajan hasta la parte que eran. La sección puede tardar en pintarse (sus datos se leen
// aparte): se busca unas cuantas veces y, al encontrarla, se desplaza una vez.
import { useEffect } from 'react'
import { useScreenActive } from '@renderer/app/router'
import { useTheme } from '@renderer/design'

/** Fila de una lista dentro de una tarjeta: el filete arriba (salvo en la primera), alineado con el texto y no con el borde de la
 *  zona que se ilumina al pasar el ratón. */
export const RULED_ROW = 'relative before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-rule first:before:hidden'

/** El atributo que marca cada sección a la que puede llevar un id viejo. */
export const SECTION_ATTR = 'data-course-section'

export function useScrollToSection(focus: string | undefined, key: string): void {
  const { reducedMotion } = useTheme()
  const active = useScreenActive()
  useEffect(() => {
    if (!focus || !active) return
    let tries = 0
    let timer = 0
    // la pantalla de delante (durante la transición conviven dos)
    const find = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(`[data-screen="course"][data-active="true"] [${SECTION_ATTR}="${focus}"]`) ?? document.querySelector<HTMLElement>(`[${SECTION_ATTR}="${focus}"]`)
    const tick = (): void => {
      const el = find()
      if (el) return el.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' })
      if (++tries < 40) timer = window.setTimeout(tick, 100)
    }
    timer = window.setTimeout(tick, 80)
    return () => window.clearTimeout(timer)
  }, [focus, key, active, reducedMotion])
}

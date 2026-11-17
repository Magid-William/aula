// Desplazamiento de la conversación que no pelea con quien lee: mientras estás abajo, sigue a lo que llega (sin animación por
// fotograma, que da tirones); en cuanto subes (rueda, arrastre, teclado), te deja tranquilo y aparece «Ir al final».
// Al enviar un mensaje vuelve abajo y la respuesta crece debajo de tu pregunta: si no cabe, la vista se queda con el principio
// de la pregunta arriba (no la corta por la mitad) y «Ir al final» lleva al resto.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** ¿Está la vista pegada al final? (con un margen para el redondeo y los últimos píxeles). */
export function isNearBottom(scrollTop: number, clientHeight: number, scrollHeight: number, margin = 48): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= margin
}

/** Hasta dónde se puede bajar sin que el principio de la pregunta (`anchorTop`, en pantalla) salga por arriba del desplazador
 *  (`scrollerTop`), con `gap` px de aire. */
export function anchorCap(anchorTop: number, scrollerTop: number, scrollTop: number, gap = 16): number {
  return Math.max(0, anchorTop - scrollerTop + scrollTop - gap)
}

export interface StickToBottom {
  /** Sigue al final (false si quien lee subió). */
  stuck: boolean
  /** La respuesta ya no cabe: la vista se quedó con el principio de la pregunta arriba (hay más debajo). */
  held: boolean
  /** Vuelve al final (suave) y lo sigue otra vez. `hold`: al enviar, sin perder de vista el principio de la pregunta. */
  toBottom: (smooth?: boolean, hold?: boolean) => void
}

/** La última pregunta del estudiante en la conversación. */
const lastQuestion = (inner: HTMLElement): HTMLElement | null => {
  const all = inner.querySelectorAll<HTMLElement>('[data-role="user"]')
  return all.length ? all[all.length - 1] : null
}

export function useStickToBottom(scroller: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, resetKey?: unknown): StickToBottom {
  const stuckRef = useRef(true)
  /** Hasta cuándo los desplazamientos son nuestros (ir al final suave): no sueltan. */
  const ours = useRef(0)
  const [stuck, setStuck] = useState(true)
  const set = useCallback((v: boolean) => {
    if (stuckRef.current === v) return
    stuckRef.current = v
    setStuck(v)
  }, [])
  /** Seguir sin pasar del principio de la última pregunta (desde que se envía hasta ir al final). */
  const holding = useRef(false)
  const heldRef = useRef(false)
  const [held, setHeldState] = useState(false)
  const setHeld = useCallback((v: boolean) => {
    if (heldRef.current === v) return
    heldRef.current = v
    setHeldState(v)
  }, [])
  const release = useCallback(() => {
    holding.current = false
    setHeld(false)
  }, [setHeld])

  const toBottom = useCallback((smooth = true, hold = false) => {
    const el = scroller.current
    set(true)
    if (hold) holding.current = true
    else release()
    ours.current = performance.now() + 900
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [scroller, set, release])

  // otra conversación: al final, sin animación
  useLayoutEffect(() => {
    const el = scroller.current
    stuckRef.current = true
    setStuck(true)
    release()
    if (el) el.scrollTop = el.scrollHeight
  }, [resetKey, scroller, release])

  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    // la intención de subir se ve antes que el desplazamiento: se suelta en el acto (aunque el texto siga llegando)
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        ours.current = 0
        set(false)
      }
    }
    let touchY = 0
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (e: TouchEvent) => {
      if ((e.touches[0]?.clientY ?? 0) > touchY) set(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) set(false)
    }
    // al volver abajo a mano (o con la barra), se pega otra vez (y ya sigue hasta el final)
    const onScroll = () => {
      const mine = performance.now() <= ours.current
      if (isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight)) {
        if (!mine) release()
        set(true)
      } else if (!mine) set(false)
    }
    const follow = () => {
      if (!stuckRef.current) return
      ours.current = Math.max(ours.current, performance.now() + 80)
      const bottom = el.scrollHeight - el.clientHeight
      const q = holding.current ? lastQuestion(inner) : null
      const cap = q ? anchorCap(q.getBoundingClientRect().top, el.getBoundingClientRect().top, el.scrollTop) : Number.POSITIVE_INFINITY
      setHeld(cap < bottom - 1)
      el.scrollTop = Math.min(bottom, cap)
    }
    const ro = new ResizeObserver(follow)
    ro.observe(inner)
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('keydown', onKey)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('keydown', onKey)
      el.removeEventListener('scroll', onScroll)
    }
  }, [scroller, content, set, setHeld, release])

  return { stuck, held, toBottom }
}

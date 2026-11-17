// Cerrar una hoja o un panel arrastrándolo con el dedo, como en una app: una hoja hacia abajo, un panel hacia su lado. Solo
// con el dedo (en el escritorio no cambia nada). El gesto es de la hoja solo si lo de dentro ya no puede desplazarse hacia
// ahí: una lista a medio leer se desplaza; arriba del todo (o desde la cabecera), la hoja baja y, al soltarla, se cierra si
// llegó lejos o iba rápida; si no, vuelve a su sitio.
import { useEffect, useRef, type RefObject } from 'react'
import { animate, useMotionValue, type MotionValue } from 'motion/react'
import { spring } from './tokens'
import { useTouchOnly } from './input'

export type SwipeAxis = 'x' | 'y'
/** Hacia dónde se cierra: 1 abajo o a la derecha, −1 a la izquierda. */
export type SwipeSign = 1 | -1

/** Lo lejos (px) o lo rápido (px/s) que hay que soltarla para que se cierre. */
export const CLOSE_DISTANCE = 120
export const CLOSE_VELOCITY = 600

/** ¿Se cierra al soltarla? Lejos, o rápida y no un roce. */
export function shouldClose(distance: number, velocity: number): boolean {
  return distance > CLOSE_DISTANCE || (distance > 24 && velocity > CLOSE_VELOCITY)
}

/** Lo desplazado de una zona en un eje: dónde va, cuánto mide su contenido y cuánto se ve. */
export interface ScrollMetrics {
  scroll: number
  size: number
  view: number
}

/** ¿Puede la zona desplazarse con el dedo que va hacia `sign`? (el dedo hacia abajo lleva el contenido hacia el principio) */
export function canScrollWith(m: ScrollMetrics, sign: SwipeSign): boolean {
  if (m.size - m.view <= 1) return false
  return sign > 0 ? m.scroll > 1 : m.scroll < m.size - m.view - 1
}

/** Lo que no se arrastra: campos, deslizadores, lienzos (dibujar, la gráfica) y lo marcado a mano. */
const SKIP = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], canvas, [data-no-swipe]'

/** Un toque largo antes de moverse es seleccionar texto, no arrastrar la hoja. */
const LONG_PRESS_MS = 450

/** ¿Alguna zona entre el dedo y la hoja (ella incluida) se desplazaría con este gesto? */
function scrollsWith(target: Element, root: HTMLElement, axis: SwipeAxis, sign: SwipeSign): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el instanceof HTMLElement) {
      const style = getComputedStyle(el)
      const overflow = axis === 'y' ? style.overflowY : style.overflowX
      if (overflow === 'auto' || overflow === 'scroll') {
        const m = axis === 'y' ? { scroll: el.scrollTop, size: el.scrollHeight, view: el.clientHeight } : { scroll: el.scrollLeft, size: el.scrollWidth, view: el.clientWidth }
        if (canScrollWith(m, sign)) return true
      }
    }
    if (el === root) break
  }
  return false
}

interface Gesture {
  x: number
  y: number
  at: number
  target: Element
  state: 'maybe' | 'drag' | 'off'
  from: number
  last: number
  lastAt: number
  velocity: number
}

/**
 * Arrastrar para cerrar la hoja de `ref` (con el dedo). Devuelve el desplazamiento (para su `style`, en `axis`) y si se cerró
 * arrastrándola (para que salga desde donde quedó, siguiendo el gesto).
 */
export function useSwipeClose(
  ref: RefObject<HTMLElement | null>,
  { open, axis, sign, onClose }: { open: boolean; axis: SwipeAxis; sign: SwipeSign; onClose: () => void }
): { offset: MotionValue<number>; swiped: RefObject<boolean> } {
  const offset = useMotionValue(0)
  const touch = useTouchOnly()
  const swiped = useRef(false)
  const close = useRef(onClose)
  close.current = onClose
  const isOpen = useRef(open)
  isOpen.current = open
  useEffect(() => {
    const root = ref.current
    if (!open || !touch || !root) return
    swiped.current = false
    let g: Gesture | null = null
    const start = (e: TouchEvent): void => {
      g = null
      const target = e.target instanceof Element ? e.target : null
      if (e.touches.length !== 1 || !target || target.closest(SKIP)) return
      const t = e.touches[0]
      g = { x: t.clientX, y: t.clientY, at: e.timeStamp, target, state: 'maybe', from: 0, last: 0, lastAt: e.timeStamp, velocity: 0 }
    }
    const move = (e: TouchEvent): void => {
      const t = e.touches[0]
      if (!g || g.state === 'off' || !t) return
      const dx = t.clientX - g.x
      const dy = t.clientY - g.y
      const along = (axis === 'y' ? dy : dx) * sign
      const across = Math.abs(axis === 'y' ? dx : dy)
      if (g.state === 'maybe') {
        if (Math.abs(along) < 6 && across < 6) return
        // hacia dentro, de lado, tras un toque largo o con algo que aún se desplaza: el gesto no es de la hoja
        if (along <= 0 || across > along || e.timeStamp - g.at > LONG_PRESS_MS || !e.cancelable || scrollsWith(g.target, root, axis, sign)) {
          g.state = 'off'
          return
        }
        g.state = 'drag'
        g.from = along
      }
      e.preventDefault()
      const d = Math.max(0, along - g.from)
      const dt = e.timeStamp - g.lastAt
      if (dt > 0) g.velocity = ((d - g.last) / dt) * 1000
      g.last = d
      g.lastAt = e.timeStamp
      offset.set(d * sign)
    }
    const end = (): void => {
      const done = g?.state === 'drag' ? g : null
      g = null
      if (!done) return
      if (!shouldClose(done.last, done.velocity)) return void animate(offset, 0, spring.snappy)
      swiped.current = true
      close.current()
      // quien la abrió puede no dejarla cerrar ahora (un diálogo encima): vuelve a su sitio
      setTimeout(() => {
        if (!isOpen.current) return
        swiped.current = false
        void animate(offset, 0, spring.snappy)
      }, 80)
    }
    root.addEventListener('touchstart', start, { passive: true })
    root.addEventListener('touchmove', move, { passive: false })
    root.addEventListener('touchend', end)
    root.addEventListener('touchcancel', end)
    return () => {
      root.removeEventListener('touchstart', start)
      root.removeEventListener('touchmove', move)
      root.removeEventListener('touchend', end)
      root.removeEventListener('touchcancel', end)
    }
  }, [open, touch, axis, sign, ref, offset])
  return { offset, swiped }
}

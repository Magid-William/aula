// Pasar de mes (o de días) deslizando el dedo por la rejilla, como en el calendario del teléfono. Solo con el dedo (el
// ratón arrastra para seleccionar) y solo si el gesto es claramente horizontal: el desplazamiento vertical sigue igual.
import { useRef, type PointerEvent } from 'react'
import { swipeStep } from './util'

export function useSwipe(onStep: (n: number) => void): {
  onPointerDown: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  onPointerCancel: () => void
} {
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'touch' && e.isPrimary) start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    },
    onPointerUp: (e) => {
      const s = start.current
      start.current = null
      if (!s || s.id !== e.pointerId) return
      const n = swipeStep(e.clientX - s.x, e.clientY - s.y)
      if (n) onStep(n)
    },
    onPointerCancel: () => {
      start.current = null
    }
  }
}

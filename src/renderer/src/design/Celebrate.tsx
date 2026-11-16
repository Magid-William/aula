// Un acierto, celebrado a tinta: unas rayitas (`InkBurst`) alrededor de su marca, que se dibujan y se van. Es la celebración
// de todos los días (acertar una pregunta, completar un mapa); las gotas de `pixelBurst` quedan para los logros de verdad.
import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { BURST_ARC_LEFT, InkBurst } from './paint'
import { useTheme } from './theme'
import { cx } from './cx'

/** Cuánto se queda el dibujo antes de irse (ms): lo que tarda la mano en trazarlo y un momento para verlo. */
const STAY_MS = 1700

/**
 * Envuelve la marca de un acierto (`PixelCheck`, un icono). `at` dice cuándo se acertó (p. ej. `Date.now()` al acertar) y
 * cambia con cada acierto: ese momento, y solo ese, se celebra. Al volver a la pantalla con lo acertado guardado no hay
 * fiesta (`at` es null), y con «Reducir movimiento» tampoco.
 */
export function Celebrate({ at, children, size = 56, className }: { at: number | null; children: ReactNode; size?: number; className?: string }) {
  const { reducedMotion } = useTheme()
  const [live, setLive] = useState<number | null>(null)
  useEffect(() => {
    if (at === null || reducedMotion) return
    setLive(at)
    const id = setTimeout(() => setLive(null), STAY_MS)
    return () => clearTimeout(id)
  }, [at, reducedMotion])
  return (
    <span className={cx('relative inline-grid place-items-center', className)}>
      {children}
      <AnimatePresence>
        {live !== null && (
          <motion.span key={live} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.45 } }}>
            {/* por arriba y a la izquierda: a la derecha de la marca va su texto */}
            <InkBurst seed={`acierto:${live}`} size={size} delay={80} count={5} arc={BURST_ARC_LEFT} className="-translate-x-1/2 -translate-y-1/2" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

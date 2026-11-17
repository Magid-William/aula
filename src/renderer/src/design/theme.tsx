// Tema (claro/oscuro), movimiento reducido y tamaño de texto. Sigue a los ajustes y al sistema.
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type MotionMode = 'system' | 'full' | 'reduced'

interface ThemeState {
  dark: boolean
  reducedMotion: boolean
  mode: ThemeMode
}

const ThemeContext = createContext<ThemeState>({ dark: false, reducedMotion: false, mode: 'system' })

/** Tamaño de la raíz en px para el ajuste «Tamaño del texto» (15 px al 100 %). Sin redondear: la escala `t-*` va en rem y
 *  tiene que crecer en la misma proporción que el ajuste. `osScale`: el tamaño de letra del sistema del teléfono o la tableta. */
export function rootFontSize(textScale: number, osScale = 1): number {
  const k = Number.isFinite(textScale) ? Math.min(1.4, Math.max(0.85, textScale)) : 1
  const os = Number.isFinite(osScale) ? Math.min(1.6, Math.max(0.85, osScale)) : 1
  return Math.round(15 * k * os * 100) / 100
}

// El tamaño de letra del sistema: las apps de Android y de iPhone/iPad lo pasan con `window.__aulaFontScale(1.3)` (o lo dejan
// en `window.__aulaPendingFontScale` si la página aún no había cargado): sus vistas web no lo aplican al texto de la página.
type FontScaleHost = { __aulaFontScale?: (scale: number) => void; __aulaPendingFontScale?: number }
let osFontScale = 1
const osFontListeners = new Set<() => void>()
function setOsFontScale(scale: number): void {
  const next = Number.isFinite(scale) && scale > 0 ? scale : 1
  if (next === osFontScale) return
  osFontScale = next
  for (const fn of osFontListeners) fn()
}
if (typeof window !== 'undefined') {
  const host = window as unknown as FontScaleHost
  host.__aulaFontScale = setOsFontScale
  if (typeof host.__aulaPendingFontScale === 'number') setOsFontScale(host.__aulaPendingFontScale)
}
function useOsFontScale(): number {
  return useSyncExternalStore(
    (fn) => {
      osFontListeners.add(fn)
      return () => osFontListeners.delete(fn)
    },
    () => osFontScale,
    () => 1
  )
}

/** ¿Se cumple la consulta de medios? (al día si cambia). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const fn = () => setMatch(mq.matches)
    fn()
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [query])
  return match
}

export function ThemeProvider({ mode, motion, textScale = 1, children }: { mode: ThemeMode; motion: MotionMode; textScale?: number; children: ReactNode }) {
  const systemDark = useMedia('(prefers-color-scheme: dark)')
  const systemReduced = useMedia('(prefers-reduced-motion: reduce)')
  const dark = mode === 'dark' || (mode === 'system' && systemDark)
  const reducedMotion = motion === 'reduced' || (motion === 'system' && systemReduced)
  const osScale = useOsFontScale()

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', dark)
    root.classList.toggle('reduce-motion', reducedMotion)
    root.style.fontSize = `${rootFontSize(textScale, osScale)}px`
    document.body.style.fontSize = 'inherit'
  }, [dark, reducedMotion, textScale, osScale])

  const value = useMemo(() => ({ dark, reducedMotion, mode }), [dark, reducedMotion, mode])
  return (
    <ThemeContext.Provider value={value}>
      {/* con movimiento reducido no basta con quitar los desplazamientos: también las entradas (opacidad y retrasos escalonados,
          el mapa de calor celda a celda) van al instante; si no, la pantalla nueva salía vacía y aparecía a trompicones (A4-P2-15) */}
      <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'} skipAnimations={reducedMotion}>{children}</MotionConfig>
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext)
}

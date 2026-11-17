// Los dibujos pequeños de Aula, a mano (antes pixel art): los glifos de `Sprite` (filas de texto con colores de la
// interfaz: el papel, la calculadora…), la marca de acierto que se dibuja de un trazo y la cortina de pintura que se retira
// al entrar en un curso.
// Todo con la misma mano que los personajes (pixel/brush): se pinta una vez, en un hilo aparte, y se guarda.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from './theme'
import type { CompiledAnim, Px } from './pixel/anim'
import { PRIORITY, peekFrame, requestFrame, type FrameImage } from './pixel/brush/frames'
import { cssColor } from './pixel/brush/css'
import { Ink } from './paint/Ink'
import { checkInk } from './paint/drawings'

type Legend = Record<string, string>
const dprNow = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)

// ——— los glifos de `Sprite` ———
const SPRITE_MARGIN = 1
const spriteAnims = new Map<string, CompiledAnim>()

/** El glifo como personaje quieto: tablero cuadrado con margen; la línea son los colores que tocan el papel. */
function spriteAnim(rows: string[], colors: Record<string, string>): CompiledAnim {
  const key = rows.join('/') + '|' + Object.entries(colors).map(([k, v]) => k + v).join(',')
  let a = spriteAnims.get(key)
  if (a) return a
  const w = Math.max(...rows.map((r) => r.length))
  const size = Math.max(w, rows.length)
  const stride = size + SPRITE_MARGIN * 2
  const px: Px[] = new Array(stride * stride).fill(null)
  rows.forEach((r, y) => Array.from(r).forEach((ch, x) => {
    const c = colors[ch]
    if (c) px[(y + SPRITE_MARGIN) * stride + x + SPRITE_MARGIN] = c
  }))
  // línea: los colores que van por el borde (la mitad de sus píxeles tocan el papel)
  const touch = new Map<string, [number, number]>()
  for (let y = 0; y < stride; y++)
    for (let x = 0; x < stride; x++) {
      const c = px[y * stride + x]
      if (!c) continue
      const t = touch.get(c) ?? [0, 0]
      t[1]++
      const empty = (dx: number, dy: number) => {
        const nx = x + dx
        const ny = y + dy
        return nx < 0 || ny < 0 || nx >= stride || ny >= stride || !px[ny * stride + nx]
      }
      if (empty(1, 0) || empty(-1, 0) || empty(0, 1) || empty(0, -1)) t[0]++
      touch.set(c, t)
    }
  const line = [...touch].filter(([, [e, n]]) => e >= n * 0.5).map(([c]) => c)
  a = { size, margin: SPRITE_MARGIN, stride, base: px, clips: {}, look: { id: `sprite:${spriteAnims.size}`, plain: true, strokes: 'any', line } }
  spriteAnims.set(key, a)
  if (spriteAnims.size > 300) spriteAnims.delete(spriteAnims.keys().next().value as string)
  return a
}

/** Pone en un lienzo una imagen ya pintada (o la pide y la pone al llegar). */
function useBlit(ref: React.RefObject<HTMLCanvasElement | null>, get: (W: number) => FrameImage | undefined, ask: (W: number, done: (img: FrameImage) => void) => void, W: number, key: string): void {
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    if (canvas.width !== W) {
      canvas.width = W
      canvas.height = W
    }
    let alive = true
    const put = (img: FrameImage) => {
      if (!alive) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, W, W)
      ctx.drawImage(img, 0, 0)
    }
    const hit = get(W)
    if (hit) put(hit)
    else ask(W, put)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` resume lo que se dibuja
  }, [key, W])
}

/** Dibuja un glifo (filas de texto, «.» = transparente) con su leyenda de colores CSS, a mano. */
export const Sprite = memo(function Sprite({ rows, legend, size, className }: { rows: string[]; legend: Legend; size: number; className?: string }) {
  const { dark } = useTheme()
  const w = Math.max(...rows.map((r) => r.length))
  const h = rows.length
  const scale = size / Math.max(w, h)
  const legendKey = Object.entries(legend).map(([k, v]) => k + v).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- la clave resume la leyenda; `dark` cambia las variables CSS
  const colors = useMemo(() => Object.fromEntries(Object.entries(legend).map(([k, v]) => [k, cssColor(v)])), [legendKey, dark])
  const anim = spriteAnim(rows, colors)
  const ref = useRef<HTMLCanvasElement>(null)
  const css = anim.stride * scale
  const W = Math.max(1, Math.round(css * dprNow()))
  useBlit(
    ref,
    (W) => peekFrame(anim, anim.base, W, dark, 0),
    (W, done) => requestFrame(anim, anim.base, W, dark, 0, dprNow(), PRIORITY.visible, done),
    W,
    `${anim.look!.id}|${dark}`
  )
  return (
    <span aria-hidden className={className} style={{ position: 'relative', display: 'inline-block', width: w * scale, height: h * scale, flexShrink: 0, verticalAlign: 'middle' }}>
      <canvas ref={ref} style={{ position: 'absolute', left: -SPRITE_MARGIN * scale, top: -SPRITE_MARGIN * scale, width: css, height: css, pointerEvents: 'none' }} />
    </span>
  )
})

/** Marca de acierto dibujada a pluma, de un trazo (con la misma mano que la interfaz). */
export function PixelCheck({ size = 20, color = 'var(--success)', delay = 0 }: { size?: number; color?: string; delay?: number }) {
  const drawing = useMemo(() => checkInk(size, 'acierto'), [size])
  return <Ink drawing={drawing} color={color} delay={delay * 1000} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }} />
}

/**
 * Cortina de pintura: cubre su contenedor con una mano del color dado que se retira desde arriba a la izquierda con el
 * borde mojado y desigual de un pincel (al entrar en un curso). Se quita sola al terminar.
 */
export function PixelCurtain({ color, cell = 22, duration = 520, onDone }: { color: string; cell?: number; duration?: number; onDone?: () => void }) {
  const { reducedMotion } = useTheme()
  const ref = useRef<HTMLCanvasElement>(null)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (reducedMotion) {
      setDone(true)
      onDone?.()
      return
    }
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const parent = canvas.parentElement!
    const W = parent.clientWidth
    const H = parent.clientHeight
    // un lienzo pequeño (una celda cada ~cell/4 px) que el navegador suaviza al ampliarlo: el borde sale blando, de pincel
    const step = Math.max(3, Math.round(cell / 4))
    const cw = Math.max(2, Math.ceil(W / step))
    const ch = Math.max(2, Math.ceil(H / step))
    canvas.width = cw
    canvas.height = ch
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    const fill = cssColor(getComputedStyle(parent).getPropertyValue('--curtain').trim() || color)
    const n = parseInt(fill.slice(1, 7), 16)
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255]
    // orden de retirada: en diagonal, con el borde desigual (ruido grueso y fino)
    const thr = new Float32Array(cw * ch)
    const hash = (x: number, y: number) => {
      let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995
      h = Math.imul(h ^ (h >>> 13), 1274126177)
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295
    }
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) thr[y * cw + x] = (x / cw) * 0.42 + (y / ch) * 0.42 + hash(Math.floor(x / 5), Math.floor(y / 5)) * 0.12 + hash(x, y) * 0.06
    const img = ctx.createImageData(cw, ch)
    const start = performance.now()
    let raf = 0
    const draw = (now: number) => {
      const p = ((now - start) / duration) * 1.15
      const d = img.data
      for (let i = 0; i < cw * ch; i++) {
        const a = Math.max(0, Math.min(1, (thr[i] - p + 0.18) / 0.18))
        d[i * 4] = r
        d[i * 4 + 1] = g
        d[i * 4 + 2] = b
        d[i * 4 + 3] = a * 255
      }
      ctx.putImageData(img, 0, 0)
      if (p < 1.25) raf = requestAnimationFrame(draw)
      else {
        setDone(true)
        onDone?.()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (done) return null
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-30" />
}

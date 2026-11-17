// Nota al margen: lo que apuntaría a mano quien corrige (el porqué de un error, en ladrillo, como el boli rojo del profesor) o
// un comentario tranquilo (el pie de una figura, en grafito). Serif cursiva, sin caja ni color de fondo. Con `arrow`, una
// flecha corta a tinta que señala hacia arriba, a lo que comenta (se dibuja una vez).
import type { ReactNode } from 'react'
import { cx } from './cx'
import { InkArrow } from './paint'

export function MarginNote({ tone = 'brick', arrow, seed = 'nota', title, children, className }: {
  tone?: 'brick' | 'graphite'
  /** Flecha corta que señala arriba (a la respuesta tachada). */
  arrow?: boolean
  seed?: string
  /** La primera palabra, algo más firme («Todavía no»). */
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const color = tone === 'brick' ? 'var(--pigment-brick)' : 'var(--graphite)'
  return (
    <div className={cx('flex items-start gap-1.5', className)}>
      {arrow && <span aria-hidden className="relative block h-[26px] w-[30px] shrink-0 -mt-2"><InkArrow seed={`nota:${seed}`} w={30} h={26} from={{ x: 5, y: 22 }} to={{ x: 25, y: 3 }} loop={false} color={color} alpha={0.85} delay={180} /></span>}
      <div className="min-w-0 font-serif italic text-[1.1rem] leading-[calc(23rem/15)]">
        {title && <span className="font-medium" style={{ color }}>{title}</span>}
        {title && children ? <span style={{ color }}> — </span> : null}
        {children && <span className={tone === 'brick' ? 'text-text' : 'text-text2'}>{children}</span>}
      </div>
    </div>
  )
}

// Menú desplegable (y contextual) de cristal.
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from 'motion/react'
import { cx } from './cx'
import { placePopover } from './popover'

export interface MenuItem {
  label: ReactNode
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

// La animación de salida es visual: sus opciones ya no pertenecen al árbol accesible ni reciben clics/foco.
const MenuPanel = forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(function MenuPanel(props, ref) {
  const present = useIsPresent()
  return <motion.div {...props} ref={ref} role={present ? 'menu' : undefined} aria-hidden={present ? undefined : true} inert={!present} style={{ ...props.style, ...(!present ? { pointerEvents: 'none' } : {}) }} />
})

export function Menu({ trigger, items, align = 'end' }: { trigger: (open: () => void, expanded: boolean) => ReactNode; items: MenuItem[]; align?: 'start' | 'end' }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const firstFocus = useRef<'first' | 'last'>('first')
  const closeMenu = useCallback((restore: boolean) => {
    setRect(null)
    if (restore && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    if (!rect) return
    const close = (e: MouseEvent) => {
      const target = e.target as Node
      if (!anchor.current?.contains(target) && !menu.current?.contains(target)) closeMenu(false)
    }
    // Esc cierra el menú y nada más (antes también salía de la lección que lo contenía): en captura y marcado como atendido
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeMenu(true)
    }
    const blur = () => closeMenu(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('blur', blur, { once: true })
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc, true)
      window.removeEventListener('blur', blur)
    }
  }, [rect, closeMenu])
  const open = () => {
    returnFocus.current = anchor.current?.querySelector<HTMLElement>('button, [tabindex]') ?? null
    setSize(null)
    setRect(anchor.current?.getBoundingClientRect() ?? null)
  }
  // debajo si cabe; cerca del borde inferior, encima (nunca fuera de la ventana). Primero con una estimación y, antes de
  // pintar, con lo que mide de verdad (opciones de dos líneas, etiquetas largas: A4-P1-3)
  const menu = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    if (!rect) return
    const options = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    options?.[firstFocus.current === 'last' ? options.length - 1 : 0]?.focus({ preventScroll: true })
    firstFocus.current = 'first'
  }, [rect])
  const estimate = { width: 240, height: items.reduce((h, it) => h + 36 + (it.separatorBefore ? 9 : 0), 12) }
  useLayoutEffect(() => {
    const el = menu.current
    if (!rect || !el) return
    const real = { width: el.offsetWidth, height: el.scrollHeight }
    setSize((s) => (s && s.width === real.width && s.height === real.height ? s : real))
  }, [rect, items.length])
  const place = rect ? placePopover(rect, { width: window.innerWidth, height: window.innerHeight }, size ?? estimate, { align }) : null
  return (
    <span ref={anchor} className="inline-flex" data-aula-menu onKeyDown={(event) => {
      if (!rect && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault()
        event.stopPropagation()
        firstFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'
        open()
      }
    }}>
      {trigger(open, !!rect)}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {rect && (
            <MenuPanel
              ref={menu}
              data-aula-menu
              role="menu"
              aria-label={returnFocus.current?.getAttribute('aria-label') ?? undefined}
              onKeyDown={(event) => {
                if (event.key === 'Tab') { closeMenu(true); return }
                // El portal conserva el bubbling de React; el contenedor no debe consumir la activación nativa.
                if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); return }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                event.stopPropagation()
                const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
                const at = options.indexOf(document.activeElement as HTMLButtonElement)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                options[next]?.focus({ preventScroll: true })
              }}
              className="fixed z-[95] material-menu rounded-[14px] p-1.5 min-w-[220px] overflow-auto overscroll-contain print:hidden"
              style={{ ...(align === 'end' ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: place!.left }), top: place!.top, bottom: place!.bottom, maxHeight: place!.maxHeight }}
              initial={{ opacity: 0, y: place!.above ? 6 : -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: place!.above ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
            >
              {items.map((it, i) => (
                <div key={i}>
                  {it.separatorBefore && <div className="h-px bg-line my-1 mx-2" />}
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={it.disabled}
                    className={cx('w-full flex items-center gap-2.5 rounded-[11px] px-3 py-2 text-left text-[14px] font-medium hover:bg-fill1 disabled:opacity-40', it.danger && 'text-danger')}
                    onClick={() => {
                      closeMenu(true)
                      it.onSelect()
                    }}
                  >
                    <span className="w-4 grid place-items-center">{it.icon}</span>
                    {it.label}
                  </button>
                </div>
              ))}
            </MenuPanel>
          )}
        </AnimatePresence>,
        document.body
      )}
    </span>
  )
}

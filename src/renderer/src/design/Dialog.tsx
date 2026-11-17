// Diálogo modal y panel lateral de cristal, con fondo difuminado, Escape para cerrar y foco atrapado. En un teléfono o una
// tableta respetan la zona de la hora y de la barra de inicio, y lo que tapa el teclado de la pantalla (`--kb`, keyboard.ts),
// y se cierran arrastrándolos con el dedo (swipeClose.ts): el diálogo hacia abajo; el panel, hacia su lado o, en el teléfono,
// donde el de la derecha es una hoja que sube desde abajo, hacia abajo.
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cx } from './cx'
import { spring } from './tokens'
import { IconButton } from './Button'
import i18n from '@renderer/i18n'
import { useTabTrap } from './focusTrap'
import { isTouchOnly, useTouchOnly } from './input'
import { useSwipeClose } from './swipeClose'

/** ¿Pantalla de teléfono? (App.tsx pone `compact` en <html> con las pestañas abajo). */
function isPhone(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('compact')
}

/** El asa de una hoja que se arrastra (solo en el teléfono): dice que se puede bajar para cerrarla. */
function Grabber() {
  return <span aria-hidden data-grabber className="pointer-events-none absolute left-1/2 top-[7px] z-[1] h-[5px] w-9 -translate-x-1/2 rounded-full bg-line-strong/70" />
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent) => {
      // un control con su propio Esc abierto dentro (el selector de «@» del chat) lo cierra él, no el panel entero
      const own = (e.target as HTMLElement | null)?.closest?.('[data-own-escape="true"]')
      // un menú o una lista abiertos encima (en un portal) se cierran ellos primero; el diálogo, con el siguiente Esc
      const popup = document.querySelector('[role="menu"][data-aula-menu], [role="listbox"][data-aula-select]')
      if (e.key === 'Escape' && !own && !popup) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  }, [open, onClose])
}

function useFocusTrap(open: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const t = setTimeout(() => {
      const root = ref.current
      if (!root) return
      // si React ya enfocó un campo (autoFocus) dentro del diálogo, se respeta; si no, el primer campo y luego el primer botón
      if (root.contains(document.activeElement)) return
      // en una pantalla táctil, enfocar un campo saca el teclado sin pedirlo: se enfoca la capa (Tab y Esc siguen dentro)
      if (isTouchOnly()) return void root.focus({ preventScroll: true })
      const el =
        root.querySelector<HTMLElement>('[autofocus]') ??
        root.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select') ??
        root.querySelector<HTMLElement>('button:not([data-close]), [tabindex="0"]')
      el?.focus()
    }, 30)
    return () => {
      clearTimeout(t)
      prev?.focus?.()
    }
  }, [open])
  // y Tab no sale de la capa a la página tapada por el velo (A4-P2-11)
  useTabTrap(ref, open)
  return ref
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  hideClose?: boolean
  className?: string
}

const widths = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[760px]', xl: 'max-w-[1040px]', full: 'max-w-[min(1320px,94vw)]' }

/** La capa entera: no baja de lo que tapa el teclado, ni entra bajo la hora o la barra de inicio (en el escritorio, 0). */
const SAFE_LAYER = { bottom: 'var(--kb, 0px)', paddingTop: 'max(1.5rem, var(--safe-top, 0px))', paddingBottom: 'max(1.5rem, var(--safe-bottom, 0px))' }

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', hideClose, className }: DialogProps) {
  useEscape(open, onClose)
  const ref = useFocusTrap(open)
  const { offset, swiped } = useSwipeClose(ref, { open, axis: 'y', sign: 1, onClose })
  const grabber = useTouchOnly() && isPhone()
  return createPortal(
    <AnimatePresence>
      {open && (
        // en el teléfono, menos margen alrededor y dentro: con 24 + 28 px por lado quedaban 290 px para lo que dice
        <motion.div className="fixed inset-0 z-[80] grid place-items-center p-6 phone:px-3" style={SAFE_LAYER} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/20 dark:bg-black/45" onClick={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            style={{ maxHeight: 'min(88vh, calc(100dvh - var(--kb, 0px) - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 3rem))', y: offset }}
            className={cx('relative w-full bg-raised border-[0.5px] border-line shadow-[var(--e4)] rounded-[24px] p-7 overflow-auto overscroll-contain outline-none phone:p-5', widths[size], className)}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            // cerrado arrastrándolo: sigue hacia abajo desde donde se soltó
            variants={{ exit: () => (swiped.current ? { opacity: 0, y: offset.get() + 160, transition: { duration: 0.22 } } : { opacity: 0, y: 8, scale: 0.98 }) }}
            exit="exit"
            transition={spring.bouncy}
          >
            {grabber && <Grabber />}
            {!hideClose && (
              <IconButton label={i18n.t('common:actions.close')} data-close size="sm" className="absolute right-4 top-4" onClick={onClose}>
                <X size={16} />
              </IconButton>
            )}
            {title && <h2 className="t-title2 pr-10">{title}</h2>}
            {description && <p className="text-text2 mt-1.5">{description}</p>}
            {children && <div className={cx(title || description ? 'mt-5' : '')}>{children}</div>}
            {/* el pie se parte si no cabe; en un teléfono cada botón crece hasta llenar su fila */}
            {footer && <div className="mt-6 flex flex-wrap items-center justify-end gap-2 phone:[&>button]:grow">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export function Drawer({ open, onClose, children, side = 'right', width = 440, title, className }: { open: boolean; onClose: () => void; children: ReactNode; side?: 'right' | 'left'; width?: number; title?: ReactNode; className?: string }) {
  useEscape(open, onClose)
  const ref = useFocusTrap(open)
  // en el teléfono, el panel de la derecha ocupa la pantalla: es una hoja que sube desde abajo y se baja para cerrarla
  const sheet = side === 'right' && isPhone()
  const off = side === 'right' ? width + 40 : -(width + 40)
  const { offset } = useSwipeClose(ref, { open, axis: sheet ? 'y' : 'x', sign: side === 'left' && !sheet ? -1 : 1, onClose })
  const touch = useTouchOnly()
  const grabber = sheet && touch
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/10 dark:bg-black/35" onClick={onClose} />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className={cx('absolute bg-raised border-[0.5px] border-line shadow-[var(--e4)] rounded-[24px] flex flex-col overflow-hidden outline-none', side === 'right' ? 'right-3' : 'left-3', className)}
            style={{
              width,
              // en un teléfono el panel no cabe entero: ocupa la pantalla menos el margen
              maxWidth: 'calc(100vw - 24px)',
              top: 'calc(var(--titlebar-h, 0px) + 12px + var(--safe-top, 0px))',
              bottom: 'calc(12px + max(var(--safe-bottom, 0px), var(--kb, 0px)))',
              ...(sheet ? { y: offset } : { x: offset })
            }}
            initial={sheet ? { y: '105%' } : { x: off, opacity: 0.6 }}
            animate={sheet ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={sheet ? { y: '105%' } : { x: off, opacity: 0.6 }}
            transition={spring.smooth}
          >
            {grabber && <Grabber />}
            {title && (
              <div className="flex items-center justify-between px-5 pt-5 pb-2">
                <h2 className="t-title2">{title}</h2>
                <IconButton label={i18n.t('common:actions.close')} data-close size="sm" onClick={onClose}>
                  <X size={16} />
                </IconButton>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-auto">{children}</div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

/** Confirmación sencilla (Sí/No). */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, cancelLabel, danger }: { open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; description?: ReactNode; confirmLabel: string; cancelLabel: string; danger?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="sm"
      footer={
        <>
          <button className="h-10 px-4 rounded-[13px] font-semibold text-text2 hover:bg-fill1" onClick={onClose}>{cancelLabel}</button>
          <button className={cx('h-10 px-4 rounded-[13px] font-semibold text-white', danger ? 'bg-danger-fill text-white' : 'bg-accent text-on-accent')} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
        </>
      }
    />
  )
}

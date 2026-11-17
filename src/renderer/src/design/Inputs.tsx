// Campos de texto, interruptores, deslizadores y selector. El foco de un campo se ve: un anillo de 2 px con `--focus`
// (antes, un velo ladrillo que se quedaba en 1,3–1,7:1 sobre el papel). Con el dedo, `autoFocus` no enfoca: sacaría el
// teclado de la pantalla sin que nadie lo pidiera (se escribe al tocar el campo).
import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cx } from './cx'
import { spring } from './tokens'
import { placePopover } from './popover'
import { canAutoFocus } from './input'

/** Anillo de foco de un campo (borde de 0,5 px + sombra de 1,5 px = 2 px de `--focus`). Lo usan también herramientas y bloques. */
export const focusRing = 'focus:border-[color:var(--focus)] focus:shadow-[0_0_0_1.5px_var(--focus)]'
/** El mismo anillo en una caja que envuelve un campo sin borde propio. */
export const focusWithinRing = 'focus-within:border-[color:var(--focus)] focus-within:shadow-[0_0_0_1.5px_var(--focus)]'

const field = `w-full bg-field border-[0.5px] border-line-strong/40 rounded-[10px] px-3 text-[14px] text-text placeholder:text-text3 outline-none transition ${focusRing}`

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; trailing?: ReactNode; label?: ReactNode; hint?: ReactNode }>(function TextField(
  { icon, trailing, label, hint, className, autoFocus, ...rest },
  ref
) {
  const [outer, inner] = splitLayout(className)
  return (
    <label className={cx('block min-w-0', outer)}>
      {label && <span className="block t-ui font-medium text-text2 mb-1.5">{label}</span>}
      <span className="relative flex items-center">
        {icon && <span className="absolute left-3 text-text3 pointer-events-none">{icon}</span>}
        <input ref={ref} className={cx(field, 'h-9 min-w-0', icon && 'pl-10', trailing && 'pr-10', inner)} autoFocus={autoFocus && canAutoFocus()} {...rest} />
        {trailing && <span className="absolute right-2">{trailing}</span>}
      </span>
      {hint && <span className="block text-[12.5px] text-text3 mt-1.5">{hint}</span>}
    </label>
  )
})

/** Las clases de colocación (`flex-1`, `w-40`, `col-span-2`…) van al envoltorio: si no, el campo no crece en una fila flex. */
const LAYOUT = /^(?:[a-z0-9@:-]*:)?(?:flex-|grow|shrink|basis-|w-|min-w-|max-w-|self-|col-span|row-span|order-|justify-self)/
function splitLayout(className: string | undefined): [string, string] {
  const all = (className ?? '').split(/\s+/).filter(Boolean)
  return [all.filter((c) => LAYOUT.test(c)).join(' '), all.filter((c) => !LAYOUT.test(c)).join(' ')]
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; autoGrow?: boolean }>(function TextArea(
  { label, className, autoGrow, onChange, autoFocus, ...rest },
  ref
) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  const grow = () => {
    const el = inner.current
    if (!el || !autoGrow) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }
  useEffect(grow)
  return (
    <label className="block">
      {label && <span className="block t-ui font-medium text-text2 mb-1.5">{label}</span>}
      <textarea
        ref={(n) => {
          inner.current = n
          if (typeof ref === 'function') ref(n)
          else if (ref) ref.current = n
        }}
        className={cx(field, 'py-3 resize-none leading-relaxed', className)}
        onChange={(e) => {
          onChange?.(e)
          grow()
        }}
        autoFocus={autoFocus && canAutoFocus()}
        {...rest}
      />
    </label>
  )
})

export function Switch({ checked, onChange, label, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 32 : 40
  const h = size === 'sm' ? 18 : 24
  const k = h - 4
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative touch-target shrink-0 rounded-full transition-colors duration-300 no-drag disabled:opacity-50', checked ? '' : 'bg-fill4')}
      style={{ width: w, height: h, background: checked ? 'var(--accent)' : undefined }}
    >
      <motion.span className="absolute top-[2px] left-[2px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,.25)]" style={{ width: k, height: k }} animate={{ x: checked ? w - k - 4 : 0 }} transition={spring.bouncy} />
    </button>
  )
}

export function Slider({ value, min, max, step = 1, onChange, label, format, color = 'var(--accent)' }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label?: ReactNode; format?: (v: number) => string; color?: string }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <label className="block">
      {(label || format) && (
        <span className="flex justify-between t-ui font-medium text-text2 mb-1.5">
          <span>{label}</span>
          <span className="tabular text-text">{format ? format(value) : value}</span>
        </span>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="aula-range w-full"
        style={{ background: `linear-gradient(90deg, ${color} ${pct}%, var(--fill3) ${pct}%)` }}
      />
    </label>
  )
}

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
}

export function Select<T extends string>({ value, options, onChange, placeholder, className, label }: { value: T | null; options: SelectOption<T>[]; onChange: (v: T) => void; placeholder?: string; className?: string; label?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const current = options.find((o) => o.value === value)
  // debajo si cabe; cerca del borde inferior, encima (nunca fuera de la ventana)
  const listHeight = Math.min(320, options.reduce((h, o) => h + (o.hint ? 52 : 38), 12))
  const place = rect ? placePopover(rect, { width: window.innerWidth, height: window.innerHeight }, { width: Math.max(rect.width, 220), height: listHeight }, { maxHeight: 320 }) : null
  useEffect(() => {
    if (!open) return
    setRect(btn.current?.getBoundingClientRect() ?? null)
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-aula-select]')) setOpen(false)
    }
    // Esc cierra la lista y nada más (no el diálogo ni la lección de detrás)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])
  return (
    <div className={cx('block', className)}>
      {label && <span className="block t-ui font-medium text-text2 mb-1.5">{label}</span>}
      <button ref={btn} data-aula-select className={cx(field, 'h-9 flex items-center gap-2 text-left')} onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        {current?.icon}
        <span className={cx('flex-1 truncate', !current && 'text-text3')}>{current?.label ?? placeholder}</span>
        <ChevronDown size={16} className={cx('text-text3 transition-transform', open && 'rotate-180')} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              data-aula-select
              role="listbox"
              className="fixed z-[95] material-menu rounded-[14px] p-1.5 overflow-auto overscroll-contain"
              style={{ left: place!.left, top: place!.top, bottom: place!.bottom, maxHeight: place!.maxHeight, width: Math.max(rect.width, 220) }}
              initial={{ opacity: 0, y: place!.above ? 6 : -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: place!.above ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.16 }}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  className="w-full flex items-center gap-2.5 rounded-[11px] px-3 py-2 text-left hover:bg-fill1"
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  {o.icon}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium truncate">{o.label}</span>
                    {o.hint && <span className="block text-[12px] text-text3 truncate">{o.hint}</span>}
                  </span>
                  {o.value === value && <Check size={15} className="text-accent-text" />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}

/** «2026-12-06» → «dom., 6 dic. 2026» / «Sun, Dec 6, 2026», en el idioma que se pida (el de la interfaz). Vacío si no es una fecha. */
export function formatDateValue(value: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

/**
 * Campo de fecha (`AAAA-MM-DD`) que se lee en el idioma de la interfaz («Sun, Dec 6, 2026»), nunca «mm/dd/yyyy». Al pulsarlo
 * se abre el calendario del sistema; con una fecha puesta, la × la quita. `locale`, `placeholder` y `clearLabel` los da la
 * pantalla (el sistema de diseño no traduce).
 */
export function DateField({ value, onChange, label, locale, placeholder, clearLabel, min, icon, className }: {
  value: string
  onChange: (v: string) => void
  /** Nombre del campo (para lectores de pantalla y la pista). */
  label: string
  locale: string
  placeholder: string
  clearLabel: string
  min?: string
  icon?: ReactNode
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const shown = formatDateValue(value, locale)
  const open = () => {
    const el = input.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.focus()
    }
  }
  return (
    <span className={cx('relative inline-flex items-center gap-1', className)}>
      <span className="relative inline-flex">
        <button type="button" onClick={open} aria-label={shown ? `${label}: ${shown}` : label} className="inline-flex h-8 items-center gap-2 rounded-[10px] border-[0.5px] border-line-strong/40 bg-field px-3 text-left t-ui text-text transition-colors hover:bg-fill1">
          {icon && <span className="text-text3">{icon}</span>}
          <span className={cx('whitespace-nowrap', !shown && 'text-text3')}>{shown || placeholder}</span>
        </button>
        {/* el selector nativo, invisible encima del botón: su calendario sale justo ahí */}
        <input ref={input} type="date" tabIndex={-1} aria-hidden value={value} min={min} onChange={(e) => onChange(e.target.value)} className="pointer-events-none absolute inset-0 h-full w-full opacity-0" />
      </span>
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label={clearLabel} className="grid h-7 w-7 place-items-center rounded-[8px] text-text3 hover:bg-fill2 hover:text-text">
          <X size={13} />
        </button>
      )}
    </span>
  )
}

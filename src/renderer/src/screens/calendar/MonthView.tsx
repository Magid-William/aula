// Vista de mes: una hoja de papel que flota; al cambiar de mes se pasa la página (giro 3D suave).
// Hoy rodeado a mano, y de los días de los meses de al lado solo se apaga el número (sus eventos se leen igual); un pequeño
// examen pixel-art en los días de examen. Cada día enseña sus eventos en fichas que se pueden pulsar (24 px como poco), con
// el título entero en dos líneas si hay sitio y «+N» si no caben todos; si la ventana es tan baja que no cabe ninguna, quedan
// los puntos con el tono de cada curso.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { isSameDay, isSameMonth, format } from 'date-fns'
import { Card, InkRing, Sprite, cx, spring, useTheme } from '@renderer/design'
import type { CalEvent } from './data'
import { useEventColor } from './data'
import { eventsOn, fitChips, isAssessment, monthGrid } from './util'
import { fmtDate, fmtTime } from '@renderer/lib/format'
import { openEventSheet } from './sheet'
import { useSwipe } from './swipe'

const EXAM_SPRITE = ['.pppp..', '.p...p.', '.p.ll.p', '.p....p', '.p.lll.', '.p....p', '.pppppp']
/** Lo que ocupa la cabecera de un día (el número y sus márgenes), con el texto al 100 %. */
const HEAD = 48

/** Cuánto sitio (px, con el texto al 100 %) queda para las fichas en cada día. */
function useChipSpace(rows: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(50)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // con el texto más grande todo crece: se mide en «px al 100 %»
      const scale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 15 || 1
      setAvail(el.clientHeight / rows / scale - HEAD)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rows])
  return { ref, avail }
}

export function MonthView({ month, dir, events, selected, onSelect, onMore, onStep }: { month: Date; dir: number; events: CalEvent[]; selected: Date; onSelect: (d: Date) => void; onMore: (d: Date) => void; onStep?: (n: number) => void }) {
  const { t, i18n } = useTranslation('calendar')
  const { dark } = useTheme()
  const color = useEventColor()
  const days = monthGrid(month)
  const weeks = days.length / 7
  const headers = days.slice(0, 7).map((d) => fmtDate(d, { weekday: 'short' }).replace('.', ''))
  const today = new Date()
  const { ref, avail } = useChipSpace(weeks)
  // con el dedo se pasa de mes deslizando (el desplazamiento vertical sigue siendo del navegador)
  const swipe = useSwipe((n) => onStep?.(n))
  return (
    <div className="relative h-full touch-pan-y" style={{ perspective: 1600 }} {...(onStep ? swipe : {})}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={format(month, 'yyyy-MM')}
          custom={dir}
          className="h-full"
          style={{ transformOrigin: dir >= 0 ? 'top center' : 'bottom center' }}
          variants={{
            enter: (d: number) => ({ rotateX: d >= 0 ? -14 : 14, y: d >= 0 ? 30 : -30, opacity: 0 }),
            center: { rotateX: 0, y: 0, opacity: 1 },
            exit: (d: number) => ({ rotateX: d >= 0 ? 16 : -16, y: d >= 0 ? -24 : 24, opacity: 0 })
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={spring.smooth}
        >
          <Card floating elevation={2} padded={false} className="h-full flex flex-col overflow-hidden">
            <div className="grid grid-cols-7 px-3 pt-3 pb-1">
              {headers.map((h, i) => (
                <div key={i} className="t-caption text-center uppercase">
                  {h}
                </div>
              ))}
            </div>
            <div ref={ref} className="grid min-h-0 flex-1 grid-cols-7 px-3 pb-3" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }} lang={i18n.language}>
              {days.map((d, i) => {
                const evs = eventsOn(events, d)
                const inMonth = isSameMonth(d, month)
                const isToday = isSameDay(d, today)
                const isSel = isSameDay(d, selected)
                const exam = evs.find(isAssessment)
                const fit = fitChips(avail, evs.length)
                const shown = evs.slice(0, fit.shown)
                const more = evs.length - shown.length
                return (
                  <motion.div
                    key={d.toISOString()}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(d)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        onSelect(d)
                      }
                    }}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25, delay: 0.1 + (i % 7) * 0.012 + Math.floor(i / 7) * 0.03 }}
                    whileHover={{ y: -2 }}
                    className={cx('relative flex min-h-0 min-w-0 cursor-default flex-col items-start overflow-hidden rounded-[14px] p-2 text-left outline-none border-t-[0.5px] border-line-soft focus-visible:shadow-[inset_0_0_0_2px_var(--accent-wash)]', !isSel && 'hover:bg-fill1')}
                    aria-label={fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }) + (evs.length ? ` · ${t('eventsCount', { count: evs.length })}` : '')}
                    aria-pressed={isSel}
                  >
                    {isSel && <motion.span layoutId="cal-selected" transition={spring.snappy} className="absolute inset-0.5 rounded-[12px] bg-selected" />}
                    <span className="relative flex w-full items-center justify-between">
                      {isToday ? (
                        // hoy, rodeado a mano con un trazo de pincel
                        <InkRing seed="today" size={28} delay={450} className="font-serif text-[16px] tabular text-text">{d.getDate()}</InkRing>
                      ) : (
                        <span className={cx('grid place-items-center w-7 h-7 rounded-full font-serif text-[16px] tabular', inMonth ? 'text-text' : 'text-text3 opacity-60')}>{d.getDate()}</span>
                      )}
                      {exam && (
                        <motion.span initial={{ y: -4, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.3 }} title={exam.title}>
                          <Sprite rows={EXAM_SPRITE} legend={{ p: color(exam, dark), l: 'var(--text3)' }} size={14} />
                        </motion.span>
                      )}
                    </span>
                    {fit.shown > 0 ? (
                      <span className="relative mt-1 flex w-full min-w-0 flex-col gap-[2px]">
                        {shown.map((e, li) => {
                          const c = color(e, dark)
                          const last = li === shown.length - 1 && more > 0
                          return (
                            <span key={e.id} className="flex w-full min-w-0 items-start gap-1">
                              <button
                                type="button"
                                onClick={(ev) => {
                                  ev.stopPropagation()
                                  onSelect(d)
                                  openEventSheet(e.id, e.view)
                                }}
                                title={`${e.allDay ? t('allDay') : fmtTime(e.start)} · ${e.title}`}
                                className={cx(
                                  'flex min-h-[calc(24rem/15)] min-w-0 flex-1 items-start gap-[3px] rounded-[6px] px-[3px] py-[calc(4.5rem/15)] text-left text-[calc(11.5rem/15)] font-medium leading-[calc(15rem/15)] text-text outline-none focus-visible:ring-2 focus-visible:ring-accent-line',
                                  e.allDay ? 'hover:brightness-95' : 'hover:bg-fill2',
                                  e.done && 'line-through opacity-55'
                                )}
                                // los de todo el día, sobre un velo de su color; los de con hora, con un punto
                                style={e.allDay ? { background: `color-mix(in oklab, ${c} ${dark ? 26 : 15}%, transparent)` } : undefined}
                              >
                                {!e.allDay && <span className="mt-[calc(4.5rem/15)] h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: c }} />}
                                {/* el título entero en dos líneas si hay sitio; si no, en una */}
                                <span className={cx('min-w-0', li < fit.wrap ? 'line-clamp-2 break-words hyphens-auto' : 'truncate')}>{e.title}</span>
                              </button>
                              {last && (
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation()
                                    onMore(d)
                                  }}
                                  className="min-h-[calc(24rem/15)] shrink-0 rounded-[6px] px-1 text-[calc(11.5rem/15)] font-semibold tabular text-text2 hover:bg-fill2"
                                  aria-label={t('moreEvents', { count: more })}
                                >
                                  +{more}
                                </button>
                              )}
                            </span>
                          )
                        })}
                      </span>
                    ) : (
                      <span className="relative mt-auto flex flex-wrap gap-[3px] pl-1 pb-0.5">
                        {evs.slice(0, 5).map((e) => (
                          <span key={e.id} className={cx('w-[6px] h-[6px] rounded-full', e.done && 'opacity-40')} style={{ background: color(e, dark) }} />
                        ))}
                      </span>
                    )}
                  </motion.div>
                )
              })}
            </div>
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

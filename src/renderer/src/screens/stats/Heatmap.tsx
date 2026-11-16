// Constancia: 12 semanas × 7 días (lunes arriba) en casillas que se encienden semana a semana, con los meses encima, la
// leyenda «Menos … Más» y una línea que lee el día señalado (hoy si no se señala ninguno). Es un dato de todo tu estudio:
// va en aguada de grafito (los días sin estudio, solo con su contorno) y hoy lleva su anillo ladrillo.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, SectionTitle, cx } from '@renderer/design'
import { capitalize, fmtDate, fmtMinutes, weekdayLetters } from '@renderer/lib/format'
import type { StatsDay } from '@shared/ipc/stats'
import { heatGrid, heatLevel, keyToDate, washFor } from './derive'

const CELL_MAX = 34
const GAP = 5

export function HeatmapCard({ days, today }: { days: StatsDay[]; today: string }) {
  const { t } = useTranslation('stats')
  const { cells, weeks, weekStarts } = useMemo(() => heatGrid(days), [days])
  const [hover, setHover] = useState<string | null>(null)
  const letters = weekdayLetters()
  const shown = days.find((d) => d.date === (hover ?? today)) ?? days[days.length - 1]
  // un mes se rotula en la primera semana que empieza en él
  const monthTicks = weekStarts.map((s, i) => (i === 0 || keyToDate(s).getMonth() !== keyToDate(weekStarts[i - 1]).getMonth() ? i : -1)).filter((i) => i >= 0)

  return (
    <Card enterAnim className="h-full flex flex-col">
      <SectionTitle title={t('heat.title')} detail={t('heat.detail')} />
      <div className="flex-1 grid place-items-center py-2">
        <div className="w-full" style={{ maxWidth: 22 + weeks * (CELL_MAX + GAP) }} onMouseLeave={() => setHover(null)}>
          <div className="grid" style={{ gridTemplateColumns: `22px repeat(${weeks}, minmax(0, 1fr))`, columnGap: GAP }}>
            <div />
            {Array.from({ length: weeks }, (_, w) => (
              <div key={w} className="t-caption text-text3 h-5 whitespace-nowrap overflow-visible">
                {monthTicks.includes(w) && weekStarts[w] ? capitalize(fmtDate(keyToDate(weekStarts[w]), { month: 'short' }).replace('.', '')) : ''}
              </div>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: `22px repeat(${weeks}, minmax(0, 1fr))`, gridTemplateRows: 'repeat(7, auto)', gap: GAP }} role="grid" aria-label={t('heat.title')}>
            {letters.map((l, wd) => (
              <div key={`l${wd}`} className="t-caption text-text3 flex items-center" style={{ gridColumn: 1, gridRow: wd + 1 }} aria-hidden>
                {wd % 2 === 0 ? l : ''}
              </div>
            ))}
            {cells.map((c) => {
              const level = heatLevel(c.day.minutes)
              const isToday = c.day.date === today
              const label = cellLabel(t, c.day)
              return (
                <motion.div
                  key={c.day.date}
                  role="gridcell"
                  aria-label={label}
                  tabIndex={-1}
                  onMouseEnter={() => setHover(c.day.date)}
                  onFocus={() => setHover(c.day.date)}
                  initial={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1], delay: 0.1 + c.week * 0.03 + c.weekday * 0.01 }}
                  whileHover={{ scale: 1.18 }}
                  className={cx('aspect-square rounded-[5px] cursor-default', isToday && 'ring-[1.5px] ring-offset-[1.5px] ring-offset-surface ring-accent-line', hover === c.day.date && 'ring-[1.5px] ring-text3')}
                  style={{ gridColumn: c.week + 2, gridRow: c.weekday + 1 }}
                >
                  {/* el color va en una aguada de dentro: los anillos de hoy y del ratón no se recortan */}
                  <Swatch level={level} className={cx('block h-full w-full rounded-[5px]', `dab-${((c.week * 3 + c.weekday) % 4) + 1}`)} />
                </motion.div>
              )
            })}
          </div>
          <div className="flex items-center justify-between gap-4 mt-3 pl-[27px]">
            <div className="t-footnote text-text2 truncate min-h-[18px]" aria-live="polite">
              {shown ? cellLabel(t, shown) : ''}
            </div>
            <div className="flex items-center gap-1.5 shrink-0" aria-hidden>
              <span className="t-caption text-text3 mr-0.5">{t('heat.less')}</span>
              {[0, 1, 2, 3, 4].map((l) => (
                <Swatch key={l} level={l} className="h-2.5 w-2.5 rounded-[3px]" />
              ))}
              <span className="t-caption text-text3 ml-0.5">{t('heat.more')}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

/** Una casilla de color: la aguada de su nivel o, sin estudio, solo el contorno (el color nunca va solo). */
function Swatch({ level, className }: { level: number; className?: string }) {
  const wash = washFor(level)
  return <span aria-hidden className={cx(wash ? 'dab' : 'bg-fill1 shadow-[inset_0_0_0_1px_var(--rule)]', className)} style={wash ? { background: wash } : undefined} />
}

function cellLabel(t: (k: string, o?: Record<string, unknown>) => string, d: StatsDay): string {
  const date = capitalize(fmtDate(keyToDate(d.date), { weekday: 'long', day: 'numeric', month: 'long' }))
  // un día sin estudio no dice «0 min»
  if (!(d.minutes > 0) && !(d.attempts > 0)) return t('heat.cellNone', { date })
  const minutes = fmtMinutes(d.minutes)
  return d.attempts > 0 ? t('heat.cellExercises', { date, minutes, count: d.attempts }) : t('heat.cell', { date, minutes })
}

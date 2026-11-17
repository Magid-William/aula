// «Esta semana»: un calendario pequeño que flota. Los siete días (hoy rodeado a mano con tinta ladrillo, un punto por cada
// cosa que hay ese día) y debajo las fechas más cercanas en dos líneas, enteras (sin «Trigonomet…»): el glifo del tipo de
// evento en gris tinta y, si es de un curso, un punto con su tinta. Tocar una abre su hoja, la misma del calendario.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, Floating, SectionTitle, Icon, InkRing, toneForHue, useTheme, type IconName } from '@renderer/design'
import type { HomeCourse, HomeEvent } from '@shared/ipc/home'
import { capitalize, daysFrom, daysUntil, fmtDate, fmtTime, relativeDay, startOfDay } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { EventSheetHost } from '@renderer/screens/calendar/EventSheet'
import { openEventSheet } from '@renderer/screens/calendar/sheet'
import { SampleTag, showsAsSample } from '@renderer/lib/sample'

export const EVENT_ICONS: Record<HomeEvent['kind'], IconName> = { exam: 'exam', assignment: 'checklist', class: 'users', event: 'calendar', task: 'check-circle', study: 'learn' }

/** Cuántas fechas se enumeran debajo de los días. */
const LISTED = 4

export function WeekCard({ events, courses }: { events: HomeEvent[]; courses: HomeCourse[] }) {
  const { t } = useTranslation(['home', 'common', 'calendar'])
  const { dark } = useTheme()
  const today = startOfDay(new Date())
  // días civiles: sumar 24 h repetía el domingo 1 cuando cambia la hora (J2-1)
  const days = daysFrom(today, 7)
  // la tinta del curso de un evento (los que no son de un curso van en gris)
  const inkOf = (e: HomeEvent): string | null => {
    const c = e.courseId ? courses.find((x) => x.id === e.courseId) : undefined
    if (!c) return null
    const tone = toneForHue(c.hue)
    return dark ? tone.inkDark : tone.inkLight
  }
  return (
    <Floating amplitude={3} duration={9} className="h-full">
      <Card enterAnim padded="lg" elevation={2} className="h-full flex flex-col">
        <SectionTitle
          title={t('week')}
          action={
            <button className="text-accent-text font-medium hover:underline underline-offset-2" onClick={() => navigate({ name: 'calendar' })}>
              {t('openCalendar')}
            </button>
          }
        />
        <div className="grid grid-cols-7 gap-1 mt-2 -mx-1">
          {days.map((d, i) => {
            const evs = events.filter((e) => daysUntil(e.start, today) === i)
            const isToday = i === 0
            return (
              <motion.button
                key={i}
                type="button"
                onClick={() => navigate({ name: 'calendar', date: d.toISOString() })}
                aria-label={capitalize(fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }))}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 + i * 0.035 }}
                className="flex flex-col items-center rounded-[12px] py-1.5 outline-none hover:bg-fill1 focus-visible:bg-fill1"
              >
                <span className="t-caption uppercase">{fmtDate(d, { weekday: 'short' }).replace('.', '')}</span>
                {isToday ? (
                  // hoy, rodeado a mano con un trazo de pincel ladrillo
                  <InkRing seed="today" size={32} delay={950} className="mt-1 font-serif text-[calc(17rem/15)] tabular text-text">{d.getDate()}</InkRing>
                ) : (
                  <span className="mt-1 grid place-items-center w-8 h-8 rounded-full font-serif text-[calc(17rem/15)] tabular text-text">{d.getDate()}</span>
                )}
                <span className="flex gap-[3px] h-1.5 mt-1">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e.id} className="w-[6px] h-[6px] rounded-full" style={{ background: inkOf(e) ?? 'var(--text3)' }} />
                  ))}
                </span>
              </motion.button>
            )
          })}
        </div>
        <ul className="m-0 mt-3 flex list-none flex-col p-0">
          {events.length === 0 && <li className="t-callout text-text3 py-2">{t('noEvents')}</li>}
          {events.slice(0, LISTED).map((e, i) => {
            const ink = inkOf(e)
            return (
              <motion.li key={e.id} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.3 + i * 0.05 }} className="border-t border-rule first:border-t-0">
                <button
                  type="button"
                  onClick={() => openEventSheet(e.id)}
                  aria-label={t('calendar:openEvent', { title: e.title })}
                  className="group flex w-full items-start gap-3 rounded-[12px] px-1 py-2 text-left outline-none hover:bg-fill1 focus-visible:bg-fill1"
                >
                  <Icon name={EVENT_ICONS[e.kind]} size={16} className="mt-[3px] shrink-0 text-text2" />
                  <span className="min-w-0 flex-1">
                    {/* dos líneas: el nombre entero y cuándo */}
                    <span className="block t-callout text-text text-pretty">{e.title}</span>
                    <span className="flex items-center gap-1.5 t-ui tabular text-text2">
                      {ink && <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: ink }} />}
                      {capitalize(relativeDay(e.start))}
                      {!e.allDay && ` · ${fmtTime(e.start)}`}
                      {showsAsSample(e.courseId) && <SampleTag />}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={14} className="mt-1 shrink-0 text-text3 transition-transform group-hover:translate-x-0.5" />
                </button>
              </motion.li>
            )
          })}
        </ul>
        {/* semana tranquila: una línea que invita a apuntar lo que viene (Aula reparte el estudio hasta cada fecha) */}
        {events.length < 3 && (
          <p className="mt-auto pt-3 t-footnote text-text2">
            {t('weekHint')}{' '}
            <button type="button" className="t-ui font-medium text-accent-text hover:underline underline-offset-2" onClick={() => navigate({ name: 'calendar' })}>
              {t('weekAdd')}
            </button>
          </p>
        )}
      </Card>
      <EventSheetHost />
    </Floating>
  )
}

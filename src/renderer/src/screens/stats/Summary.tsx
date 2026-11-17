// Las cifras en un párrafo en serif: cuánto has estudiado, en cuántos días, con qué acierto y tu racha. Cada cifra va dentro
// de la frase (en tinta, contando hacia arriba) y nunca se enseña un cero: lo que no hay, no se dice.
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, AnimatedNumber } from '@renderer/design'
import type { StatsDay } from '@shared/ipc/stats'
import { percentSuffix } from '@renderer/lib/format'
import { streak, totals } from './derive'
import { slot, splitSlots } from './sentence'

/** Una cifra dentro de la frase. */
function Figure({ children }: { children: ReactNode }) {
  return <span className="text-text tabular whitespace-nowrap">{children}</span>
}

export function SummaryCard({ days, today }: { days: StatsDay[]; today: string }) {
  const { t } = useTranslation('stats')
  const tot = totals(days)
  const s = streak(days, today)
  const total = Math.round(tot.minutes)
  const hours = Math.floor(total / 60)
  const mins = total % 60
  const slots: Record<string, ReactNode> = {
    time:
      total === 0 ? (
        t('summary.underMinute')
      ) : (
        <>
          {hours > 0 && <AnimatedNumber value={hours} />}
          {hours > 0 && ' h'}
          {hours > 0 && mins > 0 && ' '}
          {mins > 0 && <AnimatedNumber value={mins} />}
          {mins > 0 && ' min'}
        </>
      ),
    days: <AnimatedNumber value={tot.activeDays} />,
    percent: tot.accuracy != null ? <AnimatedNumber value={Math.round(tot.accuracy * 100)} suffix={percentSuffix()} /> : null,
    current: <AnimatedNumber value={s.current} />,
    best: <AnimatedNumber value={s.best} />
  }
  const marks = { time: slot('time'), days: slot('days'), percent: slot('percent'), current: slot('current'), best: slot('best') }
  const lead = tot.accuracy != null ? t('summary.leadAccuracy', { ...marks, count: tot.activeDays }) : t('summary.lead', { ...marks, count: tot.activeDays })
  const streakText =
    s.current > 1 ? (s.best > s.current ? t('summary.streakBest', marks) : t('summary.streakIsBest', marks)) : s.current === 1 && s.best <= 1 ? t('summary.streakOne') : s.best > 1 ? t('summary.bestOnly', marks) : null
  const render = (text: string) =>
    splitSlots(text).map((p, i) => (p.kind === 'text' ? <span key={i}>{p.text}</span> : <Figure key={i}>{slots[p.name]}</Figure>))

  return (
    <Card enterAnim padded="lg">
      <p className="max-w-[920px] font-serif text-[calc(24rem/15)] leading-[calc(35rem/15)] tracking-[-0.1px] text-text2 text-pretty">
        {render(lead)}
        {streakText && <> {render(streakText)}</>}
      </p>
    </Card>
  )
}

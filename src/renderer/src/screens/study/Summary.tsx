// Final de una sesión (lección, práctica, tarjetas, errores, plan): la cifra protagonista en serif que cuenta (de ella salen las
// gotas de pixelBurst si es un buen resultado: un logro de verdad), el título en serif, el resto de cifras (sin ceros) y lo
// que se puede hacer después.
import { useEffect, useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { AnimatedNumber, Button, Card, Icon, pixelBurst, Stagger, StaggerItem, useTheme } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { activePlan, completeCurrentStep, nextStep, runStep } from './plan/session'

export interface SummaryStat {
  value: number
  /** Texto en lugar de la cifra («6 de 9»). */
  text?: string
  suffix?: string
  label: string
}

/** Las cifras que se enseñan debajo de la protagonista: nunca un cero («0 pistas» no dice nada). */
export function shownStats(stats: readonly SummaryStat[]): SummaryStat[] {
  return stats.filter((s) => s.text !== undefined || s.value !== 0)
}

export function SessionSummary({ title, body, stats, celebrate = true, children, actions, packId }: {
  /** Curso: si se sigue el plan de hoy, el paso queda hecho y se ofrece el siguiente. */
  packId?: string
  title: ReactNode
  body?: ReactNode
  /** La primera es la cifra protagonista (grande, en serif); las demás van debajo. */
  stats?: SummaryStat[]
  /** Un buen resultado: las gotas de píxeles salen de la cifra. */
  celebrate?: boolean
  children?: ReactNode
  actions?: ReactNode
}) {
  const figureRef = useRef<HTMLDivElement>(null)
  const { reducedMotion } = useTheme()
  const hero = stats?.[0]
  const rest = shownStats(stats?.slice(1) ?? [])
  const hasHero = !!hero
  // una vez al aparecer (no en cada pintado: el progreso se sigue guardando detrás)
  useEffect(() => {
    if (!celebrate || !hasHero || reducedMotion) return
    const t = setTimeout(() => figureRef.current && pixelBurst(figureRef.current, { count: 18 }), 520)
    return () => clearTimeout(t)
  }, [celebrate, hasHero, reducedMotion])
  return (
    <Stagger className="flex flex-col items-center gap-6 pt-6 text-center" gap={0.07}>
      {hero && (
        <StaggerItem>
          <motion.div ref={figureRef} className="flex flex-col items-center" initial={reducedMotion ? false : { scale: 0.85, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}>
            <span className="t-number text-[64px] leading-[68px] tracking-[-0.02em]">{hero.text ?? <AnimatedNumber value={hero.value} suffix={hero.suffix ?? ''} />}</span>
            <span className="t-callout text-text2">{hero.label}</span>
          </motion.div>
        </StaggerItem>
      )}
      <StaggerItem className="flex max-w-[560px] flex-col items-center gap-2">
        <h1 className="t-display text-[38px] leading-[44px]">{title}</h1>
        {body && <p className="t-body text-text2">{body}</p>}
      </StaggerItem>
      {rest.length > 0 && (
        <StaggerItem className="w-full max-w-[640px]">
          <Card padded="lg" className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(4, rest.length)}, minmax(0, 1fr))` }}>
            {rest.map((s, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className="t-number text-[30px] leading-[34px]">{s.text ?? <AnimatedNumber value={s.value} suffix={s.suffix ?? ''} />}</span>
                <span className="t-caption">{s.label}</span>
              </div>
            ))}
          </Card>
        </StaggerItem>
      )}
      {children && <StaggerItem className="w-full max-w-[640px] text-left">{children}</StaggerItem>}
      {packId && (
        <StaggerItem className="w-full max-w-[640px]">
          <PlanContinue packId={packId} />
        </StaggerItem>
      )}
      {actions && <StaggerItem className="flex flex-wrap items-center justify-center gap-2">{actions}</StaggerItem>}
    </Stagger>
  )
}

/** Siguiendo «Estudiar ahora»: el paso queda hecho y se ofrece el siguiente. */
export function PlanContinue({ packId }: { packId: string }) {
  const { t } = useTranslation('study')
  const plan = activePlan(packId)
  useEffect(() => {
    completeCurrentStep(packId)
  }, [packId])
  const next = plan ? nextStep(packId) : null
  if (!next) return null
  return (
    <div className="flex w-full items-center gap-3 rounded-[18px] bg-accent-wash px-4 py-3 text-left">
      <Icon name="today" size={18} className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1">
        <span className="block t-ui font-semibold text-accent-text">{t('plan.nextStep')}</span>
        <span className="block t-callout truncate"><RichText text={next.item.title} inline /></span>
      </span>
      <Button variant="primary" size="lg" iconRight={<Icon name="arrow-right" size={15} />} onClick={() => runStep(packId, next.index)}>{t('plan.continue')}</Button>
    </div>
  )
}

// Logros: la estantería de Estadísticas. Cada logro es un sello dibujado a mano con su glifo: los conseguidos, en tinta
// ladrillo con la fecha en que se cumplió; los que faltan, en grafito apagado con lo que llevas. El glifo es el mismo que
// usa el aviso al conseguirlo.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { AchievementId, AchievementView } from '@shared/ipc/achievements'
import { Card, DrawnTile, Icon, ProgressBar, SectionTitle, cx, type IconName, type PixelAnimation } from '@renderer/design'
import { useRpc } from '@renderer/lib/useRpc'
import { fmtDate } from '@renderer/lib/format'

/** El glifo de cada logro (los iconos de Aula: los mismos que en el resto de la app). */
export const ACHIEVEMENT_ICONS: Record<AchievementId, IconName> = {
  firstAnswer: 'check-circle', creator: 'create', streak3: 'streak', streak7: 'streak', streak30: 'streak', hour1: 'clock', hours10: 'clock',
  correct100: 'goal', correct1000: 'goal', cards100: 'cards', cards1000: 'cards', firstMastered: 'lightbulb', mastered10: 'lightbulb',
  mistakes10: 'mistakes', mockPassed: 'exam', courseReady: 'flag'
}

/** El glifo de un logro: en ladrillo si se consiguió; si no, en gris. (El aviso lo pone sobre su propio sello.) */
export function AchievementArt({ id, size = 40, lit = true }: {
  id: AchievementId
  size?: number
  lit?: boolean
  /** @deprecated Sin uso desde el sello a tinta: solo lo pasa aún `AchievementToast` (de W1); se quita con W5-Z. */
  animation?: PixelAnimation
}) {
  return <Icon name={ACHIEVEMENT_ICONS[id]} size={Math.round(size * 0.6)} className={lit ? 'text-accent-text' : 'text-text2'} />
}

/** El sello: una loseta dibujada a mano con el glifo dentro. */
function Seal({ id, earned }: { id: AchievementId; earned: boolean }) {
  return (
    <span className={cx('grid place-items-center', !earned && 'opacity-35')}>
      <DrawnTile
        seed={id}
        size={44}
        radius={13}
        fill={earned ? 'color-mix(in oklab, var(--pigment-brick) 14%, var(--surface))' : 'color-mix(in oklab, var(--wash-2) 45%, var(--surface))'}
        ink={earned ? 'var(--pigment-brick)' : 'var(--wash-4)'}
        inkAlpha={earned ? 0.8 : 0.7}
      >
        <AchievementArt id={id} size={40} lit={earned} />
      </DrawnTile>
    </span>
  )
}

/** La estantería de logros (al final de Estadísticas). */
export function AchievementsCard() {
  const { t } = useTranslation('stats')
  const { data } = useRpc('achievements.list', undefined, { events: ['achievements.earned', 'progress.changed'] as never })
  if (!data?.length) return null
  const earned = data.filter((a) => a.earned).length
  return (
    <Card padded="lg">
      <SectionTitle title={t('achievements.title')} detail={t('achievements.count', { earned, total: data.length })} />
      <div className="mt-5 grid gap-x-3 gap-y-6 grid-cols-2 @2xl:grid-cols-4 @5xl:grid-cols-8">
        {data.map((a, i) => (
          <Badge key={a.id} a={a} index={i} />
        ))}
      </div>
    </Card>
  )
}

function Badge({ a, index }: { a: AchievementView; index: number }) {
  const { t } = useTranslation('stats')
  const name = t(`achievements.items.${a.id}.name`)
  const how = t(`achievements.items.${a.id}.how`)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: 0.05 + index * 0.025 }}
      title={a.earned && a.earnedAt ? `${how} · ${fmtDate(a.earnedAt, { day: 'numeric', month: 'short', year: 'numeric' })}` : how}
      className="flex flex-col items-center text-center px-1"
    >
      <Seal id={a.id} earned={a.earned} />
      <div className={cx('t-ui font-semibold mt-2.5 leading-tight text-pretty', a.earned ? 'text-text' : 'text-text2')}>{name}</div>
      {a.earned ? (
        <div className="t-caption mt-0.5 tabular">{a.earnedAt ? fmtDate(a.earnedAt, { day: 'numeric', month: 'short' }) : t('achievements.done')}</div>
      ) : a.value > 0 && a.goal > 1 ? (
        <div className="w-full max-w-[96px] mt-1.5">
          <ProgressBar value={a.value / a.goal} height={3} color="var(--wash-4)" />
          <div className="t-caption mt-1 tabular">{t('achievements.progress', { value: a.value, goal: a.goal })}</div>
        </div>
      ) : (
        // sin nada hecho aún (o de una sola vez), lo que hay que hacer en vez de «0 de 1»
        <div className="t-caption mt-0.5 text-pretty">{how}</div>
      )}
    </motion.div>
  )
}

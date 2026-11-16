// La racha, en una línea del saludo: «Racha de 3 días · tu mejor marca: 7». Sin racha no sale nada (nunca un cero), y la
// mejor marca solo si es otra.
import { useTranslation } from 'react-i18next'
import type { HomeSummary } from '@shared/ipc/home'

export function StreakLine({ streak }: { streak: HomeSummary['streak'] }) {
  const { t } = useTranslation('home')
  if (streak.days <= 0) return null
  return (
    <p className="t-callout text-text2 mt-1.5 tabular">
      {t('streakLine', { count: streak.days })}
      {streak.best > streak.days && ` · ${t('streakBest', { count: streak.best })}`}
    </p>
  )
}

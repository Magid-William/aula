// El dominio de un tema: una barra fina con la tinta del curso y su porcentaje al lado. Un tema sin ver es una barra vacía
// con contorno y sin cifra (el color nunca va solo, y nunca se enseña un «0 %»).
import { useTranslation } from 'react-i18next'
import { cx, ProgressBar } from '@renderer/design'
import { fmtPercent } from '@renderer/lib/format'

export function MasteryBar({ value, ink, width = 64, className }: { value: number | undefined; ink: string; width?: number; className?: string }) {
  const { t } = useTranslation('course')
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-2', className)}>
      {value === undefined ? (
        <span role="img" aria-label={t('masteryUnseen')} className="block h-[5px] rounded-full border border-line-strong/50" style={{ width }} />
      ) : (
        <span className="block" style={{ width }}>
          <ProgressBar value={value} color={ink} height={4} label={t('masteryOf', { pct: fmtPercent(value) })} />
        </span>
      )}
      <span className="w-[38px] t-footnote tabular text-text2">{value === undefined ? '' : fmtPercent(value)}</span>
    </span>
  )
}

// Simulacro, sin repetir la portada del examen (esa está al empezarlo): en una línea lo que es (preguntas, minutos y puntos)
// con el botón para hacerlo (o seguir el que está a medias), los simulacros hechos con su nota y las secciones del examen.
import { useTranslation } from 'react-i18next'
import type { Pack } from '@shared/schema'
import { examPercent } from '@shared/schema'
import { examBlueprint } from '@engine/study'
import { Button, Card, EmptyState, Icon, InkSpot, ProgressBar, SectionTitle, Spinner, Stagger } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { fmtDate, fmtPercent } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { useCourseData } from '@renderer/screens/study/data'
import { useInk } from '@renderer/screens/study/kit'
import { examExerciseCount } from '@renderer/screens/study/exam/ExamStart'

export function ExamTab({ pack }: { pack: Pack }) {
  const { t } = useTranslation(['course', 'study'])
  const { data, status } = useCourseData(pack.id)
  const ink = useInk(pack)
  if (!data) return status === 'loading' ? <div className="grid place-items-center py-16 text-text3"><Spinner size={18} /></div> : <EmptyState title={t('study:common.loadError')} />
  const bp = examBlueprint(pack)
  // sin ejercicios no hay simulacro que montar
  const available = examExerciseCount(data.skills) > 0
  const questions = available ? bp.sections.reduce((a, s) => a + s.count, 0) : 0
  const points = Math.round(bp.sections.reduce((a, s) => a + s.count * s.pointsEach, 0))
  const past = data.progress.exams.filter((e) => e.kind !== 'diagnostic').sort((a, b) => (a.date < b.date ? 1 : -1))
  const pending = data.progress.examRun
  const title = (id: string): string => data.skills.find((s) => s.id === id)?.title ?? pack.skills.find((s) => s.id === id)?.title ?? id
  const go = (): void => navigate({ name: 'study', id: pack.id, mode: 'exam' })
  const lineKey = pack.blueprint ? 'exam.lineReal' : 'exam.line'

  return (
    <Stagger className="flex flex-col gap-4" gap={0.05}>
      <Card enterAnim padded="lg" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h2 className="t-title2 text-text">{pack.exam?.title ?? t('study:exam.title')}</h2>
          <p className="t-callout text-text2 mt-1">
            {questions ? t(lineKey, { count: questions, minutes: bp.durationMinutes, points }) : t('study:exam.noExercisesBody')}
          </p>
          {pending && (
            <p className="t-callout text-text mt-1.5 flex items-center gap-1.5">
              <Icon name="clock" size={15} className="text-text2" />
              {t('study:tab.exam.pending', { answered: pending.items.filter((i) => i.answer !== undefined && i.answer !== null).length, total: pending.items.length })}
            </p>
          )}
        </div>
        <Button variant="primary" size="lg" icon={<Icon name="exam" size={16} />} disabled={!questions && !pending} onClick={go}>
          {pending ? t('exam.continue') : t('exam.take')}
        </Button>
      </Card>

      <div className="flex flex-col gap-4 @5xl:grid @5xl:grid-cols-12 @5xl:items-start">
        <Card enterAnim padded="lg" className="@5xl:col-span-5">
          <SectionTitle title={t('exam.past')} />
          {past.length === 0 ? (
            <div className="flex items-center gap-4">
              <InkSpot name="hourglass" className="h-[64px] w-[78px] shrink-0" />
              <p className="t-callout text-text2">{t('exam.none')}</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-rule">
              {past.slice(0, 8).map((e) => {
                const pct = examPercent(e)
                return (
                  <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_88px_auto] items-center gap-4 py-2.5">
                    <span className="t-callout text-text2 truncate">{fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                    <ProgressBar value={pct} color={ink} height={4} />
                    <span className="w-12 text-right t-number-inline tabular">{fmtPercent(pct)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card enterAnim padded="lg" className="@5xl:col-span-7">
          <SectionTitle title={t('study:exam.sections')} />
          <div className="flex flex-col divide-y divide-rule">
            {bp.sections.map((s, i) => (
              <div key={i} className="py-3 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="t-headline"><RichText text={s.title} inline /></span>
                  <span className="shrink-0 t-ui tabular text-text2">{t('study:exam.sectionMeta', { count: s.count, points: s.pointsEach })}</span>
                </div>
                <div className="t-footnote mt-0.5">{s.skillIDs.map(title).join(' · ')}</div>
              </div>
            ))}
          </div>
          {bp.instructions && <div className="mt-3 t-callout text-text2"><RichText text={bp.instructions} /></div>}
        </Card>
      </div>
    </Stagger>
  )
}

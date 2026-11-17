// Inicio del simulacro (su portada): una sola tarjeta con el modelo del examen (preguntas, duración, puntos, nota de corte), sus
// instrucciones y el botón que pone el reloj en marcha o, si hay uno a medias, continuarlo o descartarlo. Las secciones y los
// simulacros hechos están en la pestaña Simulacro del curso: aquí no se repiten. La portada lleva la muestra de pigmento (es
// el examen), en su esquina libre de abajo; nada flota.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { ExamRun } from '@shared/schema'
import { examBlueprint } from '@engine/study'
import { AnimatedNumber, Button, Card, ConfirmDialog, Icon } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { percentSuffix } from '@renderer/lib/format'
import { StudyFrame, TopCapsule } from '../Chrome'
import type { CourseData } from '../data'
import { useInk } from '../kit'

/** Cuántos ejercicios (y plantillas) tiene el curso para un simulacro. */
export function examExerciseCount(skills: ReadonlyArray<{ exercises: readonly unknown[]; templates?: readonly unknown[] }>): number {
  return skills.reduce((n, s) => n + s.exercises.length + (s.templates?.length ?? 0), 0)
}

export function ExamStart({ data, pending, busy, onStart, onResume, onDiscard, onExit }: { data: CourseData; pending?: ExamRun; busy?: boolean; onStart: () => void; onResume?: () => void; onDiscard?: () => void; onExit: () => void }) {
  const { t } = useTranslation('study')
  const ink = useInk(data.pack)
  const [confirm, setConfirm] = useState<'new' | 'discard' | null>(null)
  const bp = examBlueprint(data.pack)
  // los ejercicios que hay de verdad: sin ninguno, el modelo del examen no se puede montar (A3-P2-8)
  const available = examExerciseCount(data.skills)
  const questions = available ? bp.sections.reduce((a, s) => a + s.count, 0) : 0
  const points = available ? bp.sections.reduce((a, s) => a + s.count * s.pointsEach, 0) : 0
  const answered = pending?.items.filter((i) => i.answer !== undefined && i.answer !== null).length ?? 0
  const left = pending ? Math.max(0, pending.durationMinutes * 60 - pending.items.reduce((a, i) => a + i.seconds, 0)) : 0
  return (
    <StudyFrame capsule={<TopCapsule icon="exam" label={t('exam.title')} onExit={onExit} />} onExit={onExit}>
      <div className="mx-auto w-full max-w-[680px]">
        <Card enterAnim padded="lg" mark={ink} markSize="sm">
          <div className="t-eyebrow">{data.pack.exam?.title ?? t('exam.title')}</div>
          <h1 className="t-display mt-1 text-[36px] leading-[42px]">{t('exam.mockTitle')}</h1>
          <p className="t-body text-text2 mt-2 max-w-[520px]">{t('exam.lead')}</p>
          {!available && !pending && (
            <div role="status" data-testid="exam-no-exercises" className="mt-5 flex items-start gap-2.5 rounded-[14px] bg-sunken p-3.5">
              <Icon name="info" size={16} className="mt-[2px] shrink-0 text-text3" />
              <div>
                <div className="t-headline">{t('exam.noExercises')}</div>
                <div className="t-callout text-text2 mt-0.5">{t('exam.noExercisesBody')}</div>
              </div>
            </div>
          )}
          <div className="mt-6 grid grid-cols-2 gap-4 border-t-[0.5px] border-line-soft pt-5 @lg:grid-cols-4">
            {[
              { v: questions, l: t('exam.questions', { count: questions }) },
              { v: bp.durationMinutes, l: t('exam.minutes'), s: '' },
              { v: Math.round(points), l: t('exam.points') },
              ...(bp.passPercent ? [{ v: Math.round(bp.passPercent * 100), l: t('exam.toPass'), s: percentSuffix() }] : [])
            ].map((x, i) => (
              <div key={i} className="flex flex-col">
                <span className="t-number text-[30px] leading-[34px]"><AnimatedNumber value={x.v} suffix={x.s ?? ''} /></span>
                <span className="t-caption">{x.l}</span>
              </div>
            ))}
          </div>
          {bp.instructions && (
            <div className="mt-5 rounded-[14px] bg-sunken p-3.5 t-callout text-text2">
              <RichText text={bp.instructions} />
            </div>
          )}
          {pending && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex flex-wrap items-center gap-3 rounded-[16px] bg-accent-wash px-4 py-3">
              <Icon name="clock" size={17} className="text-accent-text" />
              <div className="min-w-0 flex-1">
                <div className="t-headline">{t('exam.pendingTitle')}</div>
                <div className="t-callout text-text2">{t('exam.pendingBody', { answered, total: pending.items.length, minutes: Math.ceil(left / 60) })}</div>
              </div>
              <Button variant="ghost" onClick={() => setConfirm('discard')}>{t('exam.discard')}</Button>
            </motion.div>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            {pending ? (
              <>
                <Button variant="primary" size="xl" icon={<Icon name="play" size={16} />} onClick={onResume}>{t('exam.resume')}</Button>
                <Button variant="secondary" size="xl" loading={busy} onClick={() => setConfirm('new')}>{t('exam.startNew')}</Button>
              </>
            ) : (
              <Button variant="primary" size="xl" icon={<Icon name="play" size={16} />} onClick={onStart} loading={busy} disabled={questions === 0}>{t('exam.start')}</Button>
            )}
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === 'discard') onDiscard?.()
          else onStart()
        }}
        title={confirm === 'discard' ? t('exam.discardTitle') : t('exam.newTitle')}
        description={confirm === 'discard' ? t('exam.discardBody') : t('exam.newBody')}
        confirmLabel={confirm === 'discard' ? t('exam.discard') : t('exam.startNew')}
        cancelLabel={t('common.cancel')}
        danger={confirm === 'discard'}
      />
    </StudyFrame>
  )
}

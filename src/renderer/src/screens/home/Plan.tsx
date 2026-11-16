// «El plan de hoy»: los pasos de todos los cursos, ordenados por lo que más sube la nota. Cada paso lleva delante el glifo
// a tinta de lo que toca (repasar, aprender, practicar), no el icono del curso repetido; el nombre del curso solo sale si el
// plan mezcla varios. Los minutos del día ya están en el saludo: aquí no se repiten (ni un «0 de 60 min»).
import { useTranslation } from 'react-i18next'
import { Card, Group, Row, SectionTitle, Icon, InkStrike, type IconName } from '@renderer/design'
import type { HomePlanItem, PlanKind } from '@shared/ipc/home'
import { startPlanItem } from './actions'

const KIND_ICON: Record<PlanKind, IconName> = { cards: 'cards', mistakes: 'mistakes', learn: 'learn', practice: 'practice', exam: 'exam', review: 'repeat' }

/** ¿Mezcla el plan pasos de más de un curso? (entonces cada paso dice de cuál es) */
export function mixesCourses(plan: readonly HomePlanItem[]): boolean {
  return new Set(plan.map((p) => p.courseId)).size > 1
}

export function PlanCard({ plan }: { plan: HomePlanItem[] }) {
  const { t } = useTranslation('home')
  const total = plan.filter((p) => !p.done).reduce((a, p) => a + p.minutes, 0)
  const several = mixesCourses(plan)
  return (
    <Card enterAnim padded="lg" className="h-full">
      <SectionTitle title={t('plan')} detail={total > 0 ? t('planDetail', { minutes: total }) : undefined} />
      {plan.length === 0 ? (
        <p className="t-body text-text2 py-4">{t('planEmpty')}</p>
      ) : (
        <Group plain inset={56} className="mt-2 -mx-4">
          {plan.slice(0, 6).map((p, i) => (
            <Row
              key={p.id}
              index={i}
              onClick={() => startPlanItem(p)}
              className={p.done ? 'rounded-[12px] opacity-55' : 'rounded-[12px]'}
              leading={<Icon name={KIND_ICON[p.kind]} size={20} className="text-text" />}
              title={
                p.done ? (
                  // hecho: tachado a mano (se dibuja la primera vez que se ve hecho)
                  <InkStrike seed={p.id} className="min-w-0">
                    <span className="block truncate">{p.title}</span>
                  </InkStrike>
                ) : (
                  p.title
                )
              }
              subtitle={several ? `${p.courseTitle} · ${p.detail}` : p.detail}
              trailing={`${p.minutes} min`}
              chevron
            />
          ))}
        </Group>
      )}
    </Card>
  )
}

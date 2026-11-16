// Inicio: un tablero de cinco bloques que llena la ventana. Arriba, el saludo (con la racha y la meta de hoy) y el examen
// más cercano, que flota; en medio, el plan de hoy y la semana, que también flota; abajo, las portadas de los cursos.
// Un solo botón ladrillo («Empezar el plan»). Con solo los cursos de ejemplo, el saludo invita a crear el tuyo y el examen
// de ejemplo no sale (no es tuyo).
import { useTranslation } from 'react-i18next'
import { Stagger, cx } from '@renderer/design'
import { useRpc } from '@renderer/lib/useRpc'
import { showsAsSample } from '@renderer/lib/sample'
import { useScreenTitle } from '@renderer/app/title'
import { Hero, type HeroMode } from './Hero'
import { ExamCard, ownExams } from './Exams'
import { PlanCard } from './Plan'
import { WeekCard } from './Week'
import { CourseCards } from './Courses'
import { mockHome } from './mock'
import type { HomeSummary } from '@shared/ipc/home'

export default function Home() {
  const { t } = useTranslation('home')
  useScreenTitle(t('title'))
  const { data, error } = useRpc('home.summary', undefined, { events: ['courses.changed', 'settings.changed', 'calendar.changed'] as never })
  const summary: HomeSummary | undefined = data ?? (error && (import.meta.env.DEV || new URLSearchParams(location.search).has('demo')) ? mockHome() : undefined)
  if (!summary) return <HomeSkeleton />
  const hasCourses = summary.courses.length > 0
  const mode: HeroMode = !hasCourses ? 'empty' : summary.courses.every((c) => showsAsSample(c.id)) ? 'firstRun' : 'study'
  const exams = mode === 'study' ? ownExams(summary.exams, showsAsSample) : []
  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 pt-1 pb-10">
      <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
        <div className={cx('col-span-12', exams.length > 0 && '@5xl:col-span-8')}>
          <Hero data={summary} mode={mode} />
        </div>
        {exams.length > 0 && (
          <div className="col-span-12 @5xl:col-span-4">
            <ExamCard exams={exams} />
          </div>
        )}
        {hasCourses && (
          <>
            <div className="col-span-12 @5xl:col-span-7">
              <PlanCard plan={summary.plan} />
            </div>
            <div className="col-span-12 @5xl:col-span-5">
              <WeekCard events={summary.upcoming} courses={summary.courses} />
            </div>
          </>
        )}
        <div className="col-span-12 mt-2">
          <CourseCards courses={summary.courses} />
        </div>
      </Stagger>
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="flex-1 grid grid-cols-12 gap-4 px-6 pt-1">
      <div className="col-span-8 h-[280px] skeleton rounded-[22px]" />
      <div className="col-span-4 h-[280px] skeleton rounded-[22px]" />
      <div className="col-span-7 h-[260px] skeleton rounded-[22px]" />
      <div className="col-span-5 h-[260px] skeleton rounded-[22px]" />
    </div>
  )
}

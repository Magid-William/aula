// Pantalla de un curso: al entrar, una cortina de píxeles con el tono del curso se abre y su icono se enciende píxel
// a píxel. Cinco pestañas en cápsula: Resumen, Aprender, Repasar, Simulacro y Materiales. Los ids de antes (Práctica,
// Tarjetas, Errores y Referencia) siguen funcionando: abren su vista y llevan hasta su sección.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, PixelCurtain, SegmentedTabs, Spinner, toneForHue, useTheme, Button } from '@renderer/design'
import { useRoute, navigate, canonicalTab, COURSE_VIEWS, type CourseTab, type CourseView } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { useCoursePack, useOverview } from './data'
import { CourseHeader } from './Header'
import { Overview } from './Overview'
import { LearnTab } from './Learn'
import { ReviewTab } from './Review'
import { ExamTab } from './Exam'
import { MaterialsTab } from './Materials'
import { CourseBuildingBanner, CourseCreationFailed, CoursePartialBanner } from './Failed'
import { courseBuilding, courseRunIssue, coursePartial, creationPhase, extendingTopic, studyableCount } from './failure'
import { topicCounts } from '@engine/study/topics'
import { useCourseRun } from './runs'
import { useScrollToSection } from './sections'

const curtainSeen = new Set<string>()

export default function CourseScreen() {
  const { t } = useTranslation(['course', 'common'])
  const route = useRoute()
  const id = route.name === 'course' ? route.id : ''
  const asked: CourseTab | undefined = route.name === 'course' ? route.tab : undefined
  // un id viejo abre su vista y lleva hasta su sección («cards» → Repasar, en «Tarjetas»)
  const { view, focus } = canonicalTab(asked)
  const { pack, loading, missing } = useCoursePack(id)
  const ov = useOverview(pack)
  const lastRun = useCourseRun(id)
  const { dark } = useTheme()
  // la cortina de píxeles solo la primera vez que se abre cada curso en la sesión (no al volver de estudiar)
  const [curtain, setCurtain] = useState(() => !curtainSeen.has(id))
  useEffect(() => {
    if (id) curtainSeen.add(id)
  }, [id])
  // el título ya sale en la cabecera: la barra de arriba solo lo pone en el teléfono
  useScreenTitle(pack?.title ?? '', null, [pack?.title], { compactOnly: true })
  useScrollToSection(focus, `${id}:${view}`)

  // casi nunca se ve: la navegación espera a tener el curso (con tope) y lo guarda para la próxima visita
  if (loading)
    return (
      <div className="screen-fallback grid flex-1 place-items-center text-text3">
        <Spinner size={18} />
      </div>
    )
  if (missing || !pack) return <EmptyState title={t('notFound')} body={t('notFoundBody')} action={<Button onClick={() => navigate({ name: 'home' })}>{t('common:nav.home')}</Button>} />

  const tone = toneForHue(pack.hue)
  const setTab = (next: CourseView) => navigate({ name: 'course', id: pack.id, tab: next }, { replace: true })
  // se cuentan los temas escritos, no los planificados (el plan llega antes que el contenido): mientras se escribe, los listos;
  // si la creación se paró, todo lo escrito (también los borradores que quedaron sin auditar)
  const counts = topicCounts(pack.skills)
  const ready = studyableCount(lastRun, counts)
  const total = pack.skills.length
  // la creación falló o se detuvo sin nada escrito: qué pasó y qué hacer, no un resumen vacío
  const issue = courseRunIssue(lastRun, counts)
  // la creación se cortó con temas ya escritos: parece terminado, pero no lo está (J2-2)
  const partial = coursePartial(lastRun, counts)
  // aún se está creando, con temas ya listos: se puede estudiar, pero se dice que no está terminado
  const building = courseBuilding(lastRun, counts)
  const phase = creationPhase(lastRun, counts)
  // el tema que escribe ahora una ampliación («Escribir este tema ahora»): no se abre a medias
  const writing = extendingTopic(lastRun)
  if (issue && lastRun)
    return (
      <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-24">
        <CourseCreationFailed pack={pack} runId={lastRun.id} issue={issue} />
      </div>
    )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-24">
        {/* la cortina de píxeles solo sobre la cabecera y breve (antes tapaba toda la pantalla ~1 s: J1-7) */}
        <div className="relative">
          <CourseHeader pack={pack} view={view} />
          {curtain && (
            <div className="absolute -inset-x-2 -inset-y-1 z-30 pointer-events-none overflow-hidden rounded-[18px]" style={{ ['--curtain' as string]: `color-mix(in oklab, ${dark ? tone.fillDark : tone.fillLight} ${dark ? 40 : 26}%, var(--paper))` }}>
              <PixelCurtain color={tone.top} duration={240} onDone={() => setCurtain(false)} />
            </div>
          )}
        </div>
        {partial && lastRun && <CoursePartialBanner run={lastRun} partial={partial} ready={ready} total={total} />}
        {building && lastRun && <CourseBuildingBanner run={lastRun} ready={ready} total={total} />}
        {/* en ventanas estrechas las pestañas se desplazan en horizontal en vez de partirse; centradas solo si caben («safe»:
            si no, empiezan por la izquierda y «Overview» no queda cortado fuera de alcance: A4-P2-17) */}
        <div className="mt-5 mb-5 flex [justify-content:safe_center] overflow-x-auto no-scrollbar -mx-6 px-6">
          <SegmentedTabs className="shrink-0" value={view} onChange={setTab} items={COURSE_VIEWS.map((x) => ({ id: x, label: t(`tabs.${x}`) }))} />
        </div>
        {/* cambiar de pestaña: la nueva entra al momento (sin esperar a que se vaya la anterior ni pasar por el vacío) */}
        <div key={view} className="tab-enter">
          {view === 'overview' && <Overview pack={pack} ov={ov} phase={phase} writing={writing} />}
          {view === 'learn' && <LearnTab pack={pack} ov={ov} phase={phase} writing={writing} />}
          {view === 'review' && <ReviewTab pack={pack} />}
          {view === 'exam' && <ExamTab pack={pack} />}
          {view === 'materials' && <MaterialsTab pack={pack} />}
        </div>
      </div>
    </div>
  )
}

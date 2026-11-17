// Resumen del curso, en burbujas: la nota estimada (una cifra serif que cuenta, una frase y la barra con su intervalo rotulado)
// y lo que toca ahora a la izquierda; el examen (la única tarjeta con pigmento y la que flota) a la derecha, a la misma altura;
// debajo, a todo lo ancho, el mapa del curso por unidades, con el dominio de cada tema en una barra fina con la tinta del curso
// y «Sigue aquí» en el que toca. Lo que aún se escribe (o espera a «Reanudar») no se abre.
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { AnimatedNumber, Button, Card, Floating, Group, Icon, InkSpot, Row, SectionTitle, Stagger, toneForHue, useTheme, type IconName, cx } from '@renderer/design'
import { COURSE_EDIT_EVENT } from './Actions'
import type { Pack } from '@shared/schema/pack'
import type { CourseOverview } from '@shared/ipc/course-view'
import type { PlanKind } from '@shared/ipc/home'
import { capitalize, fmtDate, fmtPercent, fmtTime } from '@renderer/lib/format'
import { examStatus } from './examStatus'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'
import { startPlanItem } from '../home/actions'
import { topicAvailability, topicOpens, type CreationPhase } from '@engine/study/topics'
import { MasteryBar } from './MasteryBar'
import { MASTERED, nextTopicId, shownMastery } from './topics'

const KIND_ICON: Record<PlanKind, IconName> = { cards: 'cards', mistakes: 'mistakes', learn: 'learn', practice: 'practice', exam: 'exam', review: 'repeat' }

/** Lo que hace falta para saber qué temas se abren: la fase de la creación y el tema que escribe ahora una ampliación. */
interface TopicGate {
  phase?: CreationPhase
  writing?: string
}

/** ¿Se abre este tema en Aprender? Y, si no, por qué (para el texto de ayuda). */
export function topicGate(s: Pack['skills'][number], g: TopicGate): { opens: boolean; state: ReturnType<typeof topicAvailability> } {
  const state = topicAvailability(s, g.phase ?? 'none', s.id === g.writing)
  return { opens: topicOpens(state), state }
}

/** El tema por el que seguir en este curso (el del plan de hoy o el primero sin dominar). */
export function courseNextTopic(pack: Pack, ov: CourseOverview | null, gate: TopicGate): string | undefined {
  if (!ov) return undefined
  const order = pack.units.length ? pack.units.flatMap((u) => u.skillIDs) : pack.skills.map((s) => s.id)
  const refs = new Map(pack.skills.map((s) => [s.id, s]))
  const planned = ov.plan.find((p) => p.kind === 'learn' && p.skillId)?.skillId
  return nextTopicId(order, new Map(ov.skills.map((s) => [s.id, s])), (id) => {
    const ref = refs.get(id)
    return !!ref && topicGate(ref, gate).opens
  }, planned)
}

export function Overview({ pack, ov, phase, writing }: { pack: Pack; ov: CourseOverview | null } & TopicGate) {
  const { t } = useTranslation(['course', 'common'])
  const { dark } = useTheme()
  const tone = toneForHue(pack.hue)
  const ink = dark ? tone.inkDark : tone.inkLight
  const gate = { phase, writing }
  // lo que toca ahora, sin los temas que aún se están escribiendo (como Hoy y «Estudiar ahora»: no lleva a un tema a medias)
  const refs = new Map(pack.skills.map((s) => [s.id, s]))
  const plan = (ov?.plan ?? []).filter((p) => {
    const ref = p.skillId ? refs.get(p.skillId) : undefined
    return !ref || topicGate(ref, gate).opens
  })
  const planMinutes = plan.reduce((a, p) => a + p.minutes, 0)
  // en ventana ancha, dos columnas que acaban a la vez (nota y «Ahora toca» | el examen, que se estira) y el mapa debajo, a todo lo
  // ancho; estrecha, una sola en este orden: nota, examen, ahora toca y mapa
  return (
    <Stagger className="flex flex-col gap-4 @5xl:grid @5xl:grid-cols-12" gap={0.05}>
      <div className="contents @5xl:col-span-7 @5xl:flex @5xl:flex-col @5xl:gap-4">
        <div className="order-1">
          <GradeCard ov={ov} ink={ink} />
        </div>
        <div className="order-3">
          <Card enterAnim padded="lg">
            <SectionTitle title={t('now')} detail={plan.length ? t('nowDetail', { minutes: planMinutes }) : undefined} />
            {ov && !plan.length ? (
              <p className="t-callout text-text2 mt-3">{t('nowEmpty')}</p>
            ) : (
              <Group plain inset={60} className="mt-2 -mx-4 [&>div]:rounded-[12px]">
                {plan.map((p, i) => (
                  <Row key={p.id} index={i} onClick={() => startPlanItem(p)} leading={<Icon name={KIND_ICON[p.kind]} size={18} />} title={p.title} subtitle={p.detail} trailing={t('minutes', { count: p.minutes })} chevron />
                ))}
              </Group>
            )}
          </Card>
        </div>
      </div>
      <div className="order-2 @5xl:col-span-5 @5xl:flex @5xl:flex-col">
        <ExamCard pack={pack} ink={ink} />
      </div>
      <div className="order-4 @5xl:col-span-12">
        <CourseMap pack={pack} ov={ov} ink={ink} gate={gate} />
      </div>
    </Stagger>
  )
}

/** La nota estimada: la cifra serif que cuenta y una frase con el intervalo y lo que se ha visto del temario. */
function GradeCard({ ov, ink }: { ov: CourseOverview | null; ink: string }) {
  const { t } = useTranslation('course')
  // sin nada practicado aún, «0 %» no dice nada: se explica cuándo aparecerá la nota
  const fresh = !!ov && ov.attempts === 0 && ov.label === 'notStarted'
  const seenAll = !!ov && ov.coverage >= 0.995
  return (
    <Card enterAnim padded="lg">
      <div className="t-ui font-semibold text-text2">{t('readiness')}</div>
      {fresh || !ov ? (
        <>
          <div className="font-serif text-[56px] leading-[60px] tracking-[-0.03em] text-text3 mt-1">—</div>
          {ov && <p className="t-callout text-text2 mt-2 max-w-[460px]">{t('freshReadiness')}</p>}
        </>
      ) : (
        <>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="t-number text-[56px] leading-[60px] tracking-[-0.03em]">
              <AnimatedNumber value={Math.round(ov.readiness * 100)} />
              <span className="text-[30px] text-text2"> %</span>
            </span>
            <span className="t-callout text-text2">
              {seenAll
                ? t('overview.gradeLineAll', { low: fmtPercent(ov.readinessLow), high: fmtPercent(ov.readinessHigh) })
                : t('overview.gradeLine', { low: fmtPercent(ov.readinessLow), high: fmtPercent(ov.readinessHigh), seen: fmtPercent(ov.coverage) })}
            </span>
          </div>
          <GradeBar value={ov.readiness} low={ov.readinessLow} high={ov.readinessHigh} ink={ink} />
        </>
      )}
    </Card>
  )
}

/** La barra de la nota: hasta la estimación, la tinta del curso; el intervalo probable (de la nota baja a la alta), una banda más
 *  clara alrededor, con su rótulo debajo («68–80 %»): las dos tintas se entienden sin leyenda. */
function GradeBar({ value, low, high, ink }: { value: number; low: number; high: number; ink: string }) {
  const { t } = useTranslation('course')
  const clamp = (x: number): number => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0))
  const [a, b] = [clamp(Math.min(low, high)), clamp(Math.max(low, high))]
  const range = t('overview.rangeTip', { low: fmtPercent(a), high: fmtPercent(b) })
  // el rótulo, centrado bajo la banda sin salirse de la tarjeta
  const mid = Math.min(0.9, Math.max(0.1, (a + b) / 2))
  return (
    <div className="mt-4">
      <div className="relative h-[11px]" role="img" aria-label={range}>
        <div className="absolute inset-x-0 top-[3px] h-[5px] rounded-full bg-fill2" />
        <motion.div className="absolute top-0 h-[11px] rounded-full" title={range} style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%`, background: `color-mix(in oklab, ${ink} 24%, transparent)` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.6 }} />
        <motion.div className="absolute left-0 top-[3px] h-[5px] rounded-full" style={{ background: ink }} initial={{ width: 0 }} animate={{ width: `${clamp(value) * 100}%` }} transition={{ duration: 1, ease: [0.2, 0.7, 0.2, 1] }} />
      </div>
      <div className="relative mt-1 h-4" aria-hidden>
        <span className="absolute -translate-x-1/2 whitespace-nowrap t-caption tabular text-text2" style={{ left: `${mid * 100}%` }}>
          {fmtPercent(a)}–{fmtPercent(b)}
        </span>
      </div>
    </div>
  )
}

function ExamCard({ pack, ink }: { pack: Pack; ink: string }) {
  const { t } = useTranslation(['course', 'common'])
  const exam = pack.exam
  const status = examStatus(exam?.date)
  // sin fecha no hay examen que señalar: sin pigmento y quieta, con lo que falta para tenerlo
  if (!status)
    return (
      <Card enterAnim padded="lg">
        <SectionTitle title={t('examCard')} />
        <div className="flex items-center gap-4">
          <InkSpot name="calendar" className="h-[64px] w-[78px] shrink-0" />
          <div className="min-w-0">
            <p className="t-callout text-text2">{pack.selfPaced || !exam ? t('selfPaced') : t('noExam')}</p>
            <Button size="sm" variant="secondary" className="mt-2.5" icon={<Icon name="calendar" size={14} />} onClick={() => window.dispatchEvent(new Event(COURSE_EDIT_EVENT))}>
              {t('addExamDate')}
            </Button>
          </div>
        </div>
        <ExamFacts pack={pack} />
      </Card>
    )
  const past = status.phase === 'past'
  // un examen que ya pasó no flota ni pide atención: se queda quieto y propone seguir repasando o poner el siguiente
  const Wrap = past ? StillWrap : FloatWrap
  return (
    <Wrap>
      {/* el pigmento (el examen) va en la esquina de abajo, que se deja libre: nunca debajo de texto */}
      <Card enterAnim padded="lg" elevation={past ? 1 : 2} mark={past ? undefined : ink} markSize="sm" className="h-full">
        <SectionTitle title={t('examCard')} />
        {status.phase === 'upcoming' ? (
          <div className="flex items-baseline gap-2">
            <span className="t-number text-[52px] leading-[54px] tracking-[-0.02em]" style={{ color: status.days <= 3 ? 'var(--accent-text)' : ink }}>
              <AnimatedNumber value={status.days} />
            </span>
            <span className="t-callout text-text2">
              {t('daysUntil', { count: status.days })}
            </span>
          </div>
        ) : status.phase === 'today' ? (
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[44px] leading-[52px] tracking-[-0.02em] text-accent-text">{t('common:time.today')}</span>
            {exam?.date && <span className="t-callout text-text2">{t('examTodayAt', { time: fmtTime(exam.date) })}</span>}
          </div>
        ) : (
          <div>
            <div className="font-serif text-[26px] leading-[32px] tracking-[-0.01em] text-text">
              {status.daysAgo === 0 ? t('examWasToday') : t('examWasAgo', { count: status.daysAgo })}
            </div>
            <p className="t-callout text-text2 mt-1.5 max-w-[440px]">{t('examPastBody')}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button size="sm" variant="secondary" icon={<Icon name="cards" size={14} />} onClick={() => navigate({ name: 'course', id: pack.id, tab: 'review' })}>
                {t('keepReviewing')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Icon name="calendar" size={14} />} onClick={() => window.dispatchEvent(new Event(COURSE_EDIT_EVENT))}>
                {t('addNextExam')}
              </Button>
            </div>
          </div>
        )}
        <ExamFacts pack={pack} />
        {!past && <div aria-hidden className="h-12" />}
      </Card>
    </Wrap>
  )
}

/** Los datos del examen (título, fecha, duración, puntos, lo permitido) y lo que dijo el profe. */
function ExamFacts({ pack }: { pack: Pack }) {
  const { t } = useTranslation('course')
  const exam = pack.exam
  if (!exam) return null
  const rows: Array<[string, ReactNode]> = []
  if (exam.title) rows.push([t('examCard'), exam.title])
  if (exam.date) rows.push([t('date'), `${capitalize(fmtDate(exam.date, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${fmtTime(exam.date)}`])
  if (exam.durationMinutes) rows.push([t('duration'), `${exam.durationMinutes} min`])
  if (exam.totalPoints) rows.push([t('points'), <span className="tabular">{exam.totalPoints}</span>])
  if (exam.aids) rows.push([t('aids'), exam.aids])
  return (
    <>
      {rows.length > 0 && (
        <div className="mt-4 grid grid-cols-[110px_1fr] gap-y-2 t-callout">
          {rows.map(([label, value], i) => (
            <div key={i} className="contents">
              <span className="text-text3">{label}</span>
              <span className="text-text">{value}</span>
            </div>
          ))}
        </div>
      )}
      {exam.notes && (
        <div className="mt-4 rounded-[14px] bg-sunken p-3.5 t-callout text-text2">
          <div className="t-caption mb-1">{t('notes')}</div>
          <RichText text={exam.notes} />
        </div>
      )}
    </>
  )
}

// en ventana ancha, la tarjeta del examen se estira hasta donde acaba la columna de al lado
function FloatWrap({ children }: { children: ReactNode }) {
  return <Floating amplitude={3} duration={9} className="@5xl:flex-1">{children}</Floating>
}

function StillWrap({ children }: { children: ReactNode }) {
  return <div className="@5xl:flex-1">{children}</div>
}

/** El mapa del curso: las unidades con sus temas, el dominio de cada uno y «Sigue aquí» en el que toca. */
function CourseMap({ pack, ov, ink, gate }: { pack: Pack; ov: CourseOverview | null; ink: string; gate: TopicGate }) {
  const { t } = useTranslation('course')
  const mastery = new Map((ov?.skills ?? []).map((s) => [s.id, s]))
  const next = courseNextTopic(pack, ov, gate)
  return (
    <Card enterAnim padded="lg">
      <SectionTitle title={t('map')} />
      {/* a todo lo ancho, las unidades una al lado de otra (tantas columnas como quepan de unos 280 px) */}
      <div className="grid gap-x-10 gap-y-5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {pack.units.map((u, ui) => (
          <div key={u.id}>
            <div className="t-ui font-semibold text-text2 mb-1">
              {ui + 1}. {u.title}
            </div>
            <div className="flex flex-col">
              {u.skillIDs.map((sid, i) => {
                const s = pack.skills.find((x) => x.id === sid)
                if (!s) return null
                const m = shownMastery(mastery.get(sid))
                const { opens, state } = topicGate(s, gate)
                const here = sid === next
                return (
                  <motion.button
                    key={sid}
                    type="button"
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 + (ui * 3 + i) * 0.03 }}
                    disabled={!opens}
                    title={opens ? undefined : t(`learn.${state}`)}
                    onClick={opens ? () => navigate({ name: 'study', id: pack.id, mode: 'learn', skill: sid }) : undefined}
                    className={cx('-mx-2 flex items-center gap-3 rounded-[10px] px-2 py-1.5 text-left', opens ? 'hover:bg-fill1' : 'cursor-default text-text3')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block t-callout truncate">
                        <RichText text={s.title} inline />
                      </span>
                      {here && <span className="block t-footnote font-medium text-accent-text">{t('learn.continueHere')}</span>}
                    </span>
                    {m !== undefined && m >= MASTERED && <Icon name="check" size={13} className="text-text2 shrink-0" />}
                    <MasteryBar value={m} ink={ink} width={56} />
                  </motion.button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

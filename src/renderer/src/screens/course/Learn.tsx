// Aprender, como el índice de un libro: una tarjeta por unidad con sus temas en filas (el título, su resumen en una frase, el
// dominio en una barra fina con la tinta del curso y los minutos), «Sigue aquí» en el que toca y, al final, el apéndice con
// las fórmulas y el glosario. Mientras Aula crea el curso (o escribe un tema con «Escribir este tema ahora»), los temas que
// aún no están listos dicen «Escribiéndose…» o «En cola» y no se abren (antes se abrían vacíos o a medias).
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, Chip, cx, Icon, Spinner, Stagger, toneForHue, useTheme } from '@renderer/design'
import type { Pack } from '@shared/schema/pack'
import type { CourseOverview } from '@shared/ipc/course-view'
import { topicAvailability, topicOpens, type CreationPhase, type TopicAvailability } from '@engine/study/topics'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'
import { MasteryBar } from './MasteryBar'
import { courseNextTopic } from './Overview'
import { ReferenceAppendix } from './Reference'
import { RULED_ROW, SECTION_ATTR } from './sections'
import { firstSentence, shownMastery } from './topics'

/** La marca de un tema que no está listo para abrir como lección. */
function TopicState({ state }: { state: Exclude<TopicAvailability, 'ready'> }) {
  const { t } = useTranslation('course')
  const icon = state === 'writing' ? <Spinner size={11} /> : <Icon name={state === 'queued' ? 'clock' : 'edit'} size={12} />
  return <Chip icon={icon}>{t(`learn.${state}`)}</Chip>
}

/** `writing`: el tema que escribe ahora una ampliación en marcha. */
export function LearnTab({ pack, ov, phase = 'none', writing }: { pack: Pack; ov: CourseOverview | null; phase?: CreationPhase; writing?: string }) {
  const { t } = useTranslation('course')
  const { dark } = useTheme()
  const tone = toneForHue(pack.hue)
  const ink = dark ? tone.inkDark : tone.inkLight
  const mastery = new Map((ov?.skills ?? []).map((s) => [s.id, s]))
  const next = courseNextTopic(pack, ov, { phase, writing })
  return (
    <Stagger className="flex flex-col gap-4" gap={0.05}>
      {pack.units.map((u, ui) => (
        <Card key={u.id} enterAnim padded="lg">
          <h2 className="t-title2 text-text">
            {ui + 1}. {u.title}
          </h2>
          {u.summary && <p className="t-callout text-text2 mt-0.5">{u.summary}</p>}
          <div className="mt-3 -mx-3 flex flex-col">
            {u.skillIDs.map((sid, i) => {
              const s = pack.skills.find((x) => x.id === sid)
              if (!s) return null
              const state = topicAvailability(s, phase, sid === writing)
              // sin lección y sin creación pendiente se abre igual: allí se puede pedir que Aula lo escriba ahora
              const opens = topicOpens(state)
              const open = (): void => navigate({ name: 'study', id: pack.id, mode: 'learn', skill: sid })
              const onKey = (e: KeyboardEvent): void => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                e.preventDefault()
                open()
              }
              const summary = firstSentence(s.summary)
              return (
                <motion.div
                  key={sid}
                  role={opens ? 'button' : undefined}
                  tabIndex={opens ? 0 : undefined}
                  onClick={opens ? open : undefined}
                  onKeyDown={opens ? onKey : undefined}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i, 8) * 0.03, ease: [0.2, 0.7, 0.2, 1] }}
                  data-topic-state={state}
                  className={cx(RULED_ROW, 'group/topic flex items-center gap-5 rounded-[14px] px-3 py-3.5 outline-none transition-colors @max-2xl:gap-3', opens ? 'cursor-default hover:bg-fill1 focus-visible:bg-fill1' : 'text-text3')}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2.5">
                      <span className={cx('t-callout font-medium', opens ? 'text-text' : 'text-text2')}>
                        <RichText text={s.title} inline />
                      </span>
                      {sid === next && <span className="t-footnote font-medium text-accent-text">{t('learn.continueHere')}</span>}
                    </div>
                    {summary && (
                      <div className="t-ui text-text2 mt-0.5 [text-wrap:pretty]">
                        <RichText text={summary} inline />
                      </div>
                    )}
                  </div>
                  {state !== 'ready' ? (
                    <TopicState state={state} />
                  ) : (
                    <>
                      {/* la barra, solo si hay sitio: va envuelta porque MasteryBar ya trae su `inline-flex` (cx no resuelve
                          clases que chocan y «hidden» perdía: la barra se veía siempre y estrujaba el tema en un teléfono) */}
                      <span className="hidden @2xl:inline-flex">
                        <MasteryBar value={shownMastery(mastery.get(sid))} ink={ink} />
                      </span>
                      <span className="w-[52px] shrink-0 text-right t-footnote tabular text-text3 @max-2xl:w-auto">{t('minutes', { count: s.minutes })}</span>
                    </>
                  )}
                  {opens && <Icon name="chevron-right" size={14} className="shrink-0 text-text3 transition-transform group-hover/topic:translate-x-0.5" />}
                </motion.div>
              )
            })}
          </div>
        </Card>
      ))}
      <div {...{ [SECTION_ATTR]: 'reference' }} className="scroll-mt-3">
        <ReferenceAppendix pack={pack} />
      </div>
    </Stagger>
  )
}

// Repasar: una sola cola para lo que toca hoy. Arriba, una frase con lo que suma (tarjetas, errores y práctica, en minutos) y
// un solo botón, «Empezar el repaso», que arranca esos pasos del plan de hoy uno tras otro. Debajo, las tres partes: los mazos
// de tarjetas por tema (con lo firme que está cada uno y todas las tarjetas para hojear), el cuaderno de errores (con cuándo
// vuelve cada uno) y la práctica por tema (su dominio y «9 de 10 bien»).
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Flashcard, Pack } from '@shared/schema'
import { clozeText, dailyPlan, dueCards, mistakesNotebook, skillMastery, type MistakeView } from '@engine/study'
import { topicCounts } from '@engine/study/topics'
import { Button, Card, cx, EmptyState, Icon, MarginNote, SectionTitle, SegmentedTabs, Spinner, Stagger, TextField, toast } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { navigate } from '@renderer/app/router'
import { correctAnswer, gradeLang } from '@renderer/exercises'
import i18n from '@renderer/i18n'
import { updateProgress, useCourseData, type CourseData } from '@renderer/screens/study/data'
import { useInk } from '@renderer/screens/study/kit'
import { runStep, startPlan } from '@renderer/screens/study/plan/session'
import { cardState, promptText, searchKey } from '@renderer/screens/study/tabs'
import { planAvailability } from './failure'
import { useCourseRun } from './runs'
import { MasteryBar } from './MasteryBar'
import { RULED_ROW, SECTION_ATTR } from './sections'
import { deckStrength, glueLastWord, reviewCounts, reviewPlanItems, rightOfLast } from './reviewQueue'

const section = (id: string): Record<string, string> => ({ [SECTION_ATTR]: id })

export function ReviewTab({ pack }: { pack: Pack }) {
  const { t } = useTranslation(['course', 'study'])
  const { data, status } = useCourseData(pack.id)
  const ink = useInk(pack)
  const now = useMemo(() => new Date(), [])
  // mientras Aula escribe el curso, el plan solo propone los temas ya listos (como «Estudiar ahora»)
  const isAvailable = planAvailability(useCourseRun(pack.id), topicCounts(pack.skills))
  const today = useMemo(() => {
    if (!data) return null
    try {
      const items = reviewPlanItems(dailyPlan(data.pack, data.skills, data.progress, data.progress.settings.dailyMinutes || 45, now, gradeLang(i18n.language), isAvailable))
      const notebook = mistakesNotebook(data.progress, data.skills, now)
      const queue = dueCards(data.pack, data.skills, data.progress, { now })
      // las nuevas no «tocan» (no son repaso), pero «Repasar tarjetas» las ofrece: la frase lo dice cuando no hay nada más
      const fresh = queue.filter((c) => c.isNew).length
      return { items, notebook, fresh, counts: reviewCounts(items, { cards: queue.length, mistakes: notebook.filter((m) => m.due).length }) }
    } catch {
      return { items: [], notebook: [], fresh: 0, counts: { minutes: 0 } }
    }
    // el plan se calcula con el progreso a la vista (al resolver un error, se rehace)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, now])
  if (!data || !today) return status === 'loading' ? <div className="grid place-items-center py-16 text-text3"><Spinner size={18} /></div> : <EmptyState title={t('study:common.loadError')} />

  const { counts } = today
  const parts = [
    counts.cards ? t('review.cards', { count: counts.cards }) : null,
    counts.mistakes ? t('review.mistakes', { count: counts.mistakes }) : null,
    counts.practice ? t('review.practice', { count: counts.practice }) : null
  ].filter((x): x is string => !!x)
  const due = parts.length > 0 && today.items.length > 0
  const headline = due
    ? t('review.today', { list: new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(parts), minutes: counts.minutes })
    : today.fresh > 0 ? t('review.nothingNew', { count: today.fresh }) : t('review.nothing')
  const start = (): void => {
    // los pasos de repaso del plan de hoy, uno tras otro (sin cambiar el motor): al terminar cada uno se ofrece el siguiente.
    // Es su propia sesión: no pisa el plan de «Estudiar ahora», y al salir o terminar se vuelve aquí
    startPlan(pack.id, today.items, { scope: 'review' })
    runStep(pack.id, 0, { scope: 'review' })
  }

  return (
    <Stagger className="flex flex-col gap-4" gap={0.05}>
      <Card enterAnim padded="lg" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <p className="t-title2 text-text max-w-[760px] [text-wrap:pretty]">{headline}</p>
        {due && (
          <Button variant="primary" size="lg" icon={<Icon name="repeat" size={16} />} onClick={start}>
            {t('review.start')}
          </Button>
        )}
      </Card>
      {/* en ventana ancha: los mazos y la práctica a la izquierda (filas por tema) y el cuaderno de errores a la derecha;
          estrecha, una columna en el orden de la cola: tarjetas, errores y práctica */}
      <div className="flex flex-col gap-4 @5xl:grid @5xl:grid-cols-12 @5xl:items-start">
        <div className="contents @5xl:col-span-7 @5xl:flex @5xl:flex-col @5xl:gap-4">
          <div className="order-1 scroll-mt-3" {...section('cards')}>
            <CardsSection data={data} ink={ink} now={now} />
          </div>
          <div className="order-3 scroll-mt-3" {...section('practice')}>
            <PracticeSection data={data} ink={ink} now={now} />
          </div>
        </div>
        <div className="order-2 scroll-mt-3 @5xl:col-span-5" {...section('mistakes')}>
          <MistakesSection data={data} list={today.notebook} />
        </div>
      </div>
    </Stagger>
  )
}

/** Una fila que se abre con un clic, Intro o Espacio (como `Row`), con su filete arriba. */
function RowButton({ onOpen, children, className }: { onOpen?: () => void; children: ReactNode; className?: string }) {
  const onKey = (e: KeyboardEvent): void => {
    if (!onOpen || e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    onOpen()
  }
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onKey}
      className={cx(RULED_ROW, 'group/row flex items-center gap-4 rounded-[14px] px-3 py-3 outline-none transition-colors', onOpen && 'hover:bg-fill1 focus-visible:bg-fill1', className)}
    >
      {children}
    </div>
  )
}

// MARK: Tarjetas

function CardsSection({ data, ink, now }: { data: CourseData; ink: string; now: Date }) {
  const { t } = useTranslation(['course', 'study'])
  const [open, setOpen] = useState(false)
  const all = data.skills.flatMap((s) => s.cards.map((c) => ({ card: c, skill: s })))
  const due = useMemo(() => {
    try {
      return dueCards(data.pack, data.skills, data.progress, { now }).length
    } catch {
      return 0
    }
  }, [data, now])
  const study = (skill?: string): void => navigate({ name: 'study', id: data.pack.id, mode: 'cards', skill })
  return (
    <Card enterAnim padded="lg">
      <SectionTitle
        title={t('review.cardsTitle')}
        detail={all.length ? t('review.decksDetail') : undefined}
        action={all.length > 0 && <Button size="sm" variant="secondary" icon={<Icon name="cards" size={14} />} disabled={!due} onClick={() => study()}>{t('review.reviewCards')}</Button>}
      />
      {all.length === 0 ? (
        <p className="t-callout text-text2">{t('study:tab.cards.emptyBody')}</p>
      ) : (
        <>
          <div className="-mx-3 flex flex-col">
            {data.skills.filter((s) => s.cards.length).map((s) => {
              const progress = s.cards.map((c) => data.progress.cards[c.id])
              const seen = progress.filter((p) => (p?.reps ?? 0) > 0).length
              const dueHere = s.cards.filter((c) => {
                const st = cardState(data.progress.cards[c.id], now)
                return st.state !== 'new' && st.inDays === 0
              }).length
              const fresh = s.cards.length - seen
              const facts = [t('study:tab.cards.cards', { count: s.cards.length }), dueHere ? t('study:tab.cards.dueN', { count: dueHere }) : null, fresh ? t('study:tab.cards.newN', { count: fresh }) : null].filter(Boolean).join(' · ')
              return (
                <RowButton key={s.id} onOpen={() => study(s.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block t-callout font-medium [text-wrap:pretty]"><RichText text={glueLastWord(s.title)} inline /></span>
                    <span className="block t-footnote text-text2 mt-0.5">{facts}</span>
                  </span>
                  <MasteryBar value={seen ? deckStrength(progress, now) : undefined} ink={ink} width={56} />
                  <Icon name="chevron-right" size={14} className="shrink-0 text-text3 transition-transform group-hover/row:translate-x-0.5" />
                </RowButton>
              )
            })}
          </div>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-3 inline-flex items-center gap-1.5 rounded-full px-1 t-ui font-medium text-text2 hover:text-text">
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} />
            {t('study:tab.cards.all')} <span className="tabular text-text3">{all.length}</span>
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <AllCards data={data} all={all} now={now} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </Card>
  )
}

function AllCards({ data, all, now }: { data: CourseData; all: Array<{ card: Flashcard; skill: CourseData['skills'][number] }>; now: Date }) {
  const { t } = useTranslation('study')
  const [q, setQ] = useState('')
  const key = searchKey(q.trim())
  const shown = key ? all.filter(({ card }) => searchKey(`${card.front} ${card.back}`).includes(key)) : all
  return (
    <div className="pt-3">
      <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tab.cards.search')} icon={<Icon name="search" size={15} />} />
      {key && <div className="t-footnote mt-2">{t('tab.cards.found', { count: shown.length })}</div>}
      <div className="mt-3 grid grid-cols-1 gap-2.5 @3xl:grid-cols-2">
        {shown.slice(0, 120).map(({ card, skill }) => (
          <MiniCard key={card.id} card={card} skillTitle={skill.title} state={cardState(data.progress.cards[card.id], now)} />
        ))}
      </div>
      {shown.length > 120 && <p className="t-footnote mt-3 text-center">{t('tab.cards.more', { count: shown.length - 120 })}</p>}
    </div>
  )
}

/** Una tarjeta para hojear: pulsarla la gira. */
function MiniCard({ card, skillTitle, state }: { card: Flashcard; skillTitle: string; state: ReturnType<typeof cardState> }) {
  const { t } = useTranslation('study')
  const [flip, setFlip] = useState(false)
  const front = card.kind === 'cloze' ? clozeText(card.front, false) : card.front
  const back = card.kind === 'cloze' ? clozeText(card.front, true) : card.back
  const label = state.state === 'new' ? t('tab.cards.stateNew') : state.inDays === 0 ? t('tab.cards.stateDue') : t('tab.cards.stateIn', { count: state.inDays })
  return (
    <button
      type="button"
      onClick={() => setFlip((f) => !f)}
      aria-pressed={flip}
      className="group relative flex min-h-[112px] flex-col gap-2 rounded-[16px] border-[0.5px] border-line bg-surface px-4 py-3 text-left transition-shadow hover:shadow-[var(--e2)]"
      style={{ boxShadow: 'var(--e1)' }}
    >
      <span className="flex items-center gap-2 t-footnote">
        <span className="min-w-0 flex-1 truncate"><RichText text={skillTitle} inline /></span>
        <span className={cx('shrink-0 t-caption', state.state !== 'new' && state.inDays === 0 ? 'font-semibold text-text' : 'text-text2')}>{label}</span>
      </span>
      <motion.span key={flip ? 'b' : 'f'} initial={{ opacity: 0, rotateX: -20 }} animate={{ opacity: 1, rotateX: 0 }} transition={{ duration: 0.25 }} className="block font-serif text-[16px] leading-[24px] text-text line-clamp-4">
        <RichText text={flip ? back : front} inline />
      </motion.span>
      <span className="mt-auto flex items-center gap-1.5 t-caption text-text3 opacity-0 transition-opacity group-hover:opacity-100">
        <Icon name="repeat" size={11} />
        {flip ? t('tab.cards.showFront') : t('tab.cards.showBack')}
      </span>
    </button>
  )
}

// MARK: Errores

function MistakesSection({ data, list }: { data: CourseData; list: MistakeView[] }) {
  const { t } = useTranslation(['course', 'study'])
  const due = list.filter((m) => m.due)
  // lo de hoy primero (si hay); el cuaderno entero, a un clic
  const [filter, setFilter] = useState<'due' | 'all'>(() => (due.length ? 'due' : 'all'))
  const resolved = data.progress.mistakes.filter((m) => m.resolved).length
  const packId = data.pack.id
  const resolve = (m: MistakeView): void => {
    updateProgress(packId, (p) => ({ ...p, mistakes: p.mistakes.map((x) => (x.id === m.entry.id ? { ...x, resolved: true } : x)) }), { kind: 'save' })
    toast.success(t('study:tab.mistakes.resolved'), t('study:tab.mistakes.resolvedBody'))
  }
  const shown = filter === 'due' ? due : list
  const groups = data.skills.map((s) => ({ skill: s, items: shown.filter((m) => m.entry.skill === s.id) })).filter((g) => g.items.length)
  return (
    <Card enterAnim padded="lg">
      <SectionTitle
        title={t('review.mistakesTitle')}
        action={list.length > 0 && <SegmentedTabs size="sm" value={filter} onChange={setFilter} items={[{ id: 'due', label: t('study:tab.mistakes.dueOnly'), badge: due.length }, { id: 'all', label: t('study:tab.mistakes.all'), badge: list.length }]} />}
      />
      {!list.length ? (
        <p className="t-callout text-text2">{resolved ? t('study:tab.mistakes.emptyResolved', { count: resolved }) : t('study:mistakes.nothingBody')}</p>
      ) : groups.length === 0 ? (
        <p className="t-callout text-text2">{t('study:tab.mistakes.noneDue')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.skill.id}>
              <div className="flex items-center justify-between gap-3 border-b border-rule pb-1.5">
                <span className="t-ui font-semibold text-text2 truncate"><RichText text={g.skill.title} inline /></span>
                <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'study', id: packId, mode: 'mistakes', skill: g.skill.id })}>{t('study:tab.mistakes.practiceThese')}</Button>
              </div>
              <div className="-mx-3 flex flex-col">
                {g.items.map((m) => <MistakeRow key={m.entry.id} m={m} onResolve={() => resolve(m)} />)}
              </div>
            </section>
          ))}
        </div>
      )}
      {list.length > 0 && <p className="mt-4 t-footnote">{t('study:tab.mistakes.how')}</p>}
    </Card>
  )
}

function MistakeRow({ m, onResolve }: { m: MistakeView; onResolve: () => void }) {
  const { t } = useTranslation('study')
  const [open, setOpen] = useState(false)
  const ex = m.exercise
  return (
    <div className={RULED_ROW}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:bg-fill1">
        <span aria-hidden className={cx('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', m.due ? 'bg-text2' : 'bg-fill4')} />
        <span className="min-w-0 flex-1">
          <span className="block t-callout line-clamp-2">{ex ? <RichText text={promptText(ex)} inline /> : <span className="text-text3">{t('tab.mistakes.gone')}</span>}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 t-footnote text-text2">
            <span>{t('mistakes.failedTimes', { count: m.entry.count })}</span>
            <span>{t('mistakes.stage', { n: Math.min(m.entry.stage + 1, 5), m: 5 })}</span>
            <span className={m.due ? 'font-medium text-text' : undefined}>{m.due ? t('tab.mistakes.dueNow') : t('tab.mistakes.inDays', { count: m.inDays })}</span>
          </span>
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} className="mt-1 shrink-0 text-text3" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-2 px-3 pb-3 pl-[30px] t-callout">
              {m.entry.lastInput && (
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <span className="text-text3">{t('tab.mistakes.wrote')}</span>
                  <span className="text-text2 line-through decoration-[var(--pigment-brick)]"><RichText text={m.entry.lastInput} inline /></span>
                </div>
              )}
              {ex && (
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <span className="text-text3">{t('tab.mistakes.correct')}</span>
                  <span className="text-text"><RichText text={correctAnswer(ex, i18n.language)} inline /></span>
                </div>
              )}
              {m.entry.why && (
                <MarginNote seed={m.entry.id}>
                  <RichText text={m.entry.why} inline />
                </MarginNote>
              )}
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" icon={<Icon name="check" size={13} />} onClick={onResolve} title={t('tab.mistakes.resolveHelp')}>{t('tab.mistakes.resolve')}</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// MARK: Práctica

function PracticeSection({ data, ink, now }: { data: CourseData; ink: string; now: Date }) {
  const { t } = useTranslation(['course', 'study'])
  const start = (skill?: string): void => navigate({ name: 'study', id: data.pack.id, mode: 'practice', skill })
  const skills = data.skills.filter((s) => s.exercises.length + s.templates.length > 0)
  return (
    <Card enterAnim padded="lg">
      <SectionTitle
        title={t('review.practiceTitle')}
        action={skills.length > 0 && <Button size="sm" variant="ghost" iconRight={<Icon name="arrow-right" size={13} />} onClick={() => start()}>{t('review.mixed')}</Button>}
      />
      {skills.length === 0 ? (
        <p className="t-callout text-text2">{t('study:practice.emptyBody')}</p>
      ) : (
        <div className="-mx-3 flex flex-col">
          {skills.map((s) => {
            const right = rightOfLast(data.progress.attempts.filter((a) => a.skill === s.id && a.mode !== 'exam'))
            const facts = [t('study:tab.practice.exercises', { count: s.exercises.length + s.templates.length }), right ? t('review.right', { n: right.right, m: right.total }) : t('study:tab.practice.notYet')].join(' · ')
            return (
              <RowButton key={s.id}>
                <span className="min-w-0 flex-1">
                  <span className="block t-callout font-medium [text-wrap:pretty]"><RichText text={glueLastWord(s.title)} inline /></span>
                  <span className="block t-footnote text-text2 mt-0.5">{facts}</span>
                </span>
                <MasteryBar value={skillMastery(data.progress.skills[s.id], now)} ink={ink} width={56} />
                <Button size="sm" variant="secondary" onClick={() => start(s.id)}>{t('study:exam.practiceSkill')}</Button>
              </RowButton>
            )
          })}
        </div>
      )}
    </Card>
  )
}

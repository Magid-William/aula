// Logros: hitos que se calculan con el progreso guardado (nada se apunta aparte salvo cuándo se vieron por primera vez).
// Puro: lo usa el proceso principal para avisar al conseguirlos y la interfaz para la estantería de Estadísticas.
// La fecha de cada logro es el día en que se cumplió según el historial (los días estudiados, los simulacros, cuándo se creó
// el curso); si el historial no lo dice, el día en que Aula lo vio conseguido.
import { examPercent, ownValue, type ItemID, type Pack, type StudyProgress } from '@shared/schema'
import type { AchievementId, AchievementView } from '@shared/ipc/achievements'
import { localTimeZone } from '@engine/calendar/time'
import { LearnBridge } from './bridge'
import { StudyStatsCalc } from './stats'
import { dayKey } from './util'

export interface AchievementCourse {
  pack: Pack
  progress: StudyProgress
}

/** Qué mide cada logro y cuánto hace falta. El orden es el de la estantería. */
export const ACHIEVEMENTS: ReadonlyArray<{ id: AchievementId; goal: number }> = [
  { id: 'firstAnswer', goal: 1 },
  { id: 'creator', goal: 1 },
  { id: 'streak3', goal: 3 },
  { id: 'streak7', goal: 7 },
  { id: 'streak30', goal: 30 },
  { id: 'hour1', goal: 60 },
  { id: 'hours10', goal: 600 },
  { id: 'correct100', goal: 100 },
  { id: 'correct1000', goal: 1000 },
  { id: 'cards100', goal: 100 },
  { id: 'cards1000', goal: 1000 },
  { id: 'firstMastered', goal: 1 },
  { id: 'mastered10', goal: 10 },
  { id: 'mistakes10', goal: 10 },
  { id: 'mockPassed', goal: 1 },
  { id: 'courseReady', goal: 1 }
]

/** Nota de corte de un simulacro cuando el curso no la dice. */
const DEFAULT_PASS = 0.5

/** El día («yyyy-MM-dd») en que se cumplió cada logro, según el historial. */
export type ReachedOn = Partial<Record<AchievementId, string>>

/** Lo que lleva el estudiante en cada medida y, aparte, el día en que el historial dice que cumplió cada logro. */
export type AchievementMeasures = Record<AchievementId, number> & { readonly reachedOn?: ReachedOn }

const goalOf = (id: AchievementId): number => ACHIEVEMENTS.find((a) => a.id === id)?.goal ?? 1
const finite = (n: number): number => (Number.isFinite(n) ? n : 0)

/** El día civil siguiente a «yyyy-MM-dd» (sin horas: el cambio de hora no influye). */
function nextKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** El primero (el más antiguo) de varios días, si hay alguno. */
function earliest(keys: Iterable<string | undefined>): string | undefined {
  let out: string | undefined
  for (const k of keys) if (k && (!out || k < out)) out = k
  return out
}

/**
 * El día en que se cumplió cada logro según el historial: las sumas día a día (minutos, aciertos), la primera respuesta, la
 * primera vez que la racha llegó a su largo, el primer simulacro aprobado y cuándo se creó tu primer curso. Los que el
 * historial no dice (tarjetas, temas dominados, errores resueltos, «Listo») no salen: para esos vale cuándo se vieron.
 */
export function achievementReachedOn(courses: readonly AchievementCourse[], now: Date, opts: { sampleIds?: readonly ItemID[]; timeZone?: string } = {}): ReachedOn {
  const tz = opts.timeZone ?? localTimeZone()
  const today = dayKey(now, tz)
  const progresses = courses.map((c) => c.progress)
  const out: ReachedOn = {}
  const reach = (id: AchievementId, day: string | undefined) => {
    if (day && day <= today && !out[id]) out[id] = day
  }

  // sumas día a día
  let minutes = 0
  let correct = 0
  let firstDay: string | undefined
  for (const d of StudyStatsCalc.mergedDays(progresses)) {
    if (d.day > today) break
    minutes += finite(d.minutes)
    correct += finite(d.correct)
    if (d.attempts > 0) firstDay ??= d.day
    for (const id of ['hour1', 'hours10'] as const) if (minutes >= goalOf(id)) reach(id, d.day)
    for (const id of ['correct100', 'correct1000'] as const) if (Math.floor(correct) >= goalOf(id)) reach(id, d.day)
  }
  const firstAttempt = earliest(progresses.flatMap((p) => p.attempts.map((a) => (Number.isNaN(Date.parse(a.date)) ? undefined : dayKey(new Date(a.date), tz)))))
  reach('firstAnswer', earliest([firstDay, firstAttempt]))

  // rachas: la primera vez que los días seguidos llegan a 3, 7 y 30
  const active = [...new Set(StudyStatsCalc.activeDays(progresses, tz).filter((d) => finite(d.minutes) > 0 || d.attempts > 0).map((d) => d.day))].filter((k) => k <= today).sort()
  let run = 0
  let prev: string | undefined
  for (const day of active) {
    run = prev && nextKey(prev) === day ? run + 1 : 1
    prev = day
    for (const id of ['streak3', 'streak7', 'streak30'] as const) if (run >= goalOf(id)) reach(id, day)
  }

  // el primer simulacro aprobado y el primer curso propio
  const passedOn: (string | undefined)[] = []
  for (const { pack, progress } of courses) {
    const pass = pack.blueprint?.passPercent ?? DEFAULT_PASS
    for (const e of progress.exams) if (e.kind !== 'diagnostic' && examPercent(e) >= pass && !Number.isNaN(Date.parse(e.date))) passedOn.push(dayKey(new Date(e.date), tz))
  }
  reach('mockPassed', earliest(passedOn))
  const samples = new Set(opts.sampleIds ?? [])
  reach('creator', earliest(courses.filter((c) => !samples.has(c.pack.id) && !Number.isNaN(Date.parse(c.pack.created))).map((c) => dayKey(new Date(c.pack.created), tz))))
  return out
}

/** Lo que lleva el estudiante en cada medida (sumando todos sus cursos) y el día en que cumplió cada logro. */
export function achievementMeasures(courses: readonly AchievementCourse[], now: Date, opts: { sampleIds?: readonly ItemID[] } = {}): AchievementMeasures {
  const progresses = courses.map((c) => c.progress)
  const stats = StudyStatsCalc.summary(progresses, now, 1)
  const streak = Math.max(stats.streak.best, stats.streak.current)
  const correct = progresses.reduce((s, p) => s + p.days.reduce((a, d) => a + (Number.isFinite(d.correct) ? d.correct : 0), 0), 0)
  const answered = progresses.reduce((s, p) => s + Math.max(p.attempts.length, p.days.reduce((a, d) => a + d.attempts, 0)), 0)
  const reviews = progresses.reduce((s, p) => s + Object.values(p.cards).reduce((a, c) => a + c.reps + c.lapses, 0), 0)
  let mastered = 0
  let passed = 0
  let ready = 0
  for (const { pack, progress } of courses) {
    mastered += pack.skills.filter((s) => LearnBridge.level(ownValue(progress.skills, s.id), now) === 'mastered').length
    const pass = pack.blueprint?.passPercent ?? DEFAULT_PASS
    if (progress.exams.some((e) => e.kind !== 'diagnostic' && examPercent(e) >= pass)) passed++
    if (LearnBridge.readiness(pack, progress, now).labelKey === 'ready') ready++
  }
  const resolved = progresses.reduce((s, p) => s + p.mistakes.filter((m) => m.resolved).length, 0)
  const samples = new Set(opts.sampleIds ?? [])
  const own = courses.filter((c) => !samples.has(c.pack.id)).length
  return {
    firstAnswer: answered, creator: own,
    streak3: streak, streak7: streak, streak30: streak,
    hour1: stats.totalMinutes, hours10: stats.totalMinutes,
    correct100: Math.floor(correct), correct1000: Math.floor(correct),
    cards100: reviews, cards1000: reviews,
    firstMastered: mastered, mastered10: mastered,
    mistakes10: resolved, mockPassed: passed, courseReady: ready,
    reachedOn: achievementReachedOn(courses, now, opts)
  }
}

/** Mediodía del día «yyyy-MM-dd» en la zona local, como fecha ISO (para enseñarlo sin saltar de día). */
function noonOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toISOString()
}

/** Cuándo se consiguió: el día del historial si es anterior al día en que se vio; si no, cuándo se vio (es más preciso). */
function earnedDate(seen: string | undefined, reached: string | undefined, tz: string): string | undefined {
  if (!reached) return seen
  if (seen && !Number.isNaN(Date.parse(seen)) && dayKey(new Date(seen), tz) <= reached) return seen
  return noonOf(reached)
}

/** La estantería: cada logro con lo que lleva y, si ya se consiguió, cuándo (el día en que se cumplió según el historial o,
 *  si no se sabe, cuándo se vio por primera vez). */
export function achievementViews(measures: AchievementMeasures, earnedAt: Readonly<Record<string, string>>, timeZone: string = localTimeZone()): AchievementView[] {
  return ACHIEVEMENTS.map(({ id, goal }) => {
    const value = Math.max(0, measures[id] ?? 0)
    const seen = Object.prototype.hasOwnProperty.call(earnedAt, id) ? earnedAt[id] : undefined
    const earned = value >= goal || seen !== undefined
    const at = earned ? earnedDate(seen, value >= goal ? measures.reachedOn?.[id] : undefined, timeZone) : undefined
    return { id, goal, value: Math.min(value, goal), earned, ...(at ? { earnedAt: at } : {}) }
  })
}

/** Los logros conseguidos ahora que no estaban apuntados. */
export function newlyEarned(views: readonly AchievementView[], earnedAt: Readonly<Record<string, string>>): AchievementId[] {
  return views.filter((v) => v.value >= v.goal && !Object.prototype.hasOwnProperty.call(earnedAt, v.id)).map((v) => v.id)
}

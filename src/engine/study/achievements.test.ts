// Logros: se calculan con el progreso y se celebran una sola vez.
import { describe, expect, it } from 'vitest'
import { makePack, decodeProgress, type StudyProgress } from '@shared/schema'
import { ACHIEVEMENTS, achievementMeasures, achievementReachedOn, achievementViews, newlyEarned } from './achievements'

const now = new Date(2026, 9, 26, 18)
const day = (offset: number): string => {
  const d = new Date(now)
  d.setDate(d.getDate() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function progress(extra: Record<string, unknown> = {}): StudyProgress {
  return decodeProgress({ days: [0, 1, 2, 3, 4, 5, 6].map((o) => ({ day: day(o), minutes: 20, attempts: 10, correct: 8 })), ...extra })
}

describe('logros', () => {
  it('suma lo de todos los cursos: racha, minutos, aciertos y tarjetas', () => {
    const a = { pack: makePack({ id: 'a', title: 'A' }), progress: progress({ cards: { c1: { phase: 'review', due: now.toISOString(), stability: 3, difficulty: 5, reps: 60, lapses: 2, step: 0 } } }) }
    const b = { pack: makePack({ id: 'b', title: 'B' }), progress: progress() }
    const m = achievementMeasures([a, b], now, { sampleIds: ['b'] })
    expect(m.streak7).toBe(7)
    expect(m.hour1).toBe(280)
    expect(m.correct100).toBe(112)
    expect(m.cards100).toBe(62)
    expect(m.firstAnswer).toBe(140)
    // los cursos de ejemplo no cuentan como propios
    expect(m.creator).toBe(1)
  })

  it('la estantería marca lo conseguido y lo que falta, sin pasar de la meta', () => {
    const m = achievementMeasures([{ pack: makePack({ id: 'a', title: 'A' }), progress: progress() }], now)
    const v = achievementViews(m, {})
    expect(v.map((x) => x.id)).toEqual(ACHIEVEMENTS.map((x) => x.id))
    const byId = Object.fromEntries(v.map((x) => [x.id, x]))
    expect(byId.streak3).toMatchObject({ earned: true, value: 3, goal: 3 })
    expect(byId.streak30).toMatchObject({ earned: false, value: 7, goal: 30 })
    expect(byId.hour1.earned).toBe(true)
    expect(byId.hours10.earned).toBe(false)
  })

  it('solo lo nuevo se celebra, y lo ya apuntado sigue conseguido aunque baje la medida', () => {
    const m = achievementMeasures([{ pack: makePack({ id: 'a', title: 'A' }), progress: progress() }], now)
    const earned = { streak3: '2026-10-01T10:00:00.000Z', streak30: '2026-09-01T10:00:00.000Z' }
    const v = achievementViews(m, earned)
    const fresh = newlyEarned(v, earned)
    expect(fresh).toContain('streak7')
    expect(fresh).not.toContain('streak3')
    expect(v.find((x) => x.id === 'streak30')).toMatchObject({ earned: true, earnedAt: '2026-09-01T10:00:00.000Z' })
    expect(newlyEarned(achievementViews(m, {}), {})).not.toContain('streak30')
  })

  it('sin progreso no hay nada conseguido', () => {
    const v = achievementViews(achievementMeasures([], now), {})
    expect(v.every((x) => !x.earned && x.value === 0)).toBe(true)
  })

  it('el día de cada logro sale del historial: sumas, primera respuesta, rachas, simulacro y primer curso', () => {
    const pack = makePack({ id: 'a', title: 'A' })
    pack.created = new Date(2026, 9, 18, 9).toISOString()
    const passed = { id: 'x1', date: new Date(2026, 9, 23, 17).toISOString(), kind: 'mock', scorePoints: 80, totalPoints: 100, durationSeconds: 3600, items: [] }
    const failed = { id: 'x0', date: new Date(2026, 9, 21, 17).toISOString(), kind: 'mock', scorePoints: 20, totalPoints: 100, durationSeconds: 3600, items: [] }
    const r = achievementReachedOn([{ pack, progress: progress({ exams: [failed, passed] }) }], now)
    // 20 min al día desde hace 6 días: la primera hora llega el tercer día, y la racha de 3 también
    expect(r.firstAnswer).toBe(day(6))
    expect(r.hour1).toBe(day(4))
    expect(r.streak3).toBe(day(4))
    expect(r.streak7).toBe(day(0))
    expect(r.mockPassed).toBe(day(3))
    expect(r.creator).toBe('2026-10-18')
    // lo que no llega (100 aciertos, 30 días) o el historial no dice (tarjetas) no tiene día
    expect(r.correct100).toBeUndefined()
    expect(r.streak30).toBeUndefined()
    expect(r.cards100).toBeUndefined()
  })

  it('la estantería fecha cada logro el día en que se cumplió, no el día en que Aula lo vio', () => {
    const m = achievementMeasures([{ pack: makePack({ id: 'a', title: 'A' }), progress: progress() }], now)
    // visto hoy, pero la racha de 3 se cumplió hace 4 días
    const seen = { streak3: now.toISOString(), streak7: now.toISOString() }
    const v = achievementViews(m, seen)
    const at = (id: string) => v.find((x) => x.id === id)?.earnedAt
    expect(new Date(at('streak3')!).getDate()).toBe(new Date(now.getTime() - 4 * 86_400_000).getDate())
    // cumplido el mismo día en que se vio: se queda la hora exacta
    expect(at('streak7')).toBe(now.toISOString())
    // conseguido sin apuntar todavía: ya lleva su día
    expect(at('hour1')).toBeDefined()
    // lo que no está conseguido no lleva fecha
    expect(at('streak30')).toBeUndefined()
  })
})

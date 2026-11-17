// «Estudiar ahora»: el plan de hoy de un curso como una sesión con pasos (tarjetas → errores → aprender → practicar…). Vive
// mientras la app está abierta; cada modo, al terminar, ofrece seguir con el siguiente paso y salir vuelve al plan.
// «Empezar el repaso» (Repasar) es otra sesión, aparte: solo los pasos de repaso, no pisa el plan de hoy y, al salir o
// terminar, vuelve a Repasar.
import { create } from 'zustand'
import type { PlanItem } from '@engine/learn'
import { navigate, useNav, type CourseTab, type Route } from '@renderer/app/router'

/** El plan de hoy entero o la cola de repaso. */
export type PlanScope = 'plan' | 'review'

export interface PlanSession {
  packId: string
  scope: PlanScope
  items: PlanItem[]
  done: boolean[]
  /** Paso en marcha (-1 = en la agenda). */
  current: number
  startedAt: number
}

interface PlanStore {
  /** Cada sesión en su sitio: la cola de repaso no pisa el plan de hoy (ni al revés). */
  sessions: Partial<Record<PlanScope, PlanSession>>
  /** La sesión del paso en marcha: a ella vuelven los modos al terminar o salir. */
  running: PlanScope | null
}

export const usePlanStore = create<PlanStore>(() => ({ sessions: {}, running: null }))

/** Pasos que se pueden hacer (el descanso no es un paso). */
export const runnable = (items: PlanItem[]): PlanItem[] => items.filter((i) => i.kind !== 'rest' && i.minutes > 0)

export function startPlan(packId: string, items: PlanItem[], opts: { scope?: PlanScope } = {}): void {
  const scope = opts.scope ?? 'plan'
  const steps = runnable(items)
  const { sessions, running } = usePlanStore.getState()
  const session: PlanSession = { packId, scope, items: steps, done: steps.map(() => false), current: -1, startedAt: Date.now() }
  usePlanStore.setState({ sessions: { ...sessions, [scope]: session }, running: running === scope ? null : running })
}

/** La sesión de hoy de un curso: la de `scope` o, sin él, la del paso en marcha. */
export function activePlan(packId: string, scope?: PlanScope): PlanSession | null {
  const { sessions, running } = usePlanStore.getState()
  const key = scope ?? running
  const s = key ? sessions[key] : undefined
  // una sesión de otro día (o de otro curso) ya no vale
  return s && s.packId === packId && new Date(s.startedAt).toDateString() === new Date().toDateString() ? s : null
}

export function endPlan(scope: PlanScope = 'plan'): void {
  const { sessions, running } = usePlanStore.getState()
  const rest = { ...sessions }
  delete rest[scope]
  usePlanStore.setState({ sessions: rest, running: running === scope ? null : running })
}

/** El paso en marcha de la sesión de un curso (si se está siguiendo una), para que el modo haga lo que dice el plan. */
export function currentStep(packId: string): PlanItem | null {
  const s = activePlan(packId)
  return s && s.current >= 0 ? s.items[s.current] ?? null : null
}

/** La ruta de estudio de un paso del plan. */
export function routeForStep(packId: string, item: PlanItem): Route {
  const skill = item.skillID ?? undefined
  switch (item.kind) {
    case 'review': return item.id === 'formulas' ? { name: 'course', id: packId, tab: 'reference' } : { name: 'study', id: packId, mode: 'cards' }
    case 'mistakes': return { name: 'study', id: packId, mode: 'mistakes' }
    case 'learn': return { name: 'study', id: packId, mode: 'learn', skill }
    case 'mock': return { name: 'study', id: packId, mode: 'exam' }
    case 'diagnostic': return { name: 'study', id: packId, mode: 'practice', skill: '__diagnostic' }
    default: return { name: 'study', id: packId, mode: 'practice', skill }
  }
}

/** Abre el paso `i` de una sesión (por defecto, el plan de hoy). `replace`: en lugar de la entrada del historial de ahora
 *  (entrar directamente en el primer paso). */
export function runStep(packId: string, i: number, opts: { replace?: boolean; scope?: PlanScope } = {}): void {
  const scope = opts.scope ?? 'plan'
  const s = activePlan(packId, scope)
  if (!s || !s.items[i]) return
  const { sessions } = usePlanStore.getState()
  usePlanStore.setState({ sessions: { ...sessions, [scope]: { ...s, current: i } }, running: scope })
  navigate(routeForStep(packId, s.items[i]), opts.replace ? { replace: true } : undefined)
}

const marked = (done: boolean[], i: number): boolean[] => done.map((d, k) => d || k === i)

/** El paso en marcha terminó (lo llama el resumen de cada modo). Lo repasado desde Repasar cuenta también en el plan de hoy
 *  si tiene el mismo paso (los ids son estables: «review», «mistakes», «practice:<tema>»). */
export function completeCurrentStep(packId: string): void {
  const s = activePlan(packId)
  if (!s || s.current < 0 || s.done[s.current]) return
  const sessions = { ...usePlanStore.getState().sessions, [s.scope]: { ...s, done: marked(s.done, s.current) } }
  const plan = s.scope === 'review' ? activePlan(packId, 'plan') : null
  const k = plan ? plan.items.findIndex((i) => i.id === s.items[s.current].id) : -1
  if (plan && k >= 0) sessions.plan = { ...plan, done: marked(plan.done, k) }
  usePlanStore.setState({ sessions })
}

/** El siguiente paso sin hacer de la sesión en marcha (o null si está completa). */
export function nextStep(packId: string): { index: number; item: PlanItem; scope: PlanScope } | null {
  const s = activePlan(packId)
  if (!s) return null
  const i = s.done.findIndex((d, k) => !d && k !== s.current)
  return i >= 0 ? { index: i, item: s.items[i], scope: s.scope } : null
}

/** Salir de un modo: con la cola de repaso, de vuelta a Repasar (y la cola se acaba); con el plan de hoy, a su agenda; si no,
 *  a la pestaña del curso. */
export function leaveStep(packId: string, tab?: CourseTab): void {
  const s = activePlan(packId)
  if (s?.scope === 'review') {
    endPlan('review')
    navigate({ name: 'course', id: packId, tab: 'review' }, { replace: true })
  } else if (s && s.current >= 0) navigate({ name: 'study', id: packId, mode: 'plan' }, { replace: true })
  else navigate({ name: 'course', id: packId, tab }, { replace: true })
}

/** ¿La ruta sigue dentro de la sesión? Cualquier pantalla de estudio de su curso (la agenda incluida) o la del paso en marcha
 *  (el repaso de fórmulas se hace en la pestaña Aprender del curso). */
export function insideSession(s: PlanSession, r: Route): boolean {
  if (r.name === 'study') return r.id === s.packId
  const step = s.current >= 0 ? s.items[s.current] : undefined
  return !!step && JSON.stringify(routeForStep(s.packId, step)) === JSON.stringify(r)
}

/** Se salió de la sesión por otro camino que su «×» (atrás del sistema, el gesto del borde, una pestaña de abajo, otra
 *  pantalla): el paso deja de estar en marcha. Si no, cerrar después una lección abierta desde Aprender llevaba a la agenda
 *  del plan que el estudiante ya había dejado. */
export function leftSession(r: Route): void {
  const { sessions, running } = usePlanStore.getState()
  const next = { ...sessions }
  let changed = false
  for (const scope of ['plan', 'review'] as const) {
    const s = sessions[scope]
    if (s && s.current >= 0 && !insideSession(s, r)) {
      next[scope] = { ...s, current: -1 }
      changed = true
    }
  }
  const still = running && (next[running]?.current ?? -1) >= 0 ? running : null
  if (changed || still !== running) usePlanStore.setState({ sessions: next, running: still })
}

useNav.subscribe((nav, prev) => {
  if (nav.route !== prev.route) leftSession(nav.route)
})

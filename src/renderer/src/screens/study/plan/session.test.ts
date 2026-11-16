// El plan de hoy («Estudiar ahora») y la cola de «Empezar el repaso» son dos sesiones: una no pisa la otra, salir de la cola
// vuelve a Repasar y lo repasado cuenta también en el plan.
import { beforeEach, describe, expect, it } from 'vitest'
import type { PlanItem } from '@engine/learn'
import { useNav } from '@renderer/app/router'
import { activePlan, completeCurrentStep, endPlan, leaveStep, nextStep, runStep, startPlan, usePlanStore } from './session'

const PACK = 'p1'
const item = (id: string, kind: PlanItem['kind'], minutes = 10): PlanItem => ({ id, kind, skillID: id.includes(':') ? id.split(':')[1] : null, title: id, minutes, reason: '' })
const PLAN = [item('review', 'review'), item('mistakes', 'mistakes'), item('learn:a', 'learn'), item('learn:b', 'learn'), item('rest', 'rest', 0)]
const REVIEW = [item('review', 'review'), item('mistakes', 'mistakes')]
const route = (): unknown => useNav.getState().route

beforeEach(() => {
  usePlanStore.setState({ sessions: {}, running: null })
  useNav.setState({ stack: [{ name: 'home' }], index: 0, route: { name: 'home' }, canBack: false, canForward: false })
})

describe('el plan de hoy y la cola de repaso', () => {
  it('«Empezar el repaso» no pisa el plan de hoy: «Estudiar ahora» sigue con sus pasos de aprender', () => {
    startPlan(PACK, PLAN)
    startPlan(PACK, REVIEW, { scope: 'review' })
    runStep(PACK, 0, { scope: 'review' })
    expect(activePlan(PACK, 'plan')?.items.map((i) => i.id)).toEqual(['review', 'mistakes', 'learn:a', 'learn:b'])
    expect(activePlan(PACK)?.scope).toBe('review')
    expect(route()).toEqual({ name: 'study', id: PACK, mode: 'cards' })
  })

  it('a mitad de «Estudiar ahora», la cola de repaso no tira lo hecho del plan', () => {
    startPlan(PACK, PLAN)
    runStep(PACK, 0)
    completeCurrentStep(PACK)
    runStep(PACK, 1)
    startPlan(PACK, REVIEW, { scope: 'review' })
    runStep(PACK, 1, { scope: 'review' })
    leaveStep(PACK, 'mistakes')
    expect(activePlan(PACK, 'plan')?.done).toEqual([true, false, false, false])
  })

  it('salir de la cola de repaso vuelve a Repasar y la acaba; salir de un paso del plan, a su agenda', () => {
    startPlan(PACK, REVIEW, { scope: 'review' })
    runStep(PACK, 0, { scope: 'review' })
    leaveStep(PACK, 'cards')
    expect(route()).toEqual({ name: 'course', id: PACK, tab: 'review' })
    expect(activePlan(PACK, 'review')).toBeNull()
    expect(activePlan(PACK)).toBeNull()

    startPlan(PACK, PLAN)
    runStep(PACK, 2)
    leaveStep(PACK, 'learn')
    expect(route()).toEqual({ name: 'study', id: PACK, mode: 'plan' })
  })

  it('sin sesión en marcha, salir lleva a la pestaña del curso', () => {
    startPlan(PACK, PLAN)
    leaveStep(PACK, 'learn')
    expect(route()).toEqual({ name: 'course', id: PACK, tab: 'learn' })
  })

  it('terminar la cola de repaso: el último paso no ofrece ninguno más y salir vuelve a Repasar, no a la agenda', () => {
    startPlan(PACK, PLAN)
    startPlan(PACK, REVIEW, { scope: 'review' })
    runStep(PACK, 0, { scope: 'review' })
    completeCurrentStep(PACK)
    expect(nextStep(PACK)).toEqual({ index: 1, item: REVIEW[1], scope: 'review' })
    runStep(PACK, 1, { scope: 'review' })
    completeCurrentStep(PACK)
    expect(nextStep(PACK)).toBeNull()
    leaveStep(PACK, 'mistakes')
    expect(route()).toEqual({ name: 'course', id: PACK, tab: 'review' })
    // lo repasado también cuenta en el plan (mismo paso); los de aprender siguen pendientes
    expect(activePlan(PACK, 'plan')?.done).toEqual([true, true, false, false])
  })

  it('«Estudiar ahora» después de dejar la cola a medias (sin salir por «Salir»): el plan toma el mando', () => {
    startPlan(PACK, REVIEW, { scope: 'review' })
    runStep(PACK, 0, { scope: 'review' })
    startPlan(PACK, PLAN)
    expect(usePlanStore.getState().running).toBe('review')
    runStep(PACK, 0, { replace: true })
    expect(activePlan(PACK)?.scope).toBe('plan')
    leaveStep(PACK, 'cards')
    expect(route()).toEqual({ name: 'study', id: PACK, mode: 'plan' })
  })

  it('acabar el plan no toca la cola de repaso; una sesión de otro curso no vale', () => {
    startPlan(PACK, PLAN)
    startPlan(PACK, REVIEW, { scope: 'review' })
    endPlan('plan')
    expect(activePlan(PACK, 'plan')).toBeNull()
    expect(activePlan(PACK, 'review')?.items).toHaveLength(2)
    expect(activePlan('otro', 'review')).toBeNull()
  })
})

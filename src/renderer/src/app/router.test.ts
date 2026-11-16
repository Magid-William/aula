import { describe, expect, it } from 'vitest'
import { canonicalTab, COURSE_VIEWS, routeKey } from './router'

describe('las pestañas del curso', () => {
  it('son cinco vistas', () => {
    expect(COURSE_VIEWS).toEqual(['overview', 'learn', 'review', 'exam', 'materials'])
    for (const view of COURSE_VIEWS) expect(canonicalTab(view)).toEqual({ view })
  })
  it('los ids viejos siguen funcionando y llevan a su sección', () => {
    expect(canonicalTab('practice')).toEqual({ view: 'review', focus: 'practice' })
    expect(canonicalTab('cards')).toEqual({ view: 'review', focus: 'cards' })
    expect(canonicalTab('mistakes')).toEqual({ view: 'review', focus: 'mistakes' })
    expect(canonicalTab('reference')).toEqual({ view: 'learn', focus: 'reference' })
  })
  it('sin pestaña o con una desconocida, el Resumen', () => {
    expect(canonicalTab()).toEqual({ view: 'overview' })
    expect(canonicalTab('inventada')).toEqual({ view: 'overview' })
    expect(canonicalTab('toString')).toEqual({ view: 'overview' })
  })
})

describe('la sesión que arranca sola', () => {
  it('es la misma pantalla que sin arrancar (no repinta ni duplica la capa)', () => {
    expect(routeKey({ name: 'study', id: 'c1', mode: 'plan', start: true })).toBe(routeKey({ name: 'study', id: 'c1', mode: 'plan' }))
  })
})

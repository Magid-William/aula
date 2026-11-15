import { test, expect } from 'playwright/test'
import { diagramReferenceDifference } from './diagram-reference'

test('referencia Diagram: compara snapshots completos con una sola aserción y precisión V6', () => {
  const cases: Array<{ reference: unknown; candidate: unknown; accepted: boolean }> = [
    { reference: { fonts: [{ name: 'Inter', x: 12.25 }], dpr: 1 }, candidate: { fonts: [{ name: 'Inter', x: 12.25 }], dpr: 1 }, accepted: true },
    { reference: 0, candidate: .001, accepted: true },
    { reference: 0, candidate: -.001, accepted: true },
    { reference: 0, candidate: .001 + Number.EPSILON, accepted: false },
    { reference: { font: 'Inter' }, candidate: { font: 'Arial' }, accepted: false },
    { reference: { style: { color: 'rgb(1,2,3)' } }, candidate: { style: { color: 'rgb(1,2,4)' } }, accepted: false },
    { reference: { a: 1, b: 2 }, candidate: { b: 2, a: 1 }, accepted: false },
    { reference: { a: 1, b: 2 }, candidate: { a: 1 }, accepted: false },
    { reference: { a: 1 }, candidate: { a: 1, b: undefined }, accepted: false },
    { reference: [1, 2], candidate: [1], accepted: false },
    { reference: [1, 2], candidate: [1, 3], accepted: false },
    { reference: 1, candidate: '1', accepted: false },
    { reference: null, candidate: null, accepted: true },
    { reference: null, candidate: undefined, accepted: false },
    { reference: NaN, candidate: NaN, accepted: false },
    { reference: Infinity, candidate: Infinity, accepted: false },
    { reference: -0, candidate: 0, accepted: true },
    { reference: true, candidate: true, accepted: true },
    { reference: false, candidate: 0, accepted: false },
    { reference: [], candidate: {}, accepted: false },
    // Conserva la asimetría objeto→array del contrato observado en V6.
    { reference: {}, candidate: [], accepted: true },
    { reference: { 0: 1 }, candidate: [1], accepted: true }
  ]
  expect(cases.map(({ reference, candidate }) => diagramReferenceDifference(reference, candidate) === undefined)).toEqual(cases.map(item => item.accepted))
})

test('referencia Diagram: rechaza reflow, cambios de Range y barras de fracción sin aceptar sólo texto igual', () => {
  const reference = {
    viewport: { width: 800, height: 1100 },
    fonts: [{ text: 'Same text', fontFamily: 'Inter', fontSize: '14px', rects: [{ x: 12, y: 18, width: 100, height: 20 }] }],
    ranges: [{ text: 'Same text', rects: [{ x: 12, y: 18, width: 100, height: 20 }] }],
    fractions: [{ borderBottomWidth: '0.5px', minHeight: '0.5px', rect: { x: 30, y: 32, width: 8, height: .5 } }]
  }
  const variants = [
    { ...reference, viewport: { width: 1440, height: 1100 } },
    { ...reference, fonts: [{ ...reference.fonts[0], rects: [{ x: 12, y: 18, width: 80, height: 40 }] }] },
    { ...reference, ranges: [{ ...reference.ranges[0], rects: [{ x: 12, y: 18.5, width: 100, height: 20 }] }] },
    { ...reference, fractions: [{ ...reference.fractions[0], borderBottomWidth: '1px' }] }
  ]
  expect(variants.map(candidate => diagramReferenceDifference(reference, candidate)?.split(':')[0])).toEqual([
    'independent.viewport.width', 'independent.fonts[0].rects[0].width', 'independent.ranges[0].rects[0].y', 'independent.fractions[0].borderBottomWidth'
  ])
})

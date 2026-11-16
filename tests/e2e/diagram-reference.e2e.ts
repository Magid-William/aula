import { test, expect } from 'playwright/test'
import { diagramReferenceDifference, invariantFields, requireContainedDiagramClip } from './diagram-reference'

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

test('referencia Diagram: exige el clip original dentro del viewport real sin ajustar sus bordes', () => {
  const viewport = Object.freeze({ width: 800, height: 1100 }), clip = Object.freeze({ x: 10, y: 100, width: 790, height: 1000 })
  expect(() => requireContainedDiagramClip(clip, viewport)).not.toThrow()
  expect(() => requireContainedDiagramClip({ x: .25, y: .5, width: 1439.75, height: 1099.5 }, { width: 1440, height: 1100 })).not.toThrow()
  for (const invalid of [
    { ...clip, x: -.000001 }, { ...clip, y: -.000001 }, { ...clip, x: 10.000001 }, { ...clip, height: 1000.000001 },
    { ...clip, width: 0 }, { ...clip, height: -1 }, { ...clip, x: NaN }, { ...clip, width: Infinity }
  ]) expect(() => requireContainedDiagramClip(invalid, viewport)).toThrow(/entirely/)
  for (const invalid of [{ width: 799, height: 1100 }, { width: 800, height: 1099 }, { width: 0, height: 1100 }, { width: 800, height: NaN }, { width: Infinity, height: 1100 }]) {
    expect(() => requireContainedDiagramClip(clip, invalid)).toThrow(/entirely/)
  }
  expect(clip).toEqual({ x: 10, y: 100, width: 790, height: 1000 })
})

test('referencia Diagram: detecta deriva absoluta y scroll aunque la geometría relativa no cambie', () => {
  const snapshot: Parameters<typeof invariantFields>[0] = {
    dom: {
      dpr: 1, viewport: { width: 800, height: 1100 }, absoluteViewport: { x: 15.5, y: 650 },
      scrollAncestors: [{ scrollTop: 35, scrollLeft: 0 }], windowScroll: { x: 0, y: 0 }, visualViewport: { pageTop: 0, scale: 1 },
      bodyStyle: null, canvasTransform: 'none', fonts: [], ranges: [], fractions: []
    },
    geometry: { width: 600, height: 400, canvas: { x: 0, y: 0, width: 600, height: 400, naturalWidth: 600, naturalHeight: 400, scale: 1 }, background: [255, 255, 255], exclusions: [], labels: [] }
  }
  const variants = [
    { ...snapshot, dom: { ...snapshot.dom, absoluteViewport: { x: 15.5, y: 674 } } },
    { ...snapshot, dom: { ...snapshot.dom, scrollAncestors: [{ scrollTop: 36, scrollLeft: 0 }] } },
    { ...snapshot, dom: { ...snapshot.dom, windowScroll: { x: 0, y: .002 } } },
    { ...snapshot, dom: { ...snapshot.dom, visualViewport: { pageTop: .002, scale: 1 } } }
  ]
  const expected = ['independent.absoluteViewport.y', 'independent.scrollAncestors[0].scrollTop', 'independent.windowScroll.y', 'independent.visualViewport.pageTop']
  // La captura puede restablecer sólo el DPR; eso no autoriza perder el origen ni el scroll.
  for (const includeDpr of [true, false]) {
    expect(variants.map(value => diagramReferenceDifference(invariantFields(snapshot, includeDpr), invariantFields(value, includeDpr))?.split(':')[0])).toEqual(expected)
  }
  const changedDpr = { ...snapshot, dom: { ...snapshot.dom, dpr: 2 } }
  expect(diagramReferenceDifference(invariantFields(snapshot), invariantFields(changedDpr))).toBe('independent.dpr: numeric difference')
  expect(diagramReferenceDifference(invariantFields(snapshot, false), invariantFields(changedDpr, false))).toBeUndefined()
})

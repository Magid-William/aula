// Pruebas puras de precisión observacional: no abren Electron ni un navegador.
import { test, expect } from 'playwright/test'
import { assertChartCaptureInvariant, assertChartReferenceInvariant, chartReferenceGeometryTolerance, requireContainedChartClip, type ChartReferenceSnapshot } from './chart-reference'

function snapshot(): ChartReferenceSnapshot {
  const width = 634.3325805664062, height = 311.74310302734375
  return {
    body: {
      box: { x: 523.0836791992188, y: 192.62838745117188, width, height },
      naturalWidth: 492.929, naturalHeight: 242.25, scaleX: width / 492.929, scaleY: height / 242.25,
      styles: { fontFamily: 'ui-serif', fontStyle: 'italic', fontSize: '15px', transform: 'none' }
    },
    viewport: { width: 1440, height: 1100, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    nodes: [{ path: 'body/0', tag: 'text', box: { x: 222.70558405758544, y: 130, width: 24.646770148288663, height: 13 }, styles: { fontFamily: 'ui-serif', fontSize: '11px' }, attributes: { x: '230', y: '140', fill: '#201e1a' } }],
    texts: [{ path: 'body/0/0', kind: 'text', text: '42 units', boxes: [{ x: 222.70558405758544, y: 130, width: 24.646770148288663, height: 13 }], styles: { fontFamily: 'ui-serif', fontStyle: 'italic' } }]
  }
}

test('referencia Chart: conserva identidad y acepta sólo la precisión Float32 observada', () => {
  const before = snapshot(), after = structuredClone(before)
  assertChartReferenceInvariant(before, after)
  // Mediciones del mismo layout Slides trasladado: los extremos BCR se redondean por separado.
  after.body.box.x = 523.0032348632812; after.body.box.y = 191.99644470214844
  after.body.box.width = 634.3327026367188; after.body.scaleX = after.body.box.width / after.body.naturalWidth
  after.nodes[0].box.x = 222.70554120035902; after.nodes[0].box.width = 24.646575687822473
  after.texts[0].boxes[0] = { ...after.nodes[0].box }
  assertChartReferenceInvariant(before, after)
  const tolerance = chartReferenceGeometryTolerance(before, after)
  expect(tolerance.screenUlp).toBe(1 / 8192)
  expect(tolerance.physicalPixels).toBe(1 / 4096)
  for (const budget of Object.values(tolerance.box)) expect(budget).toBeLessThan(1 / 64)
})

test('referencia Chart: rechaza geometría que excede el presupuesto y desplazamientos de un píxel', () => {
  const before = snapshot(), tolerance = chartReferenceGeometryTolerance(before, before)
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    for (const shift of [tolerance.box[field] * 1.1, 1]) {
      const after = structuredClone(before); after.nodes[0].box[field] += shift
      expect(() => assertChartReferenceInvariant(before, after)).toThrow(/nodes\.0\.box/)
      const text = structuredClone(before); text.texts[0].boxes[0][field] += shift
      expect(() => assertChartReferenceInvariant(before, text)).toThrow(/texts\.0\.boxes/)
    }
  }
  const body = structuredClone(before); body.body.box.width += tolerance.physicalPixels * 1.1
  expect(() => assertChartReferenceInvariant(before, body)).toThrow(/body\.box\.width/)
})

test('referencia Chart: fuentes, estilos, atributos, texto y saltos de línea permanecen exactos', () => {
  const before = snapshot()
  const changes: Array<(value: ChartReferenceSnapshot) => void> = [
    value => { value.body.styles.fontFamily = 'sans-serif' },
    value => { value.body.styles.fontStyle = 'normal' },
    value => { value.nodes[0].styles.fontSize = '11.00001px' },
    value => { value.nodes[0].attributes.x = '230.00001' },
    value => { value.nodes[0].attributes.fill = '#211e1a' },
    value => { value.texts[0].text = '43 units' },
    value => { value.texts[0].boxes.push({ ...value.texts[0].boxes[0] }) }
  ]
  for (const change of changes) {
    const after = structuredClone(before); change(after)
    expect(() => assertChartReferenceInvariant(before, after)).toThrow(/Chart reference changed/)
  }
})

test('referencia Chart: DPR, viewport y dimensiones CSS no heredan tolerancia geométrica', () => {
  const before = snapshot()
  const changes: Array<(value: ChartReferenceSnapshot) => void> = [
    value => { value.viewport.devicePixelRatio = 2 },
    value => { value.viewport.width += .00001 },
    value => { value.viewport.scrollY += 1 },
    value => { value.body.naturalWidth += .00001 },
    value => { value.body.naturalHeight += .00001 }
  ]
  for (const change of changes) {
    const after = structuredClone(before); change(after)
    expect(() => assertChartReferenceInvariant(before, after)).toThrow(/Chart reference changed/)
  }
})

test('referencia Chart: falla si la precisión disponible podría ocultar una unidad de layout', () => {
  const before = snapshot(), after = structuredClone(before)
  after.body.box.x = 1_000_000_000
  expect(() => assertChartReferenceInvariant(before, after)).toThrow(/precision cannot distinguish/)
  after.body.box.x = NaN
  expect(() => assertChartReferenceInvariant(before, after)).toThrow(/Invalid Chart screen precision/)
})

test('referencia Chart: la captura conserva también el origen absoluto y el DPR real', () => {
  const before = snapshot()
  assertChartCaptureInvariant(before, structuredClone(before))
  for (const axis of ['x', 'y'] as const) {
    const moved = structuredClone(before); moved.body.box[axis] += 1
    // La colocación puede trasladar el cuerpo; una captura no tiene esa autorización.
    assertChartReferenceInvariant(before, moved)
    expect(() => assertChartCaptureInvariant(before, moved)).toThrow(/absolute body/)
  }
  const dpr = structuredClone(before); dpr.viewport.devicePixelRatio = 2
  expect(() => assertChartCaptureInvariant(before, dpr)).toThrow(/devicePixelRatio/)
  const viewport = structuredClone(before); viewport.viewport.width += 1
  expect(() => assertChartCaptureInvariant(before, viewport)).toThrow(/viewport.width/)
  const scroll = structuredClone(before); scroll.viewport.scrollY += 1
  expect(() => assertChartCaptureInvariant(before, scroll)).toThrow(/scrollY/)
})

test('referencia Chart: exige el clip completo dentro del viewport observado', () => {
  const viewport = { width: 1440, height: 1100 }, clip = { x: 10, y: 20, width: 100, height: 200 }
  requireContainedChartClip(clip, viewport)
  requireContainedChartClip({ x: 0, y: 0, ...viewport }, viewport)
  for (const invalid of [
    { ...clip, x: -1 }, { ...clip, y: -1 }, { ...clip, width: 0 }, { ...clip, height: 0 },
    { ...clip, x: 1341 }, { ...clip, y: 901 }, { ...clip, x: NaN }, { ...clip, width: Infinity }
  ]) expect(() => requireContainedChartClip(invalid, viewport)).toThrow(/complete Chart reference clip/)
  expect(() => requireContainedChartClip(clip, { width: 0, height: 1100 })).toThrow(/complete Chart reference clip/)
})

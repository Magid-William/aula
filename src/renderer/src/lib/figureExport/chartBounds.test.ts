import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertChartRenderContext, chartExportBounds } from './chartBounds'
import { prepareChartRenderContext } from '@engine/figures/chart'
import { chartSceneFixture } from '@engine/figures/testing'

const rect = (x: number, y: number, width: number, height: number): DOMRect => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({ x, y, width, height }) })
function fixture() {
  const properties = new Map<string, { value: string; priority: string }>()
  const style = {
    getPropertyValue: (name: string): string => properties.get(name)?.value ?? '', getPropertyPriority: (name: string): string => properties.get(name)?.priority ?? '',
    setProperty: (name: string, value: string, priority = ''): void => { properties.set(name, { value, priority }) }, removeProperty: (name: string): void => { properties.delete(name) }
  }
  const styles = new Map<object, Partial<CSSStyleDeclaration>>()
  const svg = { getBoundingClientRect: () => rect(10, 20, 100, 80) }
  const shape = { localName: 'path', ownerSVGElement: svg, getBBox: () => rect(-8, -10, 118, 90), getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }) }
  const panel = { dataset: { chartShadow: 'none' }, getBoundingClientRect: () => rect(20, 30, 30, 20) }
  const label = { getBoundingClientRect: () => rect(20, 30, 30, 20), ranges: [rect(-5, 31, 90, 18)] }
  const lists = { shapes: [shape], panels: [panel], labels: [label] }
  const scene = { style, getBoundingClientRect: () => rect(10, 20, 100, 80), querySelectorAll: (selector: string) => selector === '[data-chart-geometry]' ? lists.shapes : selector === '[data-chart-panel]' ? lists.panels : selector === '[data-chart-text]' ? lists.labels : [svg, ...lists.shapes, ...lists.panels, ...lists.labels] } as unknown as HTMLElement
  styles.set(svg, { overflow: 'visible' }); styles.set(shape, { stroke: '#112233', fill: 'none', strokeWidth: '10', strokeLinejoin: 'miter', opacity: '1', fontStyle: 'normal', fontSize: '12px' })
  styles.set(label, { overflow: 'visible', opacity: '1', fontStyle: 'normal', fontSize: '12px' }); styles.set(panel, { opacity: '1' })
  vi.stubGlobal('getComputedStyle', (element: object) => styles.get(element))
  vi.stubGlobal('DOMPoint', class {
    constructor(public x: number, public y: number) {}
    matrixTransform(m: { a: number; b: number; c: number; d: number; e: number; f: number }): { x: number; y: number } { return { x: this.x * m.a + this.y * m.c + m.e, y: this.x * m.b + this.y * m.d + m.f } }
  })
  let selected = label
  vi.stubGlobal('document', { createRange: () => ({ selectNodeContents: (element: typeof label) => { selected = element }, getClientRects: () => selected.ranges, detach: vi.fn() }) })
  return { scene, styles, lists, svg, shape, panel, label }
}
afterEach(() => vi.unstubAllGlobals())

describe('encuadre natural Chart', () => {
  it('comprueba la CTM Float32 prevista sin exigir identidad ni usar 1/W', () => {
    const input = chartSceneFixture(); input.metrics.rawEffectiveZoom = 3.875
    const context = prepareChartRenderContext(input, 1.25)
    const window = { devicePixelRatio: 1.25 }
    const matrix = { a: 0.9999999701976776, b: 0, c: 0, d: 0.9999999701976776 }
    const svg = { getScreenCTM: () => matrix }
    const wrapper = { currentCSSZoom: Math.fround(3.875 / 1.25), querySelectorAll: () => [svg] }
    const scene = { ownerDocument: { defaultView: window }, querySelector: () => wrapper } as unknown as HTMLElement
    expect(() => assertChartRenderContext(scene, context)).not.toThrow()
    matrix.a = matrix.d = 1.9999999403953552
    expect(() => assertChartRenderContext(scene, context, 2)).not.toThrow()
    expect(() => assertChartRenderContext(scene, context)).toThrow('paint transform')
    matrix.a = matrix.d = 1.0000000856816769
    expect(() => assertChartRenderContext(scene, context)).toThrow('paint transform')
    matrix.a = matrix.d = 0.9999999701976776
    window.devicePixelRatio = 2
    expect(() => assertChartRenderContext(scene, context)).toThrow('native zoom')
    window.devicePixelRatio = 1.25; wrapper.currentCSSZoom = 1
    expect(() => assertChartRenderContext(scene, context)).toThrow('wrapper zoom')
  })
  it('el panel vacío conserva el contexto aunque no necesite SVG', () => {
    const input = chartSceneFixture(); input.metrics.rawEffectiveZoom = 3.5
    const context = prepareChartRenderContext(input, 2)
    const scene = { ownerDocument: { defaultView: { devicePixelRatio: 2 } }, querySelector: () => ({ currentCSSZoom: 1.75, querySelectorAll: () => [] }) } as unknown as HTMLElement
    expect(() => assertChartRenderContext(scene, context)).not.toThrow()
  })
  it('incluye miter de cuatro semigrosores, resta el origen y conserva cajas nominales', () => {
    const { scene } = fixture()
    expect(chartExportBounds(scene, { width: 100, height: 80 })).toEqual({ x: -30, y: -32, width: 162, height: 134 })
    expect(scene.style.getPropertyValue('transform')).toBe('')
  })
  it('recorta SVG hidden a su caja real pero incluye tinta fuera de SVG visible', () => {
    const { scene, styles, lists, svg } = fixture(); lists.labels = []; lists.panels = []
    styles.set(svg, { overflow: 'hidden' })
    expect(chartExportBounds(scene, { width: 100, height: 80 })).toEqual({ x: -2, y: -2, width: 104, height: 84 })
    styles.set(svg, { overflow: 'visible' })
    expect(chartExportBounds(scene, { width: 100, height: 80 }).x).toBe(-30)
  })
  it('incluye voladizo cursivo del texto SVG y todas las líneas de getBBox', () => {
    const { scene, styles, shape, lists } = fixture(); lists.labels = []; lists.panels = []
    shape.localName = 'text'; shape.getBBox = () => rect(-10, -8, 120, 40)
    styles.set(shape, { stroke: 'none', fill: '#000000', opacity: '1', fontStyle: 'italic', fontSize: '20px' })
    expect(chartExportBounds(scene, { width: 100, height: 80 })).toEqual({ x: -17, y: -10, width: 134, height: 92 })
  })
  it('la caja de contenido HTML recorta la cola y el voladizo antes de ampliar bounds', () => {
    const { scene, styles, label, lists } = fixture(); lists.shapes = []; lists.panels = []
    styles.set(label, { overflow: 'hidden', opacity: '1', fontStyle: 'italic', fontSize: '20px' })
    expect(chartExportBounds(scene, { width: 100, height: 80 })).toEqual({ x: -2, y: -2, width: 104, height: 84 })
    styles.set(label, { overflow: 'visible', opacity: '1', fontStyle: 'italic', fontSize: '20px' })
    expect(chartExportBounds(scene, { width: 100, height: 80 })).toEqual({ x: -22, y: -2, width: 124, height: 84 })
  })
  it('incluye sombra e2 y mide de nuevo cambios reales después del encuadre', () => {
    const { scene, panel, lists } = fixture(); lists.shapes = []; lists.labels = []; panel.dataset.chartShadow = 'e2'
    const before = chartExportBounds(scene, { width: 100, height: 80 })
    expect(before).toEqual({ x: -32, y: -10, width: 134, height: 104 })
    scene.style.setProperty('transform', 'translate(64px, 20px) scale(2)', 'important')
    scene.style.setProperty('zoom', '1.75'); scene.style.setProperty('transform-origin', '0 0')
    expect(chartExportBounds(scene, { width: 100, height: 80 })).toEqual(before)
    expect(scene.style.getPropertyValue('transform')).toBe('translate(64px, 20px) scale(2)'); expect(scene.style.getPropertyPriority('transform')).toBe('important')
    expect(scene.style.getPropertyValue('zoom')).toBe('1.75'); expect(scene.style.getPropertyValue('transform-origin')).toBe('0 0')
    panel.getBoundingClientRect = () => rect(120, 30, 30, 20)
    expect(chartExportBounds(scene, { width: 100, height: 80 }).width).toBe(184)
  })
  it('restaura transform/prioridad si DOM, CTM o extensión exceden su contrato', () => {
    const { scene, shape } = fixture(); scene.style.setProperty('transform', 'scale(2)', 'important')
    shape.getBBox = () => rect(-40000, 0, 10, 10)
    expect(() => chartExportBounds(scene, { width: 100, height: 80 })).toThrow('Chart bounds exceed limits')
    expect(scene.style.getPropertyValue('transform')).toBe('scale(2)'); expect(scene.style.getPropertyPriority('transform')).toBe('important')
    scene.getBoundingClientRect = () => { throw new Error('layout unavailable') }
    expect(() => chartExportBounds(scene, { width: 100, height: 80 })).toThrow('layout unavailable')
    expect(scene.style.getPropertyValue('transform')).toBe('scale(2)')
  })
  it('cuenta el overflow tipográfico real antes de compensar zoom, sin relajar límites al reducirlo', () => {
    const { scene, label, lists } = fixture(); lists.shapes = []; lists.panels = []
    label.ranges = [rect(10, 20, 20000, 18)]
    expect(chartExportBounds(scene, { width: 100, height: 80 }, 1).width).toBe(20004)
    expect(() => chartExportBounds(scene, { width: 100, height: 80 }, 2)).toThrow('Chart bounds exceed limits')
    label.ranges = [rect(10, 20, 40000, 18)]
    expect(() => chartExportBounds(scene, { width: 100, height: 80 }, .125)).toThrow('Chart bounds exceed limits')
  })
})

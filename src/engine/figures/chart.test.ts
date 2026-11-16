import { describe, expect, it, vi } from 'vitest'
import type { ChartRenderSceneV1, ChartSvgLayer } from '@shared/figuresChart'
import { CHART_LIMITS, chartGeometryNodes, prepareChartRenderContext, validateChartRenderScene as validate } from './chart'
import { chartPaintFixture, chartSceneFixture as fixture, chartTextFixture } from './testing'

const svg = (scene: ChartRenderSceneV1): ChartSvgLayer => scene.layers[0] as ChartSvgLayer
describe('DTO cerrado de Chart', () => {
  it.each([['bar', 'vertical-bars'], ['bar', 'horizontal-bars'], ['histogram', 'vertical-bars'], ['line', 'cartesian'], ['area', 'cartesian'], ['scatter', 'cartesian'], ['pie', 'donut']] as const)('acepta %s/%s y copia sin compartir referencias', (chartKind, branch) => {
    const source = fixture(); source.chartKind = chartKind; source.branch = branch
    const result = validate(source)
    expect(result).toEqual(source); expect(svg(result).primitives).not.toBe(svg(source).primitives)
    source.layers.length = 0
    expect(result.layers).toHaveLength(3)
  })
  it.each(['bar', 'histogram', 'line', 'area', 'scatter', 'pie'] as const)('conserva leyenda y panel vacío de %s, sin SVG', chartKind => {
    const source = fixture(); source.chartKind = chartKind; source.branch = 'empty'; source.layers.shift()
    expect(validate(source)).toEqual(source)
  })
  it('no reconstruye ramas ni admite varios SVG, tipos mezclados o SVG de tamaño cero', () => {
    for (const change of [
      (s: ChartRenderSceneV1) => { s.chartKind = 'histogram'; s.branch = 'horizontal-bars' },
      (s: ChartRenderSceneV1) => { s.branch = 'donut' },
      (s: ChartRenderSceneV1) => { s.layers.push(structuredClone(s.layers[0])) },
      (s: ChartRenderSceneV1) => { s.branch = 'empty' },
      (s: ChartRenderSceneV1) => { s.layers.shift() },
      (s: ChartRenderSceneV1) => { svg(s).box.width = 0 }
    ]) { const source = fixture(); change(source); expect(() => validate(source)).toThrow('Invalid figure export') }
  })
  it.each([.125, 1, 1.75, 8])('mantiene CSS zoom %s y el texto de la hoja montada sin interpretación', cssZoom => {
    const source = fixture(); source.metrics.cssZoom = cssZoom
    const text = chartTextFixture(); text.text = '**texto** $x$ <img src="file:///private"> https://example.invalid/ العربية 👨‍👩‍👧‍👦 COLA'; source.layers.push(text)
    expect(validate(source)).toEqual(source)
  })
  it.each([0, .124, 8.001, Infinity, NaN, '1.75', '175%', 'var(--zoom)', undefined])('rechaza zoom activo o fuera de límites %s', cssZoom => {
    const source = fixture(); Object.assign(source.metrics, { cssZoom }); expect(() => validate(source)).toThrow()
  })
  it.each([1 / 16, 1, 3.875, 64])('transporta EffectiveZoom Float32 %s separado del zoom CSS', rawEffectiveZoom => {
    const source = fixture(); source.metrics.rawEffectiveZoom = rawEffectiveZoom
    expect(validate(source).metrics).toEqual(source.metrics)
  })
  it.each([0, 1 / 32, 65, 1.1, NaN, Infinity, '2', undefined])('rechaza EffectiveZoom ambiguo o fuera del dominio %s', rawEffectiveZoom => {
    const source = fixture(); Object.assign(source.metrics, { rawEffectiveZoom })
    expect(() => validate(source)).toThrow('Invalid figure export')
  })
  it('no ejecuta accessors de EffectiveZoom ni acepta señales de emulación o zoom ajenas al DTO', () => {
    const source = fixture(), getter = vi.fn(() => 2)
    Object.defineProperty(source.metrics, 'rawEffectiveZoom', { enumerable: true, get: getter })
    expect(() => validate(source)).toThrow(); expect(getter).not.toHaveBeenCalled()
    const extra = fixture(); Object.assign(extra.metrics, { initialZoom: 2, inspectorOverride: 1 })
    expect(() => validate(extra)).toThrow()
  })
  it('prepara la rejilla fuente bajo otro InitialZoom privado sin sustituirla por cssZoom', () => {
    const source = fixture(); source.metrics.rawEffectiveZoom = 3.5; source.metrics.cssZoom = 1.75
    const before = structuredClone(source)
    expect(prepareChartRenderContext(source, 2)).toEqual({ initialZoom: 2, effectiveZoom: 3.5, wrapperZoom: 1.75, paintScale: 2 / 3.5 })
    expect(prepareChartRenderContext(source, 1)).toEqual({ initialZoom: 1, effectiveZoom: 3.5, wrapperZoom: 3.5, paintScale: 1 / 3.5 })
    expect(source).toEqual(before)
    source.metrics.rawEffectiveZoom = 3.875
    const context = prepareChartRenderContext(source, 1.25)
    expect(context.wrapperZoom).toBe(Math.fround(3.1))
    expect(context.paintScale).toBe(1.25 / 3.875)
    expect(Math.fround(context.paintScale)).not.toBe(Math.fround(1 / context.wrapperZoom))
    expect(Object.isFrozen(context)).toBe(true)
  })
  it('revalida recursos bajo el wrapper real antes de reducir la pintura', () => {
    for (const change of [
      (s: ChartRenderSceneV1) => { s.canvas.width = 9000 },
      (s: ChartRenderSceneV1) => { Object.assign(svg(s).primitives[0], { strokeWidth: 200 }) },
      (s: ChartRenderSceneV1) => { Object.assign(s.layers[2], { size: 200 }) },
      (s: ChartRenderSceneV1) => { Object.assign(svg(s).primitives[0], { d: 'M0 0L20000 0' }) }
    ]) {
      const source = fixture(); source.metrics.rawEffectiveZoom = 2; change(source)
      expect(validate(source)).toEqual(source)
      expect(prepareChartRenderContext(source, 2).wrapperZoom).toBe(1)
      expect(() => prepareChartRenderContext(source, 1)).toThrow('exceeds export limits')
    }
    const source = fixture(); source.metrics.rawEffectiveZoom = 64
    expect(() => prepareChartRenderContext(source, 1)).toThrow()
    expect(prepareChartRenderContext(source, 8).wrapperZoom).toBe(8)
  })
  it('rechaza accessors sin invocarlos, prototipos, símbolos y propiedades no enumerables', () => {
    const getter = vi.fn(() => 1), active = fixture(); Object.defineProperty(active.metrics, 'cssZoom', { get: getter, enumerable: true })
    const kind = fixture(); Object.defineProperty(kind.layers[0], 'kind', { get: getter, enumerable: true })
    const proto = Object.assign(Object.create({}), fixture()), symbol = fixture(); Object.assign(symbol, { [Symbol('extra')]: 1 })
    const hidden = fixture(); Object.defineProperty(hidden.canvas, 'width', { value: 100, enumerable: false })
    const extra = fixture(); Object.assign(extra.layers[0], { sourceBlock: { title: 'secret' } })
    for (const source of [active, kind, proto, symbol, hidden, extra]) expect(() => validate(source)).toThrow('Invalid figure export')
    expect(getter).not.toHaveBeenCalled()
  })
  it('todos los arrays son densos, propios y sin getters o propiedades extra', () => {
    const getter = vi.fn(() => chartTextFixture())
    for (const change of [
      (s: ChartRenderSceneV1) => { s.layers = new Array(2) },
      (s: ChartRenderSceneV1) => { Object.setPrototypeOf(s.layers, Object.create(Array.prototype)) },
      (s: ChartRenderSceneV1) => { Object.defineProperty(s.layers, '0', { get: getter, enumerable: true }) },
      (s: ChartRenderSceneV1) => { Object.assign(svg(s).primitives, { extra: 1 }) },
      (s: ChartRenderSceneV1) => { Object.assign(svg(s).primitives[0], { dash: new Array(2) }) },
      (s: ChartRenderSceneV1) => { Object.assign(svg(s).primitives[4], { lines: new Array(2) }) },
      (s: ChartRenderSceneV1) => { svg(s).primitives.push(s.layers[0] as unknown as ChartSvgLayer['primitives'][0]) }
    ]) { const source = fixture(); change(source); expect(() => validate(source)).toThrow('Invalid figure export') }
    expect(getter).not.toHaveBeenCalled()
  })
  it('CSS de recorte cerrado conserva toda la hoja, pero exige nowrap y hidden', () => {
    const source = fixture(), text = chartTextFixture(); source.layers.push(text)
    text.box.width = 0; text.text = 'Texto completo detrás del recorte'
    expect(validate(source)).toEqual(source)
    text.whiteSpace = 'normal'; expect(() => validate(source)).toThrow()
    text.whiteSpace = 'nowrap'; text.overflow = 'visible'; expect(() => validate(source)).toThrow()
    text.truncate = false; expect(validate(source)).toEqual(source)
    Object.assign(text, { font: 'url(file:///font)' }); expect(() => validate(source)).toThrow()
  })
  it.each(['red', 'var(--surface)', 'url(https://private)', 'rgb(1,2,3)', '#123', '#123456789'])('rechaza color no concreto %s', color => {
    const source = fixture(); source.appearance.palette.text = color; expect(() => validate(source)).toThrow()
  })
  it('exige papel opaco, números finitos y enums de pintura cerrados', () => {
    const source = fixture(); source.appearance.palette.paper = '#ffffff80'; expect(() => validate(source)).toThrow()
    for (const fields of [{ opacity: NaN }, { strokeWidth: Infinity }, { strokeLinecap: 'square' }, { strokeLinejoin: 'bevel' }, { dash: [0, 0] }, { fillOpacity: 1.1 }, { strokeOpacity: -.1 }]) {
      const source = fixture(); Object.assign(svg(source).primitives[0], fields); expect(() => validate(source)).toThrow()
    }
  })
  it.each(['', 'M0 0 L', 'M0,,0L10 10', 'M0 0L1e999 1', 'M0 0<script>', 'M0 0A1 2 0 8 0 3 4', 'M0 0l900000 0 900000 0', 'M0 0A0.000001 100 0 0 1 10 0'])('rechaza path malformado/expansivo %s', d => {
    const source = fixture(); Object.assign(svg(source).primitives[0], { d }); expect(() => validate(source)).toThrow()
  })
  it('cuenta dimensiones, extensión y métricas de todos los tipos antes de compensar zoom', () => {
    const changes: Array<(scene: ChartRenderSceneV1) => void> = [
      s => { s.canvas.width = 9000 }, s => { s.canvas.height = 9000 }, s => { svg(s).box.width = 9000 },
      s => { svg(s).box.x = -20000 }, s => { Object.assign(svg(s).primitives[0], { d: 'M0 0L20000 0' }) },
      s => { Object.assign(svg(s).primitives[0], { strokeWidth: 200 }) }, s => { Object.assign(svg(s).primitives[0], { dash: [200] }) },
      s => { Object.assign(svg(s).primitives[1], { width: 9000 }) }, s => { Object.assign(svg(s).primitives[1], { rx: 200 }) },
      s => { Object.assign(svg(s).primitives[2], { rx: 9000 }) }, s => { Object.assign(svg(s).primitives[3], { x2: 20000 }) },
      s => { Object.assign(svg(s).primitives[4], { size: 200 }) }, s => { Object.assign(svg(s).primitives[4], { lines: [{ text: 'x', x: 20000, dy: 0 }] }) },
      s => { s.layers[1].box.height = 9000 }, s => { Object.assign(s.layers[1], { radius: 200 }) }, s => { Object.assign(s.layers[1], { borderWidth: 200 }) },
      s => { Object.assign(s.layers[2], { size: 200 }) }, s => { Object.assign(s.layers[2], { lineHeight: 200 }) }, s => { Object.assign(s.layers[2], { letterSpacing: -20 }) }
    ]
    for (const change of changes) {
      const source = fixture(); change(source); expect(validate(source)).toEqual(source)
      source.metrics.cssZoom = 2; expect(() => validate(source)).toThrow('exceeds export limits')
    }
    const source = fixture(); source.metrics.cssZoom = .125; Object.assign(svg(source).primitives[0], { d: 'M0 0L40000 0' })
    expect(() => validate(source)).toThrow('exceeds export limits')
  })
  it('acota coordenadas finales, baseline acumulado y radio real de los arcos', () => {
    for (const change of [
      (s: ChartRenderSceneV1) => { svg(s).box.x = 32700 },
      (s: ChartRenderSceneV1) => { Object.assign(svg(s).primitives[2], { cx: 32700, rx: 100 }) },
      (s: ChartRenderSceneV1) => { Object.assign(svg(s).primitives[4], { lines: [{ text: 'a', x: 0, dy: 20000 }, { text: 'b', x: 0, dy: 20000 }] }) },
      (s: ChartRenderSceneV1) => { Object.assign(svg(s).primitives[0], { d: 'M0 0 A1 100 0 0 1 1000 0' }) }
    ]) { const source = fixture(); change(source); expect(() => validate(source)).toThrow('exceeds export limits') }
  })
  it('admite 6000 puntos simples y cuenta spans vacíos, textos HTML y wrapper contra el DOM', () => {
    const source = fixture(); source.layers = [svg(source)]
    svg(source).primitives = Array.from({ length: 6000 }, () => ({ kind: 'ellipse', cx: 1, cy: 1, rx: 2, ry: 2, ...chartPaintFixture() }))
    expect(chartGeometryNodes(source)).toBe(6003); expect(validate(source)).toEqual(source)
    svg(source).primitives = Array.from({ length: 3331 }, () => ({ kind: 'text', x: 0, y: 0, size: 12, weight: 400, color: '#000000', anchor: 'start', tabular: false, lines: [{ text: '', x: 0, dy: 0 }] }))
    svg(source).primitives.push(...Array.from({ length: 2 }, () => ({ kind: 'ellipse' as const, cx: 1, cy: 1, rx: 2, ry: 2, ...chartPaintFixture() })))
    source.layers.push(chartTextFixture())
    expect(chartGeometryNodes(source)).toBe(CHART_LIMITS.maxDomNodes); expect(validate(source)).toEqual(source)
    source.metrics.cssZoom = 1.75
    expect(chartGeometryNodes(source)).toBe(CHART_LIMITS.maxDomNodes); expect(validate(source)).toEqual(source)
    svg(source).primitives.push({ kind: 'ellipse', cx: 1, cy: 1, rx: 2, ry: 2, ...chartPaintFixture() })
    expect(chartGeometryNodes(source)).toBe(CHART_LIMITS.maxDomNodes + 1); expect(() => validate(source)).toThrow('exceeds export limits')
  })
  it('acota texto UTF-8 por hoja y agregado, bytes completos y todos los números de path', () => {
    const text = fixture(), label = chartTextFixture(); label.text = 'x'.repeat(CHART_LIMITS.maxLabelBytes)
    text.layers.push(...Array.from({ length: 9 }, () => structuredClone(label))); expect(() => validate(text)).toThrow('exceeds export limits')
    text.layers = [svg(text), { ...label, text: '🙂'.repeat(2049) }]; expect(() => validate(text)).toThrow('exceeds export limits')
    const path = fixture(); svg(path).primitives = Array.from({ length: 5 }, () => ({ kind: 'path', d: `M0 0 ${'L0 0 '.repeat(15999)}`, ...chartPaintFixture() }))
    expect(() => validate(path)).toThrow('exceeds export limits')
    const bytes = fixture(); svg(bytes).primitives = Array.from({ length: 6000 }, () => ({ kind: 'ellipse', cx: 1, cy: 1, rx: 2, ry: 2, ...chartPaintFixture(), dash: Array(16).fill(1.2345678901234567) }))
    expect(() => validate(bytes)).toThrow('exceeds export limits')
  })
})

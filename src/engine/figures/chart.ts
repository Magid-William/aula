// Escena de presentación cerrada: texto plano y geometría, sin datos originales ni recursos.
import type { ChartBox, ChartLayer, ChartPaint, ChartRenderSceneV1, ChartSvgPrimitive } from '@shared/figuresChart'
import { FIGURE_RENDER_LIMITS } from '@shared/figuresRender'
import { FIGURE_CSS_ZOOM_LIMITS } from '@shared/figuresTypography'
import { FigureSceneReader, failFigure as fail } from './render-reader'

export const CHART_LIMITS = {
  maxBytes: 2 * 1024 * 1024, maxPrimitives: 10_000, maxPathNumbers: 128_000,
  maxTextBytes: 64 * 1024, maxLabelBytes: 8 * 1024, maxDomNodes: 10_000, ...FIGURE_RENDER_LIMITS
} as const

/** Incluye todos los elementos y nodos de texto, incluso líneas vacías, antes de crear DOM. */
export function chartGeometryNodes(scene: ChartRenderSceneV1): number {
  return 1 + (scene.metrics.cssZoom === 1 ? 0 : 1) + scene.layers.reduce((sum, layer) => sum + (layer.kind === 'svg'
    ? 1 + layer.primitives.reduce((n, primitive) => n + (primitive.kind === 'text' ? 1 + primitive.lines.length * 2 : 1), 0)
    : layer.kind === 'html-text' ? 2 : 1), 0)
}

const paintKeys = ['fill', 'stroke', 'fillOpacity', 'strokeOpacity', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'opacity', 'dash'] as const
class Reader extends FigureSceneReader {
  private resourceZoom = 1
  constructor() { super({ ...CHART_LIMITS, strictArrays: true }) }
  zoom(value: unknown): number {
    const zoom = this.number(value, FIGURE_CSS_ZOOM_LIMITS.min, FIGURE_CSS_ZOOM_LIMITS.max)
    this.resourceZoom = Math.max(1, zoom)
    return zoom
  }
  override color(value: unknown, none = false): string {
    const color = this.string(value, 9)
    if (!(none && color === 'none') && !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color)) fail()
    return color
  }
  kind(value: unknown): unknown {
    if (!value || typeof value !== 'object') return fail()
    const descriptor = Object.getOwnPropertyDescriptor(value, 'kind')
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail()
    return descriptor.value
  }
  extent(...values: number[]): void {
    if (values.some(value => !Number.isFinite(value) || Math.abs(value) * this.resourceZoom > CHART_LIMITS.maxSceneExtent)) fail(true)
  }
  coordinate(value: unknown): number {
    const coordinate = this.number(value, -Number.MAX_VALUE, Number.MAX_VALUE)
    this.extent(coordinate)
    return coordinate
  }
  dimension(value: unknown, min = 0): number {
    const dimension = this.number(value, min, Number.MAX_VALUE)
    if (dimension * this.resourceZoom > CHART_LIMITS.maxLayoutDimension) fail(true)
    return dimension
  }
  metric(value: unknown, min = 0, max = 256, effectiveMax = max): number {
    const number = this.number(value, min, max)
    if (Math.abs(number) * this.resourceZoom > effectiveMax) fail(true)
    return number
  }
  box(value: unknown): ChartBox {
    const v = this.object(value, ['x', 'y', 'width', 'height'])
    const box = { x: this.coordinate(v.x), y: this.coordinate(v.y), width: this.dimension(v.width), height: this.dimension(v.height) }
    this.extent(box.x + box.width, box.y + box.height)
    return box
  }
  text(value: unknown): string {
    const before = this.bytes, text = this.string(value, CHART_LIMITS.maxLabelBytes, true)
    this.texts += this.bytes - before
    if (this.texts > CHART_LIMITS.maxTextBytes) fail(true)
    return text
  }
  paint(v: Record<string, unknown>): ChartPaint {
    const dash = this.array(v.dash, 16, n => this.metric(n))
    if (dash.length && dash.every(n => n === 0)) fail()
    return {
      fill: this.color(v.fill, true), stroke: this.color(v.stroke, true), fillOpacity: this.number(v.fillOpacity, 0, 1), strokeOpacity: this.number(v.strokeOpacity, 0, 1),
      strokeWidth: this.metric(v.strokeWidth), strokeLinecap: this.enum(v.strokeLinecap, ['butt', 'round']), strokeLinejoin: this.enum(v.strokeLinejoin, ['miter', 'round']),
      opacity: this.number(v.opacity, 0, 1), dash
    }
  }
  svgPrimitive(value: unknown, box: ChartBox): ChartSvgPrimitive {
    this.primitive()
    const check = (extent: number, stroke = 0): void => this.extent(extent + stroke * 2 + Math.abs(box.x), extent + stroke * 2 + Math.abs(box.y))
    switch (this.kind(value)) {
      case 'path': {
        const v = this.object(value, ['kind', 'd', ...paintKeys]), paint = this.paint(v), d = this.path(v.d)
        check(this.pathExtent.get(d) ?? 0, paint.strokeWidth)
        return { kind: this.enum(v.kind, ['path']), d, ...paint }
      }
      case 'rect': {
        const v = this.object(value, ['kind', 'x', 'y', 'width', 'height', 'rx', ...paintKeys]), paint = this.paint(v)
        const x = this.coordinate(v.x), y = this.coordinate(v.y), width = this.dimension(v.width), height = this.dimension(v.height), rx = this.metric(v.rx)
        check(Math.max(Math.abs(x) + width, Math.abs(y) + height), paint.strokeWidth)
        return { kind: this.enum(v.kind, ['rect']), x, y, width, height, rx, ...paint }
      }
      case 'ellipse': {
        const v = this.object(value, ['kind', 'cx', 'cy', 'rx', 'ry', ...paintKeys]), paint = this.paint(v)
        const cx = this.coordinate(v.cx), cy = this.coordinate(v.cy), rx = this.dimension(v.rx), ry = this.dimension(v.ry)
        check(Math.max(Math.abs(cx) + rx, Math.abs(cy) + ry), paint.strokeWidth)
        return { kind: this.enum(v.kind, ['ellipse']), cx, cy, rx, ry, ...paint }
      }
      case 'line': {
        const v = this.object(value, ['kind', 'x1', 'y1', 'x2', 'y2', ...paintKeys]), paint = this.paint(v)
        const x1 = this.coordinate(v.x1), y1 = this.coordinate(v.y1), x2 = this.coordinate(v.x2), y2 = this.coordinate(v.y2)
        check(Math.max(Math.abs(x1), Math.abs(y1), Math.abs(x2), Math.abs(y2)), paint.strokeWidth)
        return { kind: this.enum(v.kind, ['line']), x1, y1, x2, y2, ...paint }
      }
      case 'text': {
        const v = this.object(value, ['kind', 'x', 'y', 'color', 'size', 'weight', 'anchor', 'tabular', 'lines'])
        const x = this.coordinate(v.x), y = this.coordinate(v.y), size = this.metric(v.size, 1)
        let baseline = y
        const lines = this.array(v.lines, CHART_LIMITS.maxPrimitives, value => {
          this.primitive()
          const line = this.object(value, ['text', 'x', 'dy']), text = this.text(line.text), x = this.coordinate(line.x), dy = this.coordinate(line.dy)
          baseline += dy
          check(Math.max(Math.abs(x), Math.abs(baseline)) + size)
          return { text, x, dy }
        })
        if (!lines.length) fail()
        check(Math.max(Math.abs(x), Math.abs(y)) + size)
        return { kind: this.enum(v.kind, ['text']), x, y, color: this.color(v.color), size, weight: this.enum(v.weight, [400, 500, 600]), anchor: this.enum(v.anchor, ['start', 'middle', 'end']), tabular: this.bool(v.tabular), lines }
      }
      default: return fail()
    }
  }
  layer(value: unknown): ChartLayer {
    this.primitive()
    switch (this.kind(value)) {
      case 'svg': {
        const v = this.object(value, ['kind', 'box', 'overflow', 'primitives']), box = this.box(v.box)
        if (!box.width || !box.height) fail()
        return { kind: this.enum(v.kind, ['svg']), box, overflow: this.enum(v.overflow, ['visible', 'hidden']), primitives: this.array(v.primitives, CHART_LIMITS.maxPrimitives, item => this.svgPrimitive(item, box)) }
      }
      case 'panel': {
        const v = this.object(value, ['kind', 'box', 'background', 'border', 'borderWidth', 'radius', 'shadow', 'opacity']), box = this.box(v.box)
        const borderWidth = this.metric(v.borderWidth), radius = this.metric(v.radius), shadow = this.enum(v.shadow, ['none', 'e2'])
        this.extent(Math.abs(box.x) + box.width + (shadow === 'e2' ? 40 : 0), Math.abs(box.y) + box.height + (shadow === 'e2' ? 62 : 0))
        return { kind: this.enum(v.kind, ['panel']), box, background: this.color(v.background, true), border: this.color(v.border, true), borderWidth, radius, shadow, opacity: this.number(v.opacity, 0, 1) }
      }
      case 'html-text': {
        const v = this.object(value, ['kind', 'box', 'text', 'color', 'font', 'italic', 'size', 'lineHeight', 'weight', 'letterSpacing', 'tabular', 'direction', 'align', 'whiteSpace', 'overflow', 'truncate', 'opacity'])
        const box = this.box(v.box), whiteSpace = this.enum(v.whiteSpace, ['normal', 'nowrap']), overflow = this.enum(v.overflow, ['visible', 'hidden']), truncate = this.bool(v.truncate)
        if (truncate && (whiteSpace !== 'nowrap' || overflow !== 'hidden')) fail()
        return {
          kind: this.enum(v.kind, ['html-text']), box, text: this.text(v.text), color: this.color(v.color), font: this.enum(v.font, ['sans', 'serif', 'mono', 'rounded']), italic: this.bool(v.italic),
          size: this.metric(v.size, 1), lineHeight: this.metric(v.lineHeight, 1), weight: this.enum(v.weight, [400, 500, 600]), letterSpacing: this.metric(v.letterSpacing, -32, 32), tabular: this.bool(v.tabular),
          direction: this.enum(v.direction, ['ltr', 'rtl']), align: this.enum(v.align, ['left', 'right', 'center', 'start', 'end']), whiteSpace, overflow, truncate, opacity: this.number(v.opacity, 0, 1)
        }
      }
      default: return fail()
    }
  }
}

export function validateChartRenderScene(value: unknown): ChartRenderSceneV1 {
  const r = new Reader(), v = r.object(value, ['version', 'family', 'chartKind', 'branch', 'canvas', 'metrics', 'appearance', 'layers', 'output'])
  const c = r.object(v.canvas, ['width', 'height']), m = r.object(v.metrics, ['rootFontPx', 'bodyFont', 'bodyItalic', 'cssZoom']), o = r.object(v.output, ['scale'])
  // El zoom se valida antes de leer dimensiones, trazos o métricas de texto.
  const cssZoom = r.zoom(m.cssZoom)
  const a = r.object(v.appearance, ['theme', 'language', 'direction', 'palette']), p = r.object(a.palette, ['paper', 'text', 'text2', 'text3', 'link', 'accent', 'brick'])
  const language = r.string(a.language, 32), paper = r.color(p.paper)
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language) || paper.length !== 7) fail()
  const scene: ChartRenderSceneV1 = {
    version: r.enum(v.version, [1]), family: r.enum(v.family, ['chart']), chartKind: r.enum(v.chartKind, ['bar', 'line', 'area', 'pie', 'scatter', 'histogram']), branch: r.enum(v.branch, ['empty', 'vertical-bars', 'horizontal-bars', 'cartesian', 'donut']),
    canvas: { width: r.dimension(c.width, 1), height: r.dimension(c.height, 1) }, metrics: { rootFontPx: r.metric(m.rootFontPx, 8, 64, 256), bodyFont: r.enum(m.bodyFont, ['sans', 'serif', 'mono', 'rounded']), bodyItalic: r.bool(m.bodyItalic), cssZoom },
    appearance: { theme: r.enum(a.theme, ['light', 'dark']), language, direction: r.enum(a.direction, ['ltr', 'rtl']), palette: { paper, text: r.color(p.text), text2: r.color(p.text2), text3: r.color(p.text3), link: r.color(p.link), accent: r.color(p.accent), brick: r.color(p.brick) } },
    layers: r.array(v.layers, CHART_LIMITS.maxPrimitives, layer => r.layer(layer)), output: { scale: r.enum(o.scale, [2]) }
  }
  const allowed = { bar: ['vertical-bars', 'horizontal-bars'], histogram: ['vertical-bars'], line: ['cartesian'], area: ['cartesian'], scatter: ['cartesian'], pie: ['donut'] }
  if (scene.branch !== 'empty' && !allowed[scene.chartKind].includes(scene.branch)) fail()
  const svgs = scene.layers.filter(layer => layer.kind === 'svg').length
  if (svgs !== (scene.branch === 'empty' ? 0 : 1)) fail()
  if (chartGeometryNodes(scene) > CHART_LIMITS.maxDomNodes) fail(true)
  return scene
}

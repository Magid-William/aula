// DTO de presentación cerrado: geometría, texto visible y colores concretos, nunca recursos o CSS libre.
import { FIGURE_RENDER_LIMITS } from '@shared/figuresRender'
import { FIGURE_CSS_ZOOM_LIMITS } from '@shared/figuresTypography'
import type { DiagramCircle, DiagramInk, DiagramLabel, DiagramLeaf, DiagramPrimitive, DiagramRenderBox, DiagramRenderSceneV1, DiagramTextLine } from '@shared/figuresDiagram'
import { FigureSceneReader, failFigure as fail } from './render-reader'

export const DIAGRAM_LIMITS = {
  maxBytes: 2 * 1024 * 1024, maxPrimitives: 10_000, maxPathNumbers: 128_000,
  maxTextBytes: 64 * 1024, maxLabelBytes: 8 * 1024, maxDomNodes: 10_000,
  // Un grupo sólo contiene hojas: la profundidad de composición es exactamente uno.
  maxGroupDepth: 1, ...FIGURE_RENDER_LIMITS
} as const

function leafNodes(leaf: DiagramLeaf): number {
  switch (leaf.kind) {
    case 'path': case 'ellipse': return 2
    case 'ink': return 4 + leaf.strokes.length * 8
    case 'label': return 4 + leaf.lines.length * 4
    case 'venn-region': return 8 + leaf.include.length * 4 + leaf.exclude.length * 3
    default: { const exhaustive: never = leaf; return exhaustive }
  }
}

/** Incluye wrappers, defs, máscaras y nodos de texto plano; el Markdown añade su AST por separado. */
export function diagramGeometryNodes(scene: DiagramRenderSceneV1): number {
  return 2 + (scene.metrics.cssZoom === 1 ? 0 : 1) + scene.primitives.reduce((sum, primitive) => sum + (primitive.kind === 'group' ? 1 + primitive.children.reduce((n, leaf) => n + leafNodes(leaf), 0) : leafNodes(primitive)), 0)
}
export function diagramTexts(scene: DiagramRenderSceneV1): string[] {
  return scene.primitives.flatMap(primitive => (primitive.kind === 'group' ? primitive.children : [primitive]).flatMap(leaf => leaf.kind === 'label' ? leaf.lines.filter(line => line.content === 'rich').map(line => line.text) : []))
}

class Reader extends FigureSceneReader {
  private resourceZoom = 1
  constructor() { super({ ...DIAGRAM_LIMITS, strictArrays: true }) }
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
  coordinate(value: unknown): number {
    const coordinate = this.number(value, -DIAGRAM_LIMITS.maxSceneExtent, DIAGRAM_LIMITS.maxSceneExtent)
    this.extent(coordinate)
    return coordinate
  }
  dimension(value: unknown, min = .01): number {
    const dimension = this.number(value, min, DIAGRAM_LIMITS.maxLayoutDimension)
    if (dimension * this.resourceZoom > DIAGRAM_LIMITS.maxLayoutDimension) fail(true)
    return dimension
  }
  textMetric(value: unknown, min = 1, max = 256): number {
    const size = this.number(value, min, max)
    if (size * this.resourceZoom > 256) fail(true)
    return size
  }
  nullableDimension(value: unknown): number | null { if (value === null) { this.add(4); return null }; return this.dimension(value) }
  // La compensación visual no reduce el presupuesto de layout ni de pintura del contexto zoomado.
  extent(...values: number[]): void { if (values.some(value => !Number.isFinite(value) || Math.abs(value) * this.resourceZoom > DIAGRAM_LIMITS.maxSceneExtent)) fail(true) }
  box(value: unknown): DiagramRenderBox {
    const v = this.object(value, ['x', 'y', 'width', 'height'])
    const box = { x: this.coordinate(v.x), y: this.coordinate(v.y), width: this.dimension(v.width), height: this.dimension(v.height) }
    this.extent(box.x + box.width, box.y + box.height)
    return box
  }
  circle(value: unknown): DiagramCircle {
    this.primitive()
    const v = this.object(value, ['cx', 'cy', 'r'])
    const circle = { cx: this.coordinate(v.cx), cy: this.coordinate(v.cy), r: this.dimension(v.r) }
    this.extent(Math.abs(circle.cx) + circle.r, Math.abs(circle.cy) + circle.r)
    return circle
  }
  dash(value: unknown): number[] {
    const dash = this.array(value, 16, value => this.number(value, 0, 256))
    if (dash.length && dash.every(value => value === 0)) fail()
    return dash
  }
  line(value: unknown): DiagramTextLine {
    this.primitive()
    const v = this.object(value, ['text', 'content', 'color', 'font', 'size', 'lineHeight', 'weight', 'clamp', 'breakWords', 'fullWidth', 'height', 'marginTop', 'tabular'])
    const before = this.bytes, text = this.string(v.text, DIAGRAM_LIMITS.maxLabelBytes, true)
    this.texts += this.bytes - before
    if (this.texts > DIAGRAM_LIMITS.maxTextBytes) fail(true)
    return {
      text, content: this.enum(v.content, ['rich', 'plain']), color: this.color(v.color), font: this.enum(v.font, ['inherit', 'serif']),
      size: this.textMetric(v.size), lineHeight: this.textMetric(v.lineHeight), weight: this.enum(v.weight, [400, 500, 600]),
      clamp: this.enum(v.clamp, [0, 3, 6]), breakWords: this.bool(v.breakWords), fullWidth: this.bool(v.fullWidth),
      height: this.nullableDimension(v.height), marginTop: this.textMetric(v.marginTop, 0), tabular: this.bool(v.tabular)
    }
  }
  label(value: unknown): DiagramLabel {
    const v = this.object(value, ['kind', 'x', 'y', 'width', 'height', 'maxWidth', 'anchor', 'layout', 'align', 'vertical', 'paddingX', 'paddingY', 'wrap', 'truncate', 'shape', 'background', 'tint', 'border', 'borderWidth', 'shadow', 'opacity', 'lines'])
    const label: DiagramLabel = {
      kind: this.enum(v.kind, ['label']), x: this.coordinate(v.x), y: this.coordinate(v.y), width: this.nullableDimension(v.width), height: this.nullableDimension(v.height), maxWidth: this.nullableDimension(v.maxWidth),
      anchor: this.enum(v.anchor, ['top-left', 'center']), layout: this.enum(v.layout, ['block', 'column', 'grid', 'bottom']), align: this.enum(v.align, ['left', 'center', 'right']), vertical: this.enum(v.vertical, ['top', 'center', 'bottom']),
      paddingX: this.number(v.paddingX, 0, 256), paddingY: this.number(v.paddingY, 0, 256), wrap: this.enum(v.wrap, ['normal', 'nowrap']), truncate: this.bool(v.truncate),
      shape: this.enum(v.shape, ['none', 'box', 'round', 'circle', 'note']), background: this.color(v.background, true), tint: this.color(v.tint, true), border: this.color(v.border, true), borderWidth: this.number(v.borderWidth, 0, 256),
      shadow: this.enum(v.shadow, ['none', 'e1', 'e2']), opacity: this.number(v.opacity, 0, 1), lines: this.array(v.lines, 32, line => this.line(line))
    }
    if (!label.lines.length || label.layout !== 'column' && label.lines.length !== 1) fail()
    // La columna acumula alturas y márgenes aun sin height propio. Sin clamp, el wrapping
    // intrínseco se comprueba después con el DOM real; aquí contamos el mínimo explícito.
    const contentHeight = label.layout === 'column' ? label.lines.reduce((sum, line) => sum + line.marginTop + (line.height ?? line.lineHeight * Math.max(1, line.clamp)), 0) : 0
    this.extent(Math.abs(label.x) + (label.width ?? label.maxWidth ?? 0) + label.paddingX * 2 + label.borderWidth * 2 + 64, Math.abs(label.y) + Math.max(label.height ?? 0, contentHeight) + label.paddingY * 2 + label.borderWidth * 2 + 64)
    return label
  }
  ink(value: unknown): DiagramInk {
    const v = this.object(value, ['kind', 'box', 'viewWidth', 'viewHeight', 'color', 'opacity', 'strokes'])
    // El viewBox está en unidades SVG; sólo box y la extensión transformada consumen layout CSS.
    const box = this.box(v.box), viewWidth = this.number(v.viewWidth, .01, DIAGRAM_LIMITS.maxLayoutDimension), viewHeight = this.number(v.viewHeight, .01, DIAGRAM_LIMITS.maxLayoutDimension)
    const k = Math.max(box.width / viewWidth, box.height / viewHeight)
    if (k > 100) fail(true)
    const strokes = this.array(v.strokes, 100, value => {
      this.primitive()
      const hasDry = !!value && typeof value === 'object' && Object.hasOwn(value, 'dry')
      const s = this.object(value, hasDry ? ['d', 'spine', 'reach', 'dry', 'dryWidth'] : ['d', 'spine', 'reach'])
      const stroke = { d: this.path(s.d), spine: this.path(s.spine), reach: this.number(s.reach, 0, 256), ...(hasDry ? { dry: this.path(s.dry, true), dryWidth: this.number(s.dryWidth, 0, 256) } : {}) }
      const extent = Math.max(this.pathExtent.get(stroke.d) ?? 0, this.pathExtent.get(stroke.spine) ?? 0, this.pathExtent.get(stroke.dry ?? '') ?? 0)
      this.extent((extent + stroke.reach + (stroke.dryWidth ?? 0)) * k + Math.abs(box.x), (extent + stroke.reach + (stroke.dryWidth ?? 0)) * k + Math.abs(box.y))
      return stroke
    })
    if (!strokes.length) fail()
    return { kind: this.enum(v.kind, ['ink']), box, viewWidth, viewHeight, color: this.color(v.color), opacity: this.number(v.opacity, 0, 1), strokes }
  }
  leaf(value: unknown): DiagramLeaf {
    this.primitive()
    switch (this.kind(value)) {
      case 'path': {
        const v = this.object(value, ['kind', 'd', 'fill', 'stroke', 'strokeWidth', 'strokeLinejoin', 'opacity', 'dash', 'dashOffset'])
        const d = this.path(v.d), strokeWidth = this.number(v.strokeWidth, 0, 256)
        this.extent((this.pathExtent.get(d) ?? 0) + strokeWidth * 2)
        return { kind: this.enum(v.kind, ['path']), d, fill: this.color(v.fill, true), stroke: this.color(v.stroke, true), strokeWidth, strokeLinejoin: this.enum(v.strokeLinejoin, ['miter', 'round']), opacity: this.number(v.opacity, 0, 1), dash: this.dash(v.dash), dashOffset: this.coordinate(v.dashOffset) }
      }
      case 'ellipse': {
        const v = this.object(value, ['kind', 'cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'strokeWidth', 'opacity', 'dash'])
        const cx = this.coordinate(v.cx), cy = this.coordinate(v.cy), rx = this.dimension(v.rx), ry = this.dimension(v.ry), strokeWidth = this.number(v.strokeWidth, 0, 256)
        this.extent(Math.abs(cx) + rx + strokeWidth * 2, Math.abs(cy) + ry + strokeWidth * 2)
        return { kind: this.enum(v.kind, ['ellipse']), cx, cy, rx, ry, fill: this.color(v.fill, true), stroke: this.color(v.stroke, true), strokeWidth, opacity: this.number(v.opacity, 0, 1), dash: this.dash(v.dash) }
      }
      case 'ink': return this.ink(value)
      case 'label': return this.label(value)
      case 'venn-region': {
        const v = this.object(value, ['kind', 'include', 'exclude', 'fill'])
        const include = this.array(v.include, 3, circle => this.circle(circle)), exclude = this.array(v.exclude, 2, circle => this.circle(circle))
        if (!include.length || include.length + exclude.length > 3) fail()
        return { kind: this.enum(v.kind, ['venn-region']), include, exclude, fill: this.color(v.fill) }
      }
      default: return fail()
    }
  }
  diagramPrimitive(value: unknown): DiagramPrimitive {
    if (this.kind(value) !== 'group') return this.leaf(value)
    this.primitive()
    const v = this.object(value, ['kind', 'opacity', 'children'])
    // Hojas únicamente: un grupo anidado o cíclico falla antes de volver a descender.
    const children = this.array(v.children, DIAGRAM_LIMITS.maxPrimitives, leaf => this.leaf(leaf))
    if (!children.length) fail()
    return { kind: this.enum(v.kind, ['group']), opacity: this.number(v.opacity, 0, 1), children }
  }
}

export function validateDiagramRenderScene(value: unknown): DiagramRenderSceneV1 {
  const r = new Reader(), v = r.object(value, ['version', 'family', 'canvas', 'metrics', 'appearance', 'primitives', 'output'])
  const c = r.object(v.canvas, ['width', 'height']), m = r.object(v.metrics, ['rootFontPx', 'bodyFont', 'bodyItalic', 'cssZoom']), o = r.object(v.output, ['scale'])
  const cssZoom = r.zoom(m.cssZoom)
  const a = r.object(v.appearance, ['theme', 'language', 'direction', 'palette', 'background']), p = r.object(a.palette, ['paper', 'text', 'text2', 'text3', 'link', 'accent', 'brick']), b = r.object(a.background, ['kind', 'color', 'spacing', 'radius', 'fadeRadius'])
  const language = r.string(a.language, 32), paper = r.color(p.paper)
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language) || paper.length !== 7) fail()
  const scene: DiagramRenderSceneV1 = {
    version: r.enum(v.version, [1]), family: r.enum(v.family, ['flow', 'concept', 'tree', 'cycle', 'layers', 'pyramid', 'funnel', 'venn', 'mindmap']),
    canvas: { width: r.dimension(c.width, 1), height: r.dimension(c.height, 1) }, metrics: { rootFontPx: r.textMetric(m.rootFontPx, 8, 64), bodyFont: r.enum(m.bodyFont, ['sans', 'serif', 'mono', 'rounded']), bodyItalic: r.bool(m.bodyItalic), cssZoom },
    appearance: {
      theme: r.enum(a.theme, ['light', 'dark']), language, direction: r.enum(a.direction, ['ltr', 'rtl']),
      palette: { paper, text: r.color(p.text), text2: r.color(p.text2), text3: r.color(p.text3), link: r.color(p.link), accent: r.color(p.accent), brick: r.color(p.brick) },
      background: { kind: r.enum(b.kind, ['dots']), color: r.color(b.color), spacing: r.enum(b.spacing, [18]), radius: r.enum(b.radius, [1]), fadeRadius: r.enum(b.fadeRadius, [1.2]) }
    },
    primitives: r.array(v.primitives, DIAGRAM_LIMITS.maxPrimitives, primitive => r.diagramPrimitive(primitive)), output: { scale: r.enum(o.scale, [2]) }
  }
  if (diagramGeometryNodes(scene) > DIAGRAM_LIMITS.maxDomNodes) fail(true)
  return scene
}

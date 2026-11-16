// Frontera estricta: copia únicamente presentación conocida y cuenta recursos antes de serializar.
import { FIGURE_RENDER_LIMITS } from '@shared/figuresRender'
import { FIGURE_CSS_ZOOM_LIMITS } from '@shared/figuresTypography'
import { FigureSceneReader, failFigure as fail } from './render-reader'
import type { DrawingRenderSceneV1, PreparedDrawingPath, PreparedDrawingLabel, PreparedDrawingRing, PreparedVisibleItem } from '@shared/figuresDrawing'

export const DRAWING_LIMITS = { maxBytes: 2 * 1024 * 1024, maxItems: 500, maxPrimitives: 10_000, maxTextBytes: 64 * 1024, maxLabelBytes: 8 * 1024, ...FIGURE_RENDER_LIMITS } as const
class Reader extends FigureSceneReader {
  constructor() { super(DRAWING_LIMITS) }
  label(value: unknown): PreparedDrawingLabel {
    this.primitive()
    const v = this.object(value, ['x', 'y', 'size', 'anchor', 'text', 'color'])
    const before = this.bytes, text = this.string(v.text, DRAWING_LIMITS.maxLabelBytes)
    this.texts += this.bytes - before
    if (this.texts > DRAWING_LIMITS.maxTextBytes) fail(true)
    // Es fuente Markdown, nunca HTML ejecutable. El renderer estático rechaza nodos HTML/imágenes
    // tras analizar su AST; hacerlo con regex aquí confundiría fórmulas, código y escapes.
    return { x: this.number(v.x), y: this.number(v.y), size: this.number(v.size, 1, 256), anchor: this.enum(v.anchor, ['left', 'right', 'center']), text, color: this.color(v.color) }
  }
  drawingPath(value: unknown): PreparedDrawingPath {
    this.primitive()
    const v = this.object(value, ['d', 'fill', 'stroke', 'width', 'strokeOpacity', 'fillOpacity', 'dashed', 'offset'])
    const rawFill = v.fill as { kind?: unknown } | null
    // Leer kind sólo después de comprobar descriptores evita invocar getters.
    if (!rawFill || typeof rawFill !== 'object') return fail()
    const kind = Object.getOwnPropertyDescriptor(rawFill, 'kind')
    if (!kind || !('value' in kind)) return fail()
    const fill = kind.value === 'none' ? this.object(rawFill, ['kind']) : this.object(rawFill, ['kind', 'color'])
    const offset = this.object(v.offset, ['x', 'y'])
    return { d: this.path(v.d), fill: fill.kind === 'none' ? { kind: this.enum(fill.kind, ['none']) } : { kind: this.enum(fill.kind, ['solid', 'hatch']), color: this.color(fill.color) }, stroke: this.color(v.stroke, true), width: this.number(v.width, 0, 256), strokeOpacity: this.number(v.strokeOpacity, 0, 1), fillOpacity: this.number(v.fillOpacity, 0, 1), dashed: this.bool(v.dashed), offset: { x: this.number(offset.x), y: this.number(offset.y) } }
  }
  ring(value: unknown): PreparedDrawingRing {
    this.primitive()
    const v = this.object(value, ['x', 'y', 'width', 'height', 'viewWidth', 'viewHeight', 'color', 'strokes'])
    const width = this.number(v.width, .01, DRAWING_LIMITS.maxLayoutDimension), height = this.number(v.height, .01, DRAWING_LIMITS.maxLayoutDimension)
    const viewWidth = this.number(v.viewWidth, .01, DRAWING_LIMITS.maxLayoutDimension), viewHeight = this.number(v.viewHeight, .01, DRAWING_LIMITS.maxLayoutDimension)
    if (width / viewWidth > 100 || height / viewHeight > 100) fail(true)
    return { x: this.number(v.x), y: this.number(v.y), width, height, viewWidth, viewHeight, color: this.color(v.color), strokes: this.array(v.strokes, 100, value => {
      this.primitive(); const s = this.object(value, ['d', 'spine', 'reach', 'dry', 'dryWidth'])
      return { d: this.path(s.d), spine: this.path(s.spine), reach: this.number(s.reach, 0, 256), dry: this.path(s.dry, true), dryWidth: this.number(s.dryWidth, 0, 256) }
    }) }
  }
  item(value: unknown): PreparedVisibleItem {
    const v = this.object(value, ['sourceIndex', 'opacity', 'transform', 'paths', 'labels', 'rings']), t = this.object(v.transform, ['dx', 'dy', 'deg', 'px', 'py'])
    const sourceIndex = this.number(v.sourceIndex, 0, 9999)
    if (!Number.isInteger(sourceIndex)) fail()
    return { sourceIndex, opacity: this.number(v.opacity, 0, 1), transform: { dx: this.number(t.dx), dy: this.number(t.dy), deg: this.number(t.deg, -360_000, 360_000), px: this.number(t.px), py: this.number(t.py) }, paths: this.array(v.paths, DRAWING_LIMITS.maxPrimitives, x => this.drawingPath(x)), labels: this.array(v.labels, DRAWING_LIMITS.maxPrimitives, x => this.label(x)), rings: this.array(v.rings, DRAWING_LIMITS.maxPrimitives, x => this.ring(x)) }
  }
}

export function validateDrawingRenderScene(value: unknown): DrawingRenderSceneV1 {
  const r = new Reader(), v = r.object(value, ['version', 'canvas', 'metrics', 'appearance', 'items', 'output'])
  const c = r.object(v.canvas, ['width', 'height']), m = r.object(v.metrics, ['pixelWidth', 'layoutWidth', 'textK', 'unitsPerPx', 'rootFontPx', 'bodyFont', 'bodyItalic', 'cssZoom'])
  const a = r.object(v.appearance, ['theme', 'language', 'direction', 'palette']), p = r.object(a.palette, ['paper', 'text', 'text2', 'text3', 'brick', 'accent', 'link']), o = r.object(v.output, ['scale'])
  const canvas = { width: r.number(c.width, 1), height: r.number(c.height, 1) }
  const metrics = { pixelWidth: r.number(m.pixelWidth, 1, DRAWING_LIMITS.maxLayoutDimension), layoutWidth: r.number(m.layoutWidth, 1, DRAWING_LIMITS.maxLayoutDimension), textK: r.number(m.textK, .01, 16), unitsPerPx: r.number(m.unitsPerPx, .0001, 10_000), rootFontPx: r.number(m.rootFontPx, 8, 64), bodyFont: r.enum(m.bodyFont, ['sans', 'serif', 'mono', 'rounded']), bodyItalic: r.bool(m.bodyItalic), cssZoom: r.number(m.cssZoom, FIGURE_CSS_ZOOM_LIMITS.min, FIGURE_CSS_ZOOM_LIMITS.max) }
  const preparedK = metrics.pixelWidth / canvas.width, k = metrics.layoutWidth / canvas.width, expectedUnits = Math.round(metrics.textK / preparedK * 50) / 50
  if (Math.abs(metrics.unitsPerPx - expectedUnits) > 1e-6 || canvas.height * preparedK > DRAWING_LIMITS.maxLayoutDimension || canvas.height * k > DRAWING_LIMITS.maxLayoutDimension) fail(true)
  // El transform inverso conserva geometría natural, pero el layout interno debe respetar los mismos topes.
  const resourceZoom = Math.max(1, metrics.cssZoom)
  if (metrics.layoutWidth * resourceZoom > DRAWING_LIMITS.maxLayoutDimension || canvas.height * k * resourceZoom > DRAWING_LIMITS.maxLayoutDimension || metrics.rootFontPx * resourceZoom > 256) fail(true)
  const language = r.string(a.language, 32)
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) fail()
  const items = r.array(v.items, DRAWING_LIMITS.maxItems, value => r.item(value)), indices = new Set<number>()
  for (const item of items) {
    if (indices.has(item.sourceIndex)) fail()
    indices.add(item.sourceIndex)
    // El viewport provisional recorta pintura, pero tampoco acepta coordenadas CSS arbitrariamente lejanas.
    const t = item.transform, reach = (Math.abs(t.dx) + Math.abs(t.dy) + 2 * Math.abs(t.px) + 2 * Math.abs(t.py)) * k
    if (reach * resourceZoom > DRAWING_LIMITS.maxSceneExtent) fail(true)
    for (const path of item.paths) {
      const extent = ((r.pathExtent.get(path.d) ?? 0) * 2 + Math.abs(path.offset.x) + Math.abs(path.offset.y) + path.width * 2) * k + reach
      if (extent * resourceZoom > DRAWING_LIMITS.maxSceneExtent) fail(true)
    }
    for (const ring of item.rings) for (const stroke of ring.strokes) {
      const extent = Math.max(r.pathExtent.get(stroke.d) ?? 0, r.pathExtent.get(stroke.spine) ?? 0, r.pathExtent.get(stroke.dry) ?? 0)
      if ((extent + stroke.reach + stroke.dryWidth) * Math.max(ring.width / ring.viewWidth, ring.height / ring.viewHeight) * resourceZoom > DRAWING_LIMITS.maxSceneExtent) fail(true)
    }
    for (const label of item.labels) if (Math.max(Math.abs(label.x), Math.abs(label.y)) * k * resourceZoom > DRAWING_LIMITS.maxSceneExtent || label.size * resourceZoom > 256) fail(true)
    for (const ring of item.rings) if (Math.max(Math.abs(ring.x) + ring.width, Math.abs(ring.y) + ring.height) * resourceZoom > DRAWING_LIMITS.maxSceneExtent) fail(true)
  }
  return { version: r.enum(v.version, [1]), canvas, metrics, appearance: { theme: r.enum(a.theme, ['light', 'dark']), language, direction: r.enum(a.direction, ['ltr', 'rtl']), palette: { paper: r.color(p.paper), text: r.color(p.text), text2: r.color(p.text2), text3: r.color(p.text3), brick: r.color(p.brick), accent: r.color(p.accent), link: r.color(p.link) } }, items, output: { scale: r.enum(o.scale, [1, 2]) } }
}

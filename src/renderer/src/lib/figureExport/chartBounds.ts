// Medición natural: conserva zoom tipográfico interior y neutraliza sólo el encuadre exterior.
import type { FigureRenderBounds } from '@shared/figuresRender'
import { CHART_LIMITS, type ChartRenderContext } from '@engine/figures/chart'
import { unionDrawingBounds } from './drawingBounds'

export function chartExportBounds(scene: HTMLElement, nominal: { width: number; height: number }, cssZoom = 1, context?: ChartRenderContext): FigureRenderBounds {
  if (!Number.isFinite(cssZoom) || cssZoom < 1 / 8 || cssZoom > 8) throw new Error('Invalid chart zoom')
  const transform = scene.style.getPropertyValue('transform'), priority = scene.style.getPropertyPriority('transform')
  try {
    scene.style.setProperty('transform', 'none', 'important')
    if (context) assertChartRenderContext(scene, context)
    return naturalBounds(scene, nominal, Math.max(1, cssZoom, context?.wrapperZoom ?? 1))
  } finally {
    if (transform) scene.style.setProperty('transform', transform, priority)
    else scene.style.removeProperty('transform')
  }
}

/** Comprueba el mapa Float32 previsto, no una identidad CTM que Blink no promete. */
export function assertChartRenderContext(scene: HTMLElement, context: ChartRenderContext, framingScale = 1): void {
  if (!Number.isFinite(framingScale) || framingScale <= 0 || framingScale > 16) throw new Error('Invalid chart framing scale')
  if (scene.ownerDocument.defaultView?.devicePixelRatio !== context.initialZoom) throw new Error('Chart native zoom changed')
  const wrapper = scene.querySelector<HTMLElement>('[data-figure-css-zoom]')
  if (!wrapper || wrapper.currentCSSZoom !== Math.fround(context.effectiveZoom / context.initialZoom)) throw new Error('Chart wrapper zoom changed')
  const transformed = Math.fround(Math.fround(framingScale) * Math.fround(context.paintScale))
  const expected = context.effectiveZoom * Math.fround(Math.fround(1 / context.initialZoom) * transformed)
  for (const svg of wrapper.querySelectorAll<SVGSVGElement>('[data-chart-svg]')) {
    const matrix = svg.getScreenCTM()
    if (!matrix || matrix.a !== expected || matrix.d !== expected || matrix.b !== 0 || matrix.c !== 0) throw new Error('Chart effective paint transform changed')
  }
}

function naturalBounds(scene: HTMLElement, nominal: { width: number; height: number }, resourceZoom: number): FigureRenderBounds {
  const origin = scene.getBoundingClientRect(), boxes: FigureRenderBounds[] = [{ x: 0, y: 0, ...nominal }]
  if (scene.querySelectorAll('*').length > CHART_LIMITS.maxDomNodes) throw new Error('Chart DOM exceeds limits')
  const add = (x: number, y: number, width: number, height: number, clip?: DOMRect): void => {
    if (![x, y, width, height].every(Number.isFinite)) throw new Error('Invalid chart bounds')
    const left = clip ? Math.max(x, clip.left) : x, top = clip ? Math.max(y, clip.top) : y
    const right = clip ? Math.min(x + width, clip.right) : x + width, bottom = clip ? Math.min(y + height, clip.bottom) : y + height
    if (right > left && bottom > top) boxes.push({ x: left - origin.x, y: top - origin.y, width: right - left, height: bottom - top })
  }
  for (const shape of scene.querySelectorAll<SVGGraphicsElement>('[data-chart-geometry]')) {
    const css = getComputedStyle(shape)
    if (css.stroke === 'none' && css.fill === 'none' || Number(css.opacity) === 0) continue
    const box = shape.getBBox(), matrix = shape.getScreenCTM(), svg = shape.ownerSVGElement
    if (!matrix || !svg) throw new Error('Chart transform is unavailable')
    const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix))
    const k = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d))
    // SVG getBBox excluye el trazo; miterlimit=4 permite cuatro semigrosores en path/rect.
    const reach = ['path', 'rect'].includes(shape.localName) && css.strokeLinejoin === 'miter' ? 4 : 1
    const stroke = css.stroke === 'none' ? 0 : parseFloat(css.strokeWidth) * k / 2 * reach
    // Las cajas tipográficas pueden omitir pequeños voladizos cursivos de fuentes empaquetadas.
    const overhang = shape.localName === 'text' && css.fontStyle === 'italic' ? parseFloat(css.fontSize) * k * .25 : 0
    const x = Math.min(...points.map(p => p.x)) - stroke - overhang, y = Math.min(...points.map(p => p.y)) - stroke
    const clip = getComputedStyle(svg).overflow === 'hidden' ? svg.getBoundingClientRect() : undefined
    add(x, y, Math.max(...points.map(p => p.x)) + stroke + overhang - x, Math.max(...points.map(p => p.y)) + stroke - y, clip)
  }
  for (const panel of scene.querySelectorAll<HTMLElement>('[data-chart-panel]')) {
    if (Number(getComputedStyle(panel).opacity) === 0) continue
    const rect = panel.getBoundingClientRect(), shadow = panel.dataset.chartShadow === 'e2'
    // Kernel conservador 3σ de e2 y su desplazamiento; coincide con el fondo nativo.
    add(rect.x - (shadow ? 40 : 0), rect.y - (shadow ? 18 : 0), rect.width + (shadow ? 80 : 0), rect.height + (shadow ? 80 : 0))
  }
  for (const label of scene.querySelectorAll<HTMLElement>('[data-chart-text]')) {
    const css = getComputedStyle(label), rect = label.getBoundingClientRect()
    if (Number(css.opacity) === 0) continue
    const clip = css.overflow === 'hidden' ? rect : undefined
    add(rect.x, rect.y, rect.width, rect.height)
    const range = document.createRange()
    try {
      range.selectNodeContents(label)
      const overhang = css.fontStyle === 'italic' ? parseFloat(css.fontSize) * .25 : 0
      for (const raw of range.getClientRects()) add(raw.x - overhang, raw.y, raw.width + overhang * 2, raw.height, clip)
    } finally { range.detach() }
  }
  const bounds = unionDrawingBounds(boxes)
  if (Math.max(Math.abs(bounds.x), Math.abs(bounds.y), Math.abs(bounds.x + bounds.width), Math.abs(bounds.y + bounds.height), bounds.width, bounds.height) * resourceZoom > CHART_LIMITS.maxSceneExtent) throw new Error('Chart bounds exceed limits')
  return bounds
}

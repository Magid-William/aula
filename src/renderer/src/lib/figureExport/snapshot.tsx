// Instantánea portable: se dibuja aparte, sin alterar el lienzo ni congelar una animación a medias.
import type { ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { FIGURE_LIMITS, type FigureSvg, type FigureSvgNode } from '@shared/figures'
import { serializeFigureSvg } from '@engine/figures/svg'

const GEOMETRY = ['transform', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points'] as const
const TAGS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan'])

export function checkFigureSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > FIGURE_LIMITS.maxDimension || height > FIGURE_LIMITS.maxDimension || width * height > FIGURE_LIMITS.maxPixels) throw new Error('Figure dimensions exceed the export limit')
}

/** Incluye el rodeado y sus trazos aunque rebasen el margen nominal del dibujo. */
export function figureBounds(natural: { x: number; y: number; width: number; height: number }, ink: { x: number; y: number; width: number; height: number }, padding: number): FigureSvg['viewBox'] {
  const x = Math.floor(Math.min(natural.x, ink.x - padding))
  const y = Math.floor(Math.min(natural.y, ink.y - padding))
  const right = Math.ceil(Math.max(natural.x + natural.width, ink.x + ink.width + padding))
  const bottom = Math.ceil(Math.max(natural.y + natural.height, ink.y + ink.height + padding))
  checkFigureSize(right - x, bottom - y)
  return [x, y, right - x, bottom - y]
}

/** Sólo familias genéricas locales: el archivo nunca depende de CSS ni fuentes remotas de Aula. */
export function portableFont(family: string): 'sans-serif' | 'serif' | 'monospace' {
  const last = family.split(',').at(-1)?.trim().replace(/^['"]|['"]$/g, '')
  return last === 'serif' || last === 'ui-serif' ? 'serif' : last === 'monospace' || last === 'ui-monospace' ? 'monospace' : 'sans-serif'
}

export function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Figure export cancelled', 'AbortError')
}

/** Esperas acotadas y cancelables, incluso si una fuente o una imagen no termina de cargar. */
export function bounded<T>(promise: PromiseLike<T>, signal: AbortSignal, ms = 10_000): Promise<T> {
  abortIfNeeded(signal)
  return new Promise<T>((resolve, reject) => {
    const done = (error: unknown, value?: T): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', aborted)
      if (error) reject(error)
      else resolve(value as T)
    }
    const aborted = (): void => done(new DOMException('Figure export cancelled', 'AbortError'))
    const timer = setTimeout(() => done(new Error('Figure export timed out')), ms)
    signal.addEventListener('abort', aborted, { once: true })
    void Promise.resolve(promise).then((value) => done(null, value), (error: unknown) => done(error))
  })
}

/** Canvas convierte también oklab/color-mix a canales sRGB concretos, sin dejar variables CSS. */
function colorResolver(doc: Document): { resolve: (value: string) => string; release: () => void } {
  const canvas = doc.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable')
  const cache = new Map<string, string>()
  return {
    resolve(value) {
      if (value === 'none') return value
      const previous = cache.get(value)
      if (previous) return previous
      if (!CSS.supports('color', value)) throw new Error('Unresolved figure color')
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      const result = `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(6))})`
      cache.set(value, result)
      return result
    },
    release() { canvas.width = canvas.height = 0 }
  }
}

/** Sólo geometría y presentación; no se copian clases, estilos, eventos, aria ni datos del tutor. */
export function snapshotSvg(svg: SVGSVGElement, background: string): FigureSvg {
  const width = Math.ceil(svg.width.baseVal.value)
  const height = Math.ceil(svg.height.baseVal.value)
  checkFigureSize(width, height)
  const natural = svg.viewBox.baseVal
  const colors = colorResolver(svg.ownerDocument)
  let count = 0
  let padding = 1
  const visit = (el: Element, depth: number): FigureSvgNode => {
    if (++count > FIGURE_LIMITS.maxNodes || depth > FIGURE_LIMITS.maxDepth || !TAGS.has(el.localName)) throw new Error('Unsupported figure element')
    const attrs: Record<string, string | number> = {}
    for (const name of GEOMETRY) if (el.hasAttribute(name)) attrs[name] = el.getAttribute(name)!
    const css = getComputedStyle(el)
    attrs.opacity = Number(css.opacity)
    attrs.fill = colors.resolve(css.fill)
    attrs.stroke = colors.resolve(css.stroke)
    attrs['fill-opacity'] = Number(css.fillOpacity)
    attrs['stroke-opacity'] = Number(css.strokeOpacity)
    attrs['stroke-width'] = parseFloat(css.strokeWidth)
    attrs['stroke-linecap'] = css.strokeLinecap
    attrs['stroke-linejoin'] = css.strokeLinejoin
    if (css.stroke !== 'none') {
      const matrix = (el as SVGGraphicsElement).getCTM()
      const scale = matrix ? Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) : 1
      const join = ['path', 'polyline', 'polygon'].includes(el.localName) && css.strokeLinejoin === 'miter' ? Math.max(1, Number(css.strokeMiterlimit)) : 1
      padding = Math.max(padding, parseFloat(css.strokeWidth) * scale * join / 2 + 1)
    }
    // Los guiones son semánticos; la instancia de exportación ya llega sin animación de trazado.
    if (css.strokeDasharray !== 'none') attrs['stroke-dasharray'] = css.strokeDasharray.replace(/px\b/g, '')
    if (parseFloat(css.strokeDashoffset)) attrs['stroke-dashoffset'] = parseFloat(css.strokeDashoffset)
    if (el.localName === 'text' || el.localName === 'tspan') {
      attrs['font-family'] = portableFont(css.fontFamily)
      attrs['font-size'] = parseFloat(css.fontSize)
      attrs['font-weight'] = css.fontWeight
      attrs['font-style'] = css.fontStyle
      attrs['text-anchor'] = css.textAnchor
    }
    const children: Array<FigureSvgNode | string> = []
    for (const child of el.childNodes) {
      if (child.nodeType === 1) children.push(visit(child as Element, depth + 1))
      else if (child.nodeType === 3 && (el.localName === 'text' || el.localName === 'tspan')) children.push(child.textContent ?? '')
    }
    return { tag: el.localName as FigureSvgNode['tag'], attrs, ...(children.length ? { children } : {}) }
  }
  try {
    // La geometría del texto se mide con la misma fuente local que llevará el archivo independiente.
    for (const text of svg.querySelectorAll<SVGTextElement>('text, tspan')) text.style.fontFamily = portableFont(getComputedStyle(text).fontFamily)
    const children = Array.from(svg.children, (child) => visit(child, 1))
    const box = figureBounds(natural, svg.getBBox(), padding)
    const figure: FigureSvg = {
      width: box[2], height: box[3], viewBox: box,
      children: [
        { tag: 'rect', attrs: { x: box[0], y: box[1], width: box[2], height: box[3], fill: colors.resolve(background) } },
        ...children
      ]
    }
    serializeFigureSvg(figure) // El mismo límite y validador que usa el proceso principal.
    return figure
  } finally { colors.release() }
}

export type FigureMeasure = (text: string, size: number, bold?: boolean) => number

export async function captureFigure(render: (measure: FigureMeasure) => ReactElement, context: HTMLElement, signal: AbortSignal): Promise<FigureSvg> {
  if (document.fonts) await bounded(document.fonts.ready, signal)
  abortIfNeeded(signal)
  if (!context.isConnected) throw new DOMException('Figure removed', 'AbortError')
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.inert = true
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;contain:layout style;font-family:sans-serif;'
  // Conserva los pigmentos y el tema heredados, pero nunca entra en el layout de la figura original.
  context.append(host)
  const root = createRoot(host)
  const canvas = document.createElement('canvas')
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    const measure: FigureMeasure = (text, size, bold) => {
      ctx.font = `${bold ? 600 : 400} ${size}px sans-serif`
      return ctx.measureText(text).width
    }
    flushSync(() => root.render(render(measure)))
    abortIfNeeded(signal)
    const svg = host.querySelector('svg')
    if (!svg) throw new Error('Figure drawing is unavailable')
    host.style.color = 'var(--paper)'
    return snapshotSvg(svg, getComputedStyle(host).color)
  } finally {
    canvas.width = canvas.height = 0
    root.unmount()
    host.remove()
  }
}

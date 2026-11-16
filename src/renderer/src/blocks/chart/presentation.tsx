// El árbol SVG preparado es el mismo que pinta la vista viva. La proyección sólo lee su vocabulario cerrado.
import { createContext, Fragment, isValidElement, useContext, useLayoutEffect, useRef, type ReactNode, type RefObject, type SVGProps } from 'react'
import { motion } from 'motion/react'
import type { ChartPaint, ChartRenderSceneV1, ChartSvgPrimitive } from '@shared/figuresChart'

export interface CommittedChartSvg {
  element: SVGSVGElement
  children: ReactNode
  width: number
  height: number
  layoutWidth: number
  branch: ChartRenderSceneV1['branch']
  overflow: 'visible' | 'hidden'
}
export const ChartCaptureContext = createContext<RefObject<CommittedChartSvg | null> | null>(null)

export function ChartSvg({ width, height, layoutWidth = width, branch, settled, children, ...props }: Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & {
  width: number; height: number; layoutWidth?: number; branch: ChartRenderSceneV1['branch']; settled?: ReactNode
}) {
  const element = useRef<SVGSVGElement>(null), capture = useContext(ChartCaptureContext)
  useLayoutEffect(() => {
    if (!capture || !element.current) return
    const committed: CommittedChartSvg = { element: element.current, children: settled ?? children, width, height, layoutWidth, branch, overflow: branch === 'donut' ? 'hidden' : 'visible' }
    capture.current = committed
    return () => { if (capture.current === committed) capture.current = null }
  })
  return <svg {...props} ref={element} width={width} height={height}>{children}</svg>
}

interface Inherited {
  fill: string; stroke: string; fillOpacity: number; strokeOpacity: number; strokeWidth: number
  strokeLinecap: 'butt' | 'round'; strokeLinejoin: 'miter' | 'round'; fontSize: number
  fontWeight: 400 | 500 | 600; textAnchor: 'start' | 'middle' | 'end'; tabular: boolean
}
const presentationKeys = ['fill', 'stroke', 'fillOpacity', 'strokeOpacity', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'fontSize', 'fontWeight', 'textAnchor'] as const
const commonKeys = [...presentationKeys, 'className', 'style', 'pointerEvents', 'opacity', 'data-ask-part', 'data-ask-label', 'onPointerEnter', 'onPointerLeave']
const tagKeys = new Map<string, Set<string>>(Object.entries({
  g: ['children'], path: ['d', 'strokeDasharray'], rect: ['x', 'y', 'width', 'height', 'rx', 'strokeDasharray'],
  line: ['x1', 'x2', 'y1', 'y2', 'strokeDasharray'], circle: ['cx', 'cy', 'r', 'strokeDasharray'], ellipse: ['cx', 'cy', 'rx', 'ry', 'strokeDasharray'], text: ['x', 'y', 'children']
}).map(([tag, keys]) => [tag, new Set([...commonKeys, ...keys])]))
const motionKeys = new Set(['initial', 'animate', 'transition'])
const fail = (): never => { throw new Error('Unsupported chart presentation') }
const numeric = (v: unknown, fallback = 0): number => v === undefined ? fallback : typeof v === 'number' && Number.isFinite(v) ? v : fail()
const literal = (v: unknown, fallback = ''): string => v === undefined ? fallback : typeof v === 'string' ? v : fail()
const choice = <T extends string | number>(v: unknown, values: readonly T[], fallback: T): T => v === undefined ? fallback : values.includes(v as T) ? v as T : fail()
function styleOf(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const style = value as Record<string, unknown>
  if (Object.keys(style).some(key => !['transformBox', 'originX', 'originY', 'transition', 'opacity'].includes(key))) fail()
  return style
}
function textOf(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === 'boolean') return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textOf).join('')
  return fail()
}

function entrance(value: unknown, end: boolean): void {
  if (value === undefined || !end && value === false) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const target = value as Record<string, unknown>
  if (!Object.keys(target).length || Object.entries(target).some(([key, n]) => !['opacity', 'scale', 'scaleX', 'scaleY', 'pathLength'].includes(key) || n !== (end ? 1 : 0))) fail()
}

/** No evalúa componentes, handlers ni expresiones: sólo elementos ya preparados de Chart. */
export function projectChartSvg(children: ReactNode, resolve: (color: string) => string, defaults: { weight?: 400 | 500 | 600 } = {}): ChartSvgPrimitive[] {
  const out: ChartSvgPrimitive[] = []
  let visited = 0
  const color = (value: string): string => value === 'none' ? 'none' : resolve(value)
  const visit = (node: ReactNode, inherited: Inherited, depth: number): void => {
    if (++visited > 30_000 || depth > 16) throw new Error('Chart presentation exceeds limits')
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) { node.forEach(child => visit(child, inherited, depth + 1)); return }
    if (!isValidElement<Record<string, unknown>>(node)) return fail()
    if (node.type === Fragment) { visit(node.props.children as ReactNode, inherited, depth + 1); return }
    let tag: string, animated = false
    if (typeof node.type === 'string') tag = node.type
    else {
      const match = [['g', motion.g], ['path', motion.path], ['circle', motion.circle], ['text', motion.text]] as const
      const found = match.find(([, component]) => node.type === component)
      if (!found) return fail()
      tag = found[0]; animated = true
    }
    if (!['g', 'path', 'rect', 'line', 'circle', 'ellipse', 'text'].includes(tag)) return fail()
    const p = node.props, style = styleOf(p.style)
    const allowed = tagKeys.get(tag)!
    if (Object.keys(p).some(key => !allowed.has(key) && !(animated && motionKeys.has(key)))) fail()
    if (animated) { entrance(p.initial, false); entrance(p.animate, true) }
    if (style.transformBox !== undefined && (!animated || style.transformBox !== 'fill-box')) fail()
    if (['originX', 'originY'].some(key => style[key] !== undefined && (!animated || numeric(style[key]) < 0 || numeric(style[key]) > 1))) fail()
    if (style.transition !== undefined && (animated || tag !== 'path' || style.transition !== 'd 0.18s')) fail()
    const className = literal(p.className)
    if (className && className !== 'tabular') fail()
    const current: Inherited = {
      fill: literal(p.fill, inherited.fill), stroke: literal(p.stroke, inherited.stroke),
      fillOpacity: numeric(p.fillOpacity, inherited.fillOpacity), strokeOpacity: numeric(p.strokeOpacity, inherited.strokeOpacity), strokeWidth: numeric(p.strokeWidth, inherited.strokeWidth),
      strokeLinecap: choice(p.strokeLinecap, ['butt', 'round'], inherited.strokeLinecap), strokeLinejoin: choice(p.strokeLinejoin, ['miter', 'round'], inherited.strokeLinejoin),
      fontSize: numeric(p.fontSize, inherited.fontSize), fontWeight: choice(p.fontWeight, [400, 500, 600], inherited.fontWeight),
      textAnchor: choice(p.textAnchor, ['start', 'middle', 'end'], inherited.textAnchor), tabular: inherited.tabular || className === 'tabular'
    }
    const opacity = numeric(style.opacity, numeric(p.opacity, 1))
    if (tag === 'g') {
      // Aplanar un grupo translúcido alteraría la composición de hijos superpuestos. Chart sólo tiene grupos finales opacos.
      if (opacity !== 1) fail()
      visit(p.children as ReactNode, current, depth + 1); return
    }
    if (tag === 'text') {
      if (opacity !== 1 || current.fillOpacity !== 1 || current.stroke !== 'none') fail()
      const x = numeric(p.x), y = numeric(p.y), content = p.children as ReactNode
      const spans = Array.isArray(content) ? content : [content]
      const lines = spans.some(child => isValidElement(child)) ? spans.map(child => {
        if (!isValidElement<Record<string, unknown>>(child) || child.type !== 'tspan' || Object.keys(child.props).some(key => !['x', 'dy', 'children'].includes(key))) return fail()
        return { text: textOf(child.props.children as ReactNode), x: numeric(child.props.x, x), dy: numeric(child.props.dy) }
      }) : [{ text: textOf(content), x, dy: 0 }]
      if (lines.some(line => line.text.length)) out.push({ kind: 'text', x, y, color: color(current.fill), size: current.fontSize, weight: current.fontWeight, anchor: current.textAnchor, tabular: current.tabular, lines })
      return
    }
    // Las zonas transparentes de interacción no forman parte de la pintura.
    if (['transparent', 'none'].includes(current.fill) && current.stroke === 'none') return
    const dash = p.strokeDasharray === undefined ? [] : literal(p.strokeDasharray).trim().split(/[\s,]+/).map(Number)
    if (dash.some(value => !Number.isFinite(value) || value < 0)) fail()
    const paint: ChartPaint = { fill: color(current.fill), stroke: color(current.stroke), fillOpacity: current.fillOpacity, strokeOpacity: current.strokeOpacity, strokeWidth: current.strokeWidth, strokeLinecap: current.strokeLinecap, strokeLinejoin: current.strokeLinejoin, opacity, dash }
    if (tag === 'path') { const d = literal(p.d); if (d) out.push({ kind: 'path', d, ...paint }) }
    else if (tag === 'rect') { const width = numeric(p.width), height = numeric(p.height); if (width > 0 && height > 0) out.push({ kind: 'rect', x: numeric(p.x), y: numeric(p.y), width, height, rx: numeric(p.rx), ...paint }) }
    else if (tag === 'line') out.push({ kind: 'line', x1: numeric(p.x1), y1: numeric(p.y1), x2: numeric(p.x2), y2: numeric(p.y2), ...paint })
    else { const rx = numeric(tag === 'circle' ? p.r : p.rx), ry = numeric(tag === 'circle' ? p.r : p.ry); if (rx > 0 && ry > 0) out.push({ kind: 'ellipse', cx: numeric(p.cx), cy: numeric(p.cy), rx, ry, ...paint }) }
  }
  visit(children, { fill: '#000000', stroke: 'none', fillOpacity: 1, strokeOpacity: 1, strokeWidth: 1, strokeLinecap: 'butt', strokeLinejoin: 'miter', fontSize: 16, fontWeight: defaults.weight ?? 400, textAnchor: 'start', tabular: false }, 0)
  return out
}

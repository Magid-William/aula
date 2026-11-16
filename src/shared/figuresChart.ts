// Presentación comprometida de Chart: geometría y hojas de texto, sin el bloque ni datos de origen.
import type { FigureTypography } from './figuresTypography'

export interface ChartBox { x: number; y: number; width: number; height: number }
export type ChartColor = string
export interface ChartPaint {
  fill: ChartColor | 'none'
  stroke: ChartColor | 'none'
  fillOpacity: number
  strokeOpacity: number
  strokeWidth: number
  strokeLinecap: 'butt' | 'round'
  strokeLinejoin: 'miter' | 'round'
  opacity: number
  dash: number[]
}
export interface ChartPath extends ChartPaint { kind: 'path'; d: string }
export interface ChartRect extends ChartPaint { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number }
export interface ChartEllipse extends ChartPaint { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
export interface ChartLine extends ChartPaint { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
export interface ChartSvgText {
  kind: 'text'
  x: number
  y: number
  color: ChartColor
  size: number
  weight: 400 | 500 | 600
  anchor: 'start' | 'middle' | 'end'
  tabular: boolean
  // Un tspan por línea conserva exactamente el salto y la posición del SVG vivo.
  lines: Array<{ text: string; x: number; dy: number }>
}
export type ChartSvgPrimitive = ChartPath | ChartRect | ChartEllipse | ChartLine | ChartSvgText
export interface ChartSvgLayer { kind: 'svg'; box: ChartBox; overflow: 'visible' | 'hidden'; primitives: ChartSvgPrimitive[] }
export interface ChartPanel {
  kind: 'panel'
  box: ChartBox
  background: ChartColor | 'none'
  border: ChartColor | 'none'
  borderWidth: number
  radius: number
  shadow: 'none' | 'e2'
  opacity: number
}
export interface ChartTextBox {
  kind: 'html-text'
  // Caja de contenido: excluye padding/border del elemento vivo (p. ej. pl-3 en las lecturas).
  box: ChartBox
  text: string
  color: ChartColor
  font: FigureTypography['bodyFont']
  italic: boolean
  size: number
  lineHeight: number
  weight: 400 | 500 | 600
  letterSpacing: number
  tabular: boolean
  direction: 'ltr' | 'rtl'
  align: 'left' | 'right' | 'center' | 'start' | 'end'
  whiteSpace: 'normal' | 'nowrap'
  overflow: 'visible' | 'hidden'
  // El texto íntegro de esta hoja forma parte de su presentación; Chromium recorta la cola igual que en vivo.
  truncate: boolean
  opacity: number
}
export type ChartLayer = ChartSvgLayer | ChartPanel | ChartTextBox
export interface ChartRenderSceneV1 {
  version: 1
  family: 'chart'
  chartKind: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'histogram'
  branch: 'empty' | 'vertical-bars' | 'horizontal-bars' | 'cartesian' | 'donut'
  canvas: { width: number; height: number }
  // EffectiveZoom Float32 de Blink: incluye InitialZoom nativo y los zoom CSS de origen.
  // cssZoom conserva el significado tipográfico compartido; no sustituye este valor.
  metrics: { rootFontPx: number; rawEffectiveZoom: number } & FigureTypography
  appearance: {
    theme: 'light' | 'dark'
    language: string
    direction: 'ltr' | 'rtl'
    palette: { paper: string; text: string; text2: string; text3: string; link: string; accent: string; brick: string }
  }
  // Un único SVG y cajas HTML absolutas; no se vuelve a decidir flex-wrap ni la rama responsive.
  layers: ChartLayer[]
  output: { scale: 2 }
}

// Presentación ya resuelta del lienzo visible. No contiene el bloque, IDs, pasos futuros ni CSS/HTML arbitrario.
import type { FigureTypography } from './figuresTypography'
export interface DiagramRenderBox { x: number; y: number; width: number; height: number }
export interface DiagramCircle { cx: number; cy: number; r: number }
// Colores sRGB concretos: #rrggbb o #rrggbbaa; nunca expresiones CSS ni referencias externas.
export type DiagramColor = string
export interface DiagramPath {
  kind: 'path'
  d: string
  fill: DiagramColor | 'none'
  stroke: DiagramColor | 'none'
  strokeWidth: number
  strokeLinejoin: 'miter' | 'round'
  opacity: number
  dash: number[]
  dashOffset: number
}
export interface DiagramEllipse {
  kind: 'ellipse'
  cx: number; cy: number; rx: number; ry: number
  fill: DiagramColor | 'none'
  stroke: DiagramColor | 'none'
  strokeWidth: number
  opacity: number
  dash: number[]
}
export interface DiagramInk {
  kind: 'ink'
  box: DiagramRenderBox
  viewWidth: number
  viewHeight: number
  color: DiagramColor
  opacity: number
  strokes: Array<{ d: string; spine: string; reach: number; dry?: string; dryWidth?: number }>
}
export interface DiagramTextLine {
  text: string
  content: 'rich' | 'plain'
  color: DiagramColor
  font: 'inherit' | 'serif'
  size: number
  lineHeight: number
  weight: 400 | 500 | 600
  tabular: boolean
  clamp: 0 | 3 | 6
  breakWords: boolean
  fullWidth: boolean
  height: number | null
  marginTop: number
}
export interface DiagramLabel {
  kind: 'label'
  x: number; y: number
  width: number | null
  height: number | null
  maxWidth: number | null
  anchor: 'top-left' | 'center'
  layout: 'block' | 'column' | 'grid' | 'bottom'
  align: 'left' | 'center' | 'right'
  vertical: 'top' | 'center' | 'bottom'
  paddingX: number
  paddingY: number
  wrap: 'normal' | 'nowrap'
  truncate: boolean
  shape: 'none' | 'box' | 'round' | 'circle' | 'note'
  background: DiagramColor | 'none'
  tint: DiagramColor | 'none'
  border: DiagramColor | 'none'
  borderWidth: number
  shadow: 'none' | 'e1' | 'e2'
  opacity: number
  lines: DiagramTextLine[]
}
export interface DiagramVennRegion {
  kind: 'venn-region'
  include: DiagramCircle[]
  exclude: DiagramCircle[]
  fill: DiagramColor
}
export type DiagramLeaf = DiagramPath | DiagramEllipse | DiagramInk | DiagramLabel | DiagramVennRegion
// Una sola capa de agrupación conserva la composición de transparencias de tarjetas y flechas.
export interface DiagramGroup { kind: 'group'; opacity: number; children: DiagramLeaf[] }
export type DiagramPrimitive = DiagramLeaf | DiagramGroup
export interface DiagramRenderSceneV1 {
  version: 1
  family: 'flow' | 'concept' | 'tree' | 'cycle' | 'layers' | 'pyramid' | 'funnel' | 'venn' | 'mindmap'
  canvas: { width: number; height: number }
  metrics: { rootFontPx: number } & FigureTypography
  appearance: {
    theme: 'light' | 'dark'
    language: string
    direction: 'ltr' | 'rtl'
    palette: { paper: string; text: string; text2: string; text3: string; link: string; accent: string; brick: string }
    background: { kind: 'dots'; color: DiagramColor; spacing: 18; radius: 1; fadeRadius: 1.2 }
  }
  // Orden de pintura; las entradas y la revelación ya han terminado. Los paths de flujo conservan su fase actual.
  primitives: DiagramPrimitive[]
  output: { scale: 2 }
}

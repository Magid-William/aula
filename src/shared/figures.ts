// Figuras autónomas para exportar: sin HTML, referencias externas ni rutas del equipo.
export const FIGURE_LIMITS = {
  maxDimension: 4096,
  maxPixels: 16 * 1024 * 1024,
  maxSvgBytes: 2 * 1024 * 1024,
  maxPngBytes: 16 * 1024 * 1024,
  maxNodes: 10_000,
  maxDepth: 32,
  maxCoordinate: 1_000_000
} as const

export type FigureSvgTag = 'g' | 'path' | 'rect' | 'circle' | 'ellipse' | 'line' | 'polyline' | 'polygon' | 'text' | 'tspan'
export type FigureSvgAttribute =
  | 'transform' | 'd' | 'points'
  | 'x' | 'y' | 'x1' | 'y1' | 'x2' | 'y2' | 'cx' | 'cy' | 'r' | 'rx' | 'ry' | 'width' | 'height' | 'dx' | 'dy'
  | 'fill' | 'stroke' | 'fill-rule' | 'opacity' | 'fill-opacity' | 'stroke-opacity'
  | 'stroke-width' | 'stroke-linecap' | 'stroke-linejoin' | 'stroke-miterlimit' | 'stroke-dasharray' | 'stroke-dashoffset' | 'pathLength'
  | 'font-family' | 'font-size' | 'font-weight' | 'font-style' | 'text-anchor' | 'dominant-baseline' | 'letter-spacing' | 'word-spacing'

export interface FigureSvgNode {
  tag: FigureSvgTag
  attrs?: Partial<Record<FigureSvgAttribute, string | number>>
  children?: Array<FigureSvgNode | string>
}

export interface FigureSvg {
  /** Tamaño de salida en píxeles, independiente de las unidades del viewBox. */
  width: number
  height: number
  viewBox: [number, number, number, number]
  children: FigureSvgNode[]
}

export type FigureSaveArgs = { suggestedName: string } & (
  | { format: 'svg'; svg: FigureSvg }
  | { format: 'png'; data: Uint8Array }
)
export interface FigureSaveResult { path: string }

export class FigureValidationError extends Error {
  constructor(readonly reason: 'invalid' | 'too_large' = 'invalid') {
    super(reason === 'too_large' ? 'Figure exceeds export limits.' : 'Invalid figure export.')
    this.name = 'FigureValidationError'
  }
}

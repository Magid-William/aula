import type { DrawingRenderSceneV1 } from './figuresDrawing'
import type { DiagramRenderSceneV1 } from './figuresDiagram'
import type { ChartRenderSceneV1 } from './figuresChart'

export interface FigureRenderBounds { x: number; y: number; width: number; height: number }
export type FigureRenderInput =
  | { kind: 'drawing'; scene: DrawingRenderSceneV1 }
  | { kind: 'diagram'; scene: DiagramRenderSceneV1 }
  | { kind: 'chart'; scene: ChartRenderSceneV1 }

/** Protocolo privado main→renderer; no forma parte del puente de la aplicación. */
export interface FigureRenderApi {
  render(input: FigureRenderInput): Promise<{ bounds: FigureRenderBounds; layoutWidth: number; layoutHeight: number }>
  resize(view: { width: number; height: number; scale: number; offsetX: number; offsetY: number }): Promise<{ width: number; height: number }>
  normalize(input: { data: string; width: number; height: number }): Promise<{ data: string; width: number; height: number }>
  cancel(): void
}

// Límites del layout CSS previo a la captura, distintos del tamaño físico de salida.
export const FIGURE_RENDER_LIMITS = { maxLayoutDimension: 16_384, maxSceneExtent: 32_768 } as const

import type { FigureRenderInput } from '@shared/figuresRender'
import { validateDrawingRenderScene } from './drawing'
import { validateDiagramRenderScene } from './diagram'
import { FigureSceneReader, failFigure } from './render-reader'

/** La discriminación se valida antes de leer la escena o construir nodos. */
export function validateFigureRenderInput(value: unknown): FigureRenderInput {
  const reader = new FigureSceneReader({ maxBytes: 128, maxPrimitives: 0 })
  const input = reader.object(value, ['kind', 'scene'])
  switch (input.kind) {
    case 'drawing': return { kind: 'drawing', scene: validateDrawingRenderScene(input.scene) }
    case 'diagram': return { kind: 'diagram', scene: validateDiagramRenderScene(input.scene) }
    default: return failFigure()
  }
}

export function figureRenderLayout(input: FigureRenderInput): { width: number; height: number } {
  switch (input.kind) {
    case 'drawing': return { width: input.scene.metrics.layoutWidth, height: input.scene.canvas.height * input.scene.metrics.layoutWidth / input.scene.canvas.width }
    case 'diagram': return { width: input.scene.canvas.width, height: input.scene.canvas.height }
    default: { const exhaustive: never = input; return exhaustive }
  }
}

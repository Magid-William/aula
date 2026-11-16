// La captura privada se cancela junto a su acción; el guardado sigue el flujo común de figuras.
import type { DiagramRenderSceneV1 } from '@shared/figuresDiagram'
import { api } from '@renderer/lib/api'
import { abortIfNeeded, bounded } from './snapshot'

export async function captureDiagramPng(scene: DiagramRenderSceneV1, signal: AbortSignal): Promise<Uint8Array> {
  abortIfNeeded(signal)
  const jobId = crypto.randomUUID()
  let cancelled = false
  const cancel = (): void => {
    if (cancelled) return
    cancelled = true
    void api.invoke('figures.cancelRender', { jobId }).catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const result = await bounded(api.invoke('figures.renderDiagramPng', { jobId, scene }), signal, 25_000)
    abortIfNeeded(signal)
    return result.data
  } catch (error) { cancel(); throw error }
  finally { signal.removeEventListener('abort', cancel) }
}

import { FIGURE_LIMITS, type FigureSvg } from '@shared/figures'
import { serializeFigureSvg } from '@engine/figures/svg'
import { abortIfNeeded, bounded, checkFigureSize } from './snapshot'

/** SVG y PNG comparten exactamente la misma instantánea validada y el mismo fondo. */
export async function figurePng(figure: FigureSvg, signal: AbortSignal): Promise<Uint8Array> {
  checkFigureSize(figure.width, figure.height)
  abortIfNeeded(signal)
  const xml = serializeFigureSvg(figure)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  const image = new Image()
  const canvas = document.createElement('canvas')
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Figure image could not be decoded'))
      image.src = url
    })
    await bounded(loaded, signal)
    abortIfNeeded(signal)
    canvas.width = figure.width
    canvas.height = figure.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    ctx.drawImage(image, 0, 0, figure.width, figure.height)
    const blob = await bounded(new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Figure PNG could not be encoded')), 'image/png')
    }), signal)
    if (blob.size > FIGURE_LIMITS.maxPngBytes || blob.type !== 'image/png') throw new Error('Figure PNG exceeds the export limit')
    const bytes = new Uint8Array(await bounded(blob.arrayBuffer(), signal))
    abortIfNeeded(signal)
    return bytes
  } finally {
    image.onload = image.onerror = null
    image.removeAttribute('src')
    URL.revokeObjectURL(url)
    canvas.width = canvas.height = 0
  }
}

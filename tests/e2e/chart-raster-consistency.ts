// Consistencia entre dos exportaciones del mismo commit; no sustituye la comparación con el DOM vivo.
import type { PixelRaster } from './diagram-pixels'

export interface ChartRasterConsistency {
  changedPixels: number
  maxChannelDelta: number
  alphaEqual: boolean
  foregroundEqual: boolean
  edgeOnly: boolean
  samples: Array<{ x: number; y: number; delta: number }>
}

/** Dos píxeles de borde pueden variar hasta 3/255 incluso al repetir la misma fase nativa. */
export function compareChartRasterConsistency(a: PixelRaster, b: PixelRaster, paper: number[]): ChartRasterConsistency {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== a.width * a.height * 4 || b.data.length !== a.data.length) throw new Error('Chart export dimensions changed')
  const result: ChartRasterConsistency = { changedPixels: 0, maxChannelDelta: 0, alphaEqual: true, foregroundEqual: true, edgeOnly: true, samples: [] }
  const foreground = (raster: PixelRaster, index: number): boolean => Math.max(...paper.map((channel, c) => Math.abs(raster.data[index + c] - channel))) > 28
  const edge = (raster: PixelRaster, x: number, y: number): number => {
    const low = [255, 255, 255], high = [0, 0, 0]
    for (let yy = Math.max(0, y - 1); yy <= Math.min(raster.height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(raster.width - 1, x + 1); xx++) {
      const index = (yy * raster.width + xx) * 4
      for (let c = 0; c < 3; c++) { low[c] = Math.min(low[c], raster.data[index + c]); high[c] = Math.max(high[c], raster.data[index + c]) }
    }
    return Math.max(...high.map((value, c) => value - low[c]))
  }
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const index = (y * a.width + x) * 4, alphaEqual = a.data[index + 3] === b.data[index + 3]
    const delta = Math.max(...[0, 1, 2].map(c => Math.abs(a.data[index + c] - b.data[index + c])))
    if (alphaEqual && delta === 0) continue
    result.changedPixels++; result.maxChannelDelta = Math.max(result.maxChannelDelta, delta)
    result.alphaEqual &&= alphaEqual
    result.foregroundEqual &&= foreground(a, index) === foreground(b, index)
    result.edgeOnly &&= edge(a, x, y) >= 32 && edge(b, x, y) >= 32
    if (result.samples.length < 8) result.samples.push({ x, y, delta })
  }
  return result
}

export function assertChartRasterConsistency(result: ChartRasterConsistency): void {
  if (result.changedPixels > 2 || result.maxChannelDelta > 3 || !result.alphaEqual || !result.foregroundEqual || !result.edgeOnly) throw new Error(`Chart export raster changed: ${JSON.stringify(result)}`)
}

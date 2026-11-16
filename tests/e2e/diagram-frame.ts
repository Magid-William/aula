// Regresión de encuadre específica de edges-40 en oscuro; no sustituye la comparación de contenido.
import { inflateSync } from 'node:zlib'

export interface DiagramFrameRaster { width: number; height: number; data: Uint8Array }
export function decodeDiagramFramePng(bytes: Buffer): DiagramFrameRaster {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Expected fixture PNG')
  let width = 0, height = 0, channels = 0
  const parts: Buffer[] = []
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) throw new Error('Truncated PNG chunk')
    const size = bytes.readUInt32BE(at), end = at + 12 + size, kind = bytes.toString('ascii', at + 4, at + 8)
    if (end > bytes.length || size > 64 * 1024 * 1024) throw new Error('Invalid PNG chunk size')
    const content = bytes.subarray(at + 8, at + 8 + size)
    if (kind === 'IHDR') {
      if (size !== 13 || width) throw new Error('Invalid PNG header')
      width = content.readUInt32BE(0); height = content.readUInt32BE(4)
      channels = content[9] === 2 ? 3 : content[9] === 6 ? 4 : 0
      if (content[8] !== 8 || !channels || content[10] || content[11] || content[12] || !width || !height || Math.max(width, height) > 4096 || width * height > 16 * 1024 * 1024) throw new Error('Unsupported fixture PNG')
    } else if (kind === 'IDAT') parts.push(content)
    at = end
  }
  if (!width || !parts.length) throw new Error('Missing fixture PNG data')
  const stride = width * channels, raw = inflateSync(Buffer.concat(parts), { maxOutputLength: (stride + 1) * height })
  if (raw.length !== (stride + 1) * height) throw new Error('Unexpected PNG row count')
  const data = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)], row = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    if (type > 4) throw new Error('Unknown PNG filter')
    for (let i = 0; i < stride; i++) {
      const a = i < channels ? 0 : row[i - channels], b = previous[i], c = i < channels ? 0 : previous[i - channels]
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const predictor = type === 1 ? a : type === 2 ? b : type === 3 ? Math.floor((a + b) / 2) : type === 4 ? pa <= pb && pa <= pc ? a : pb <= pc ? b : c : 0
      row[i] = (row[i] + predictor) & 255
    }
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4, from = x * channels
      data[to] = row[from]; data[to + 1] = row[from + 1]; data[to + 2] = row[from + 2]; data[to + 3] = channels === 4 ? row[from + 3] : 255
    }
    previous = row
  }
  return { width, height, data }
}

interface Region { x: number; y: number; width: number; height: number }
function samples(raster: DiagramFrameRaster, region: Region): number[][] {
  if (![region.x, region.y, region.width, region.height].every(Number.isInteger) || region.x < 0 || region.y < 0 || region.x + region.width > raster.width || region.y + region.height > raster.height) throw new Error('Fixture ROI is outside PNG')
  const result: number[][] = []
  for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) {
    const at = (y * raster.width + x) * 4; result.push([...raster.data.subarray(at, at + 4)])
  }
  return result
}
const equal = (a: number[], b: number[]): boolean => a.every((n, i) => n === b[i])
const SCALE = 2, OFFSET = { x: 26, y: 24 }
// Franjas fijas interiores/exteriores de tres tarjetas del fixture; compartidas por sus fuentes nativas.
// No buscan bordes en el PNG ni se desplazan con el resultado del oráculo de contenido.
const CARDS = [{ name: 'node0', x: 16, y: 206.5, width: 109 }, { name: 'node2', x: 393.152, y: 273, width: 108 }, { name: 'node7', x: 904.152, y: 491, width: 108 }]
export function diagramHoverFramePixels(raster: DiagramFrameRaster, natural: { width: number; height: number }) {
  // Este dominio cerrado procede del lienzo vivo: la fuente nativa cambia un DIP de ancho.
  if (![1028, 1029].includes(natural.width) || natural.height !== 547) throw new Error('Unexpected geometry for the fixed hover40dark fixture')
  // Márgenes del fixture: izquierda 26, derecha 9, arriba 24 y debajo 23 DIP (véase provenance.json).
  const expectedWidth = (natural.width + 26 + 9) * SCALE, expectedHeight = (natural.height + 24 + 23) * SCALE
  if (raster.width !== expectedWidth || raster.height !== expectedHeight) return { accepted: false, dimensions: [raster.width, raster.height], anchors: [], dots: null }
  // El perfil de captura puede cambiar los RGB entre plataformas. Esta guarda comprueba
  // posición, no colorimetría: observa el papel mayoritario sólo en este ROI vacío fijo.
  const region = { x: 0, y: 1100, width: 280, height: 88 }, period = 18 * SCALE
  const histogram = new Map<string, { color: number[]; count: number }>()
  for (const color of samples(raster, region)) {
    const key = color.join(','), previous = histogram.get(key)
    if (previous) previous.count++
    else histogram.set(key, { color, count: 1 })
  }
  const dominant = [...histogram.values()].sort((a, b) => b.count - a.count)[0], paper = dominant.color
  const anchors = CARDS.flatMap(card => {
    const centerX = Math.floor((card.x + card.width / 2 + OFFSET.x) * SCALE)
    const top = (card.y + OFFSET.y) * SCALE, left = Math.floor((card.x + OFFSET.x) * SCALE)
    const pairs = [
      { axis: 'top', inside: { x: centerX - 6, y: top + 8, width: 12, height: 4 }, outside: { x: centerX - 6, y: top - 16, width: 12, height: 4 } },
      { axis: 'left', inside: { x: left + 6, y: top + 36, width: 4, height: 8 }, outside: { x: left - 10, y: top + 36, width: 4, height: 8 } }
    ]
    return pairs.map(({ axis, inside, outside }) => {
      const interior = samples(raster, inside), exterior = samples(raster, outside)
      const color = interior[0], uniform = interior.every(pixel => equal(pixel, color)), contrast = exterior.every(pixel => !equal(pixel, color))
      const isCard = color[3] === 255 && !equal(color, paper)
      return { name: `${card.name}-${axis}`, inside, outside, color, uniform, contrast, isCard, accepted: uniform && contrast && isCard }
    })
  })
  const pairedColors = [0, 2, 4].every(index => equal(anchors[index].color, anchors[index + 1].color)), sameBlueCards = equal(anchors[2].color, anchors[4].color)
  const xPhases = new Set<number>(), yPhases = new Set<number>()
  let dotPixels = 0, opaque = true
  for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) {
    const at = (y * raster.width + x) * 4, pixel = [...raster.data.subarray(at, at + 4)]
    opaque &&= pixel[3] === 255
    if (!equal(pixel, paper)) { xPhases.add(x % period); yPhases.add(y % period); dotPixels++ }
  }
  // Centro en la mitad del tile, radio1DIP a2× y centros enteros: los cuatro píxeles tocados.
  const phases = (offset: number): number[] => [-2, -1, 0, 1].map(delta => (period / 2 + offset * SCALE + delta) % period).sort((a, b) => a - b)
  const expectedX = phases(OFFSET.x), expectedY = phases(OFFSET.y), actualX = [...xPhases].sort((a, b) => a - b), actualY = [...yPhases].sort((a, b) => a - b)
  const dots = { region, period, paper, paperPixels: dominant.count, expectedX, expectedY, actualX, actualY, dotPixels, opaque, accepted: dominant.count * 2 > region.width * region.height && dotPixels > 0 && opaque && JSON.stringify(actualX) === JSON.stringify(expectedX) && JSON.stringify(actualY) === JSON.stringify(expectedY) }
  return { accepted: anchors.every(anchor => anchor.accepted) && dots.accepted && pairedColors && sameBlueCards, dimensions: [raster.width, raster.height], anchors, pairedColors, sameBlueCards, dots }
}

// Pruebas puras del oráculo: rasters sintéticos, sin Electron, navegador ni datos del usuario.
import { test, expect } from 'playwright/test'
import { assertDiagramPixelComparison, diagramPixelOracle, resampleDiagramPixels, type LiveDiagramGeometry, type PixelRaster } from './diagram-pixels'

type RGB = [number, number, number]
interface Rect { x: number; y: number; width: number; height: number; color: RGB }
const PAPER: RGB = [246, 243, 237], PANEL: RGB = [226, 230, 236], INK: RGB = [35, 32, 30]
const WIDTH = 224, HEIGHT = 160
const FORMULA = { x: 26, y: 33, width: 170, height: 32, text: 'five glyphs and a small numerator', kind: 'math' as const }
const GLYPH = { x: 170, y: 38, width: 14, height: 12, text: 'small numerator', kind: 'math' as const }
const marks: Rect[] = [
  { x: 16, y: 16, width: 192, height: 128, color: [130, 145, 170] },
  { x: 18, y: 18, width: 188, height: 124, color: PANEL },
  { x: 26, y: 99.25, width: 170, height: 1.5, color: [46, 96, 171] },
  { x: 32, y: 112.5, width: 160, height: 1, color: [180, 80, 47] },
  { x: 176, y: 41, width: 3, height: 4, color: INK }
]
for (let i = 0; i < 5; i++) {
  const x = 30 + 25 * i
  marks.push({ x, y: 39, width: 2.5, height: 18, color: INK }, { x: x + 10, y: 39, width: 2.5, height: 18, color: INK }, { x, y: 46, width: 12.5, height: 2, color: INK })
}
function blank(width = WIDTH, height = HEIGHT): PixelRaster {
  return { width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : PAPER[i % 4]) }
}
/** Cobertura analítica de rectángulos: no usa el resampler ni la presentación del exportador. */
function paint(raster: PixelRaster, rect: Rect): void {
  const data = raster.data as Uint8ClampedArray
  for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(raster.height, Math.ceil(rect.y + rect.height)); y++) {
    for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(raster.width, Math.ceil(rect.x + rect.width)); x++) {
      const area = Math.max(0, Math.min(x + 1, rect.x + rect.width) - Math.max(x, rect.x)) * Math.max(0, Math.min(y + 1, rect.y + rect.height) - Math.max(y, rect.y))
      for (let c = 0; c < 3; c++) { const at = (y * raster.width + x) * 4 + c; data[at] = data[at] * (1 - area) + rect.color[c] * area }
    }
  }
}
function fixture(dx = 0, dy = 0, width = WIDTH, height = HEIGHT): PixelRaster {
  const raster = blank(width, height)
  for (const mark of marks) paint(raster, { ...mark, x: mark.x + dx, y: mark.y + dy })
  return raster
}
function changed(raster: PixelRaster, rect: Rect): PixelRaster {
  const copy = { ...raster, data: Uint8ClampedArray.from(raster.data) }; paint(copy, rect); return copy
}
function geometry(): LiveDiagramGeometry {
  return { width: WIDTH, height: HEIGHT, canvas: { x: 0, y: 0, width: WIDTH, height: HEIGHT, naturalWidth: WIDTH, naturalHeight: HEIGHT, scale: 1 }, background: PAPER, exclusions: [], labels: [FORMULA, GLYPH] }
}
function verify(source: PixelRaster, exported: PixelRaster, live = geometry()) {
  const result = diagramPixelOracle(source, exported, live)
  assertDiagramPixelComparison(result, live)
  return result
}

test('oráculo Diagram: identidad y padding conservan todos los píxeles', () => {
  const source = fixture(), identical = verify(source, source), padded = verify(source, fixture(4, 6, WIDTH + 8, HEIGHT + 12))
  expect(identical.all.recall.ratio).toBe(1); expect(identical.all.precision.ratio).toBe(1)
  expect(padded.alignment).toMatchObject({ dx: 4, dy: 6 })
  expect(padded.all.recall.ratio).toBe(1); expect(padded.all.precision.ratio).toBe(1)
})

test('oráculo Diagram: correlaciona fase fraccionaria sin ampliar el radio ni tolerancias', () => {
  const result = verify(fixture(), fixture(4.375, 6.25, WIDTH + 8, HEIGHT + 12))
  expect(Math.abs(result.alignment.dx - 4.375)).toBeLessThanOrEqual(.25)
  expect(Math.abs(result.alignment.dy - 6.25)).toBeLessThanOrEqual(.25)
  expect(result.all.recall.ratio).toBeGreaterThan(.98); expect(result.all.precision.ratio).toBeGreaterThan(.98)
})

test('oráculo Diagram: distingue la traslación real entre barras periódicas', () => {
  const source = blank(196, 266), exported = blank(184, 254)
  // Barras separadas cinco píxeles: el barrido impar de dos en dos omitía (-6, -6)
  // y elegía otra barra en (-1, -6). Las dos imágenes se pintan analíticamente.
  const pair = (rect: Rect): void => {
    paint(source, rect)
    paint(exported, { ...rect, x: rect.x - 6, y: rect.y - 6 })
  }
  for (let i = 0; i < 24; i++) {
    const height = (i % 7 + 2) * 26
    pair({ x: 56 + i * 5, y: 232 - height, width: 3, height, color: i === 1 ? [56, 93, 138] : [187, 199, 214] })
  }
  for (let i = 0; i < 5; i++) pair({ x: 41, y: 226 - i * 52, width: 2, height: 7, color: [108, 104, 98] })
  const live: LiveDiagramGeometry = {
    width: 196, height: 266,
    canvas: { x: 8, y: 8, width: 180, height: 250, naturalWidth: 180, naturalHeight: 250, scale: 1 },
    background: PAPER, exclusions: [], labels: []
  }
  const result = verify(source, exported, live)
  expect(result.alignment).toMatchObject({ dx: -6, dy: -6, averageColorError: 0 })
  expect(result.all.recall.ratio).toBe(1); expect(result.all.precision.ratio).toBe(1)
})

test('oráculo Diagram: rechaza fórmula, barra y glifo omitidos', () => {
  const source = fixture(), padded = fixture(4, 6, WIDTH + 8, HEIGHT + 12)
  const missingFormula = changed(padded, { x: 30, y: 39, width: 170, height: 32, color: PANEL })
  const missingBar = changed(padded, { x: 30, y: 104, width: 170, height: 4, color: PANEL })
  const missingGlyph = changed(padded, { x: 180, y: 47, width: 3, height: 4, color: PANEL })
  expect(() => verify(source, missingFormula)).toThrow()
  expect(() => verify(source, missingBar)).toThrow()
  // Un glifo pequeño puede diluirse dentro de una fórmula grande: la garantía local necesita su ROI.
  // El producto inspecciona cada fórmula por separado; no afirma detección universal por carácter.
  expect(() => verify(source, missingGlyph)).toThrow(/Missing math pixels/)
})

test('oráculo Diagram: rechaza tinta extra, tinte/color alterado y desplazamiento de seis píxeles', () => {
  const source = fixture(), padded = fixture(4, 6, WIDTH + 8, HEIGHT + 12)
  const extra = changed(padded, { x: 57, y: 41, width: 15, height: 22, color: INK })
  const colorSource = changed(source, { x: 26, y: 97, width: 170, height: 5, color: [46, 96, 171] })
  const colorMatch = changed(padded, { x: 30, y: 103, width: 170, height: 5, color: [46, 96, 171] })
  const wrongColor = changed(colorMatch, { x: 30, y: 103, width: 170, height: 5, color: [40, 125, 50] })
  verify(colorSource, colorMatch)
  const tinted = blank(WIDTH + 8, HEIGHT + 12)
  for (const mark of marks) paint(tinted, { ...mark, x: mark.x + 4, y: mark.y + 6, color: mark.color === PANEL ? [170, 205, 225] : mark.color })
  const shifted = changed(padded, { x: 30, y: 39, width: 170, height: 32, color: PANEL })
  for (const mark of marks.filter(mark => mark.color === INK)) paint(shifted, { ...mark, x: mark.x + 10, y: mark.y + 6 })
  expect(() => verify(source, extra)).toThrow()
  expect(() => verify(colorSource, wrongColor)).toThrow()
  expect(() => verify(source, tinted)).toThrow()
  expect(() => verify(source, shifted)).toThrow()
})

test('oráculo Diagram: compara sólo el viewport visible durante pan', () => {
  const live = geometry(), panX = -40, panY = -15
  const clipped = { ...live, width: 170, height: 125, canvas: { ...live.canvas, x: panX, y: panY }, labels: live.labels.map(label => ({ ...label, x: label.x + panX, y: label.y + panY })) }
  verify(fixture(panX, panY, 170, 125), fixture(4, 6, WIDTH + 8, HEIGHT + 12), clipped)
})

test('oráculo Diagram: blanco válido y rechazo de tinta incluso fuera del viewport', () => {
  const live = { ...geometry(), labels: [], expectedEmpty: true }
  verify(blank(), blank(WIDTH + 8, HEIGHT + 12), live)
  const extra = changed(blank(WIDTH + 8, HEIGHT + 12), { x: WIDTH + 1, y: 10, width: 5, height: 10, color: INK })
  expect(() => verify(blank(), extra, live)).toThrow(/Blank fixture contains foreground/)
  expect(() => verify(fixture(), blank(WIDTH + 8, HEIGHT + 12), live)).toThrow(/Blank fixture contains foreground/)
})

test('oráculo Diagram: resample conserva cobertura, identidad y colores uniformes', () => {
  const bars: PixelRaster = { width: 3, height: 1, data: [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255] }
  expect(Array.from(resampleDiagramPixels(bars, 2, 1).data)).toEqual([85, 85, 85, 255, 85, 85, 85, 255])
  expect(resampleDiagramPixels(bars, 3, 1)).toEqual(bars)
  const flat = resampleDiagramPixels(blank(9, 7), 5, 3)
  expect(Array.from(flat.data)).toEqual(Array.from(blank(5, 3).data))
  for (const size of [0, -1, 1.5, NaN, Infinity]) expect(() => resampleDiagramPixels(bars, size, 1)).toThrow(/dimensions/)
})

test('oráculo Diagram: una fórmula tenue sigue protegida si el filtro borra su contraste', () => {
  const source = changed(fixture(), { x: 176, y: 41, width: 3, height: 4, color: PANEL })
  const exported = changed(fixture(4, 6, WIDTH + 8, HEIGHT + 12), { x: 180, y: 47, width: 3, height: 4, color: PANEL })
  const dim: RGB = [181, 185, 191]
  paint(source, { x: 176, y: 39, width: 1, height: 12, color: dim })
  paint(exported, { x: 180, y: 45, width: 1, height: 12, color: dim })
  const live = { ...geometry(), labels: [FORMULA, { ...GLYPH, y: 36, height: 18 }] }
  const baseline = verify(source, exported, live)
  expect(baseline.labels[1].recall.total).toBe(0)
  expect(baseline.raw.labels[1].recall.total).toBe(12)
  const missing = changed(exported, { x: 180, y: 45, width: 1, height: 12, color: PANEL })
  expect(() => verify(source, missing, live)).toThrow(/Missing math pixels/)
})

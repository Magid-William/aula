import { expect, test } from 'playwright/test'
import type { PixelRaster } from './diagram-pixels'
import { assertChartRasterConsistency, compareChartRasterConsistency } from './chart-raster-consistency'

const paper = [250, 248, 245]
function fixture(): PixelRaster {
  const width = 32, height = 16, data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([...paper, 255], i)
  // Trazo opaco con borde antialias y un píxel cercano al umbral de tinta.
  for (let y = 4; y < 12; y++) for (let x = 10; x < 20; x++) data.set([x === 10 ? 210 : 70, 80, 90, 255], (y * width + x) * 4)
  data.set([221, 248, 245, 255], (4 * width + 9) * 4)
  return { width, height, data }
}
const copy = (raster: PixelRaster): PixelRaster => ({ ...raster, data: Uint8ClampedArray.from(raster.data) })
const compare = (a: PixelRaster, b: PixelRaster) => assertChartRasterConsistency(compareChartRasterConsistency(a, b, paper))

test('Chart raster: identidad y dos variaciones pequeñas en bordes existentes', () => {
  const a = fixture(), b = copy(a), pixels = b.data as Uint8ClampedArray
  expect(() => compare(a, a)).not.toThrow()
  pixels[(4 * a.width + 10) * 4] += 3; pixels[(11 * a.width + 10) * 4] -= 1
  expect(compareChartRasterConsistency(a, b, paper)).toMatchObject({ changedPixels: 2, maxChannelDelta: 3, alphaEqual: true, foregroundEqual: true, edgeOnly: true })
  expect(() => compare(a, b)).not.toThrow()
})

for (const failure of ['three-pixels', 'delta-four', 'alpha', 'foreground', 'flat-speck', 'missing-stroke'] as const) test(`Chart raster rechaza ${failure}`, () => {
  const a = fixture(), b = copy(a), pixels = b.data as Uint8ClampedArray
  if (failure === 'three-pixels') for (const y of [4, 5, 6]) pixels[(y * a.width + 10) * 4]++
  if (failure === 'delta-four') pixels[(4 * a.width + 10) * 4] += 4
  if (failure === 'alpha') pixels[(4 * a.width + 10) * 4 + 3]--
  if (failure === 'foreground') pixels[(4 * a.width + 9) * 4]++
  if (failure === 'flat-speck') pixels[(2 * a.width + 2) * 4] -= 3
  if (failure === 'missing-stroke') for (let y = 4; y < 12; y++) pixels.set([...paper, 255], (y * a.width + 12) * 4)
  expect(() => compare(a, b)).toThrow()
})

test('Chart raster rechaza dimensiones diferentes', () => {
  const a = fixture()
  expect(() => compare(a, { ...a, width: a.width - 1 })).toThrow('dimensions')
})

// Controles puros sobre los dos PNG reales; no abre Electron ni usa el oráculo correlacional.
import { test, expect } from 'playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeDiagramFramePng, diagramHoverFramePixels, type DiagramFrameRaster } from './diagram-frame'

const natural = { width: 1029, height: 547 }
const fixture = (name: string): DiagramFrameRaster => decodeDiagramFramePng(readFileSync(join(__dirname, 'diagram-frame-fixtures', `${name}.png`)))
function transformed(source: DiagramFrameRaster, dx: number, dy: number, scale = 1): DiagramFrameRaster {
  const { width, height } = source, data = new Uint8Array(width * height * 4), paper = [19, 17, 14, 255]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor((x - dx) / scale), sy = Math.floor((y - dy) / scale), at = (y * width + x) * 4
    data.set(sx >= 0 && sy >= 0 && sx < width && sy < height ? source.data.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4) : paper, at)
  }
  return { width, height, data }
}

test('encuadre Diagram: acepta PNG bueno y rechaza el fallo real aunque las dimensiones sean iguales', async ({}, info) => {
  const good = diagramHoverFramePixels(fixture('framed'), natural), bad = diagramHoverFramePixels(fixture('missing-frame'), natural)
  writeFileSync(info.outputPath('real-frame-controls.json'), JSON.stringify({ good, bad }, null, 2))
  expect(good.accepted).toBe(true); expect(bad.accepted).toBe(false)
  expect(bad.dimensions).toEqual(good.dimensions)
  expect(good.anchors.every(anchor => anchor.accepted)).toBe(true)
  expect(bad.anchors.some(anchor => !anchor.accepted)).toBe(true)
  expect(good.dots?.accepted).toBe(true); expect(bad.dots?.accepted).toBe(false)
})

test('encuadre Diagram: rechaza traslación, periodo completo, escala y recorte sin realinear', async ({}, info) => {
  const good = fixture('framed')
  const variants = [
    { name: 'missing-offset', image: transformed(good, -52, -48) },
    { name: 'double-offset', image: transformed(good, 52, 48) },
    { name: 'one-period-x', image: transformed(good, 36, 0) },
    { name: 'one-period-y', image: transformed(good, 0, 36) },
    { name: 'half-scale', image: transformed(good, 0, 0, .5) },
    { name: 'uniform-blank', image: { ...good, data: Uint8Array.from({ length: good.data.length }, (_, i) => [19, 17, 14, 255][i % 4]) } },
    { name: 'cropped-dimension', image: { ...good, width: good.width - 1 } }
  ].map(({ name, image }) => ({ name, report: diagramHoverFramePixels(image, natural) }))
  writeFileSync(info.outputPath('negative-frame-controls.json'), JSON.stringify(variants, null, 2))
  expect(variants.map(item => item.report.accepted)).toEqual(variants.map(() => false))
})

test('encuadre Diagram: decoder cerrado rechaza firma, truncación y dimensiones desmesuradas', () => {
  const bytes = readFileSync(join(__dirname, 'diagram-frame-fixtures/framed.png'))
  const huge = Buffer.from(bytes); huge.writeUInt32BE(65536, 16)
  for (const invalid of [Buffer.from('not png'), bytes.subarray(0, 30), huge]) expect(() => decodeDiagramFramePng(invalid)).toThrow()
})


test('encuadre Diagram: el dominio y tamaño esperado dependen del DOM, no de las dimensiones del PNG', () => {
  const good = fixture('framed')
  for (const size of [{ width: 1027, height: 547 }, { width: 1030, height: 547 }, { width: 1028.5, height: 547 }, { width: 1029, height: 546 }, { width: 1029, height: 548 }]) {
    expect(() => diagramHoverFramePixels(good, size)).toThrow('Unexpected geometry')
  }
  for (const width of [1028, 1029]) {
    const expectedWidth = 2 * (width + 35)
    for (const dimensions of [{ width: expectedWidth - 1, height: 1188 }, { width: expectedWidth + 1, height: 1188 }, { width: expectedWidth, height: 1187 }, { width: expectedWidth, height: 1189 }]) {
      expect(diagramHoverFramePixels({ ...good, ...dimensions }, { width, height: 547 }).accepted).toBe(false)
    }
  }
  expect(diagramHoverFramePixels(good, { width: 1028, height: 547 }).accepted).toBe(false)
})

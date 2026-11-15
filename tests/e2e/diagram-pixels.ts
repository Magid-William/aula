// Oráculo independiente: sólo píxeles vivos, geometría DOM observada y PNG reabierto.
// No lee DTO, bounds del exportador ni sus helpers de presentación.
import { writeFileSync } from 'node:fs'
import type { Page, TestInfo } from 'playwright/test'

export interface PixelRect { x: number; y: number; width: number; height: number }
export interface LiveDiagramGeometry {
  /** Captura del viewport con screenshot({ scale: 'css' }), sin redondear estas medidas DOM. */
  width: number
  height: number
  /** Caja viva relativa al viewport; naturalWidth/Height salen de offsetWidth/Height o CSS width/height. */
  canvas: PixelRect & { naturalWidth: number; naturalHeight: number; scale: number }
  /** RGB opaco calculado de getComputedStyle(viewport).backgroundColor, nunca del exportador. */
  background: [number, number, number]
  exclusions: Array<PixelRect & { kind?: 'button' | 'hint'; label?: string }>
  /** Runs RichText visibles; incluir además cada .katex-html como kind:'math'. */
  labels: Array<PixelRect & { text: string; kind?: 'text' | 'math' }>
  /** Sólo el fixture de paso narrativo vacío autoriza ausencia total de tinta. */
  expectedEmpty?: boolean
}
export interface PixelRaster { width: number; height: number; data: ArrayLike<number> }
interface MatchScore { total: number; matched: number; ratio: number }
interface LabelScore { text: string; kind: 'text' | 'math'; exposedPixels: number; background: number[]; recall: MatchScore; precision: MatchScore; skipped: boolean }
export interface DiagramPixelComparison {
  source: { width: number; height: number }
  exported: { width: number; height: number; foreground: number }
  natural: { width: number; height: number; scale: number; extraWidth: number; extraHeight: number }
  alignment: { dx: number; dy: number; samples: number; averageColorError: number; search: { minX: number; maxX: number; minY: number; maxY: number } }
  all: { recall: MatchScore; precision: MatchScore }
  labels: LabelScore[]
  raw: { all: { recall: MatchScore; precision: MatchScore }; labels: LabelScore[]; exportedForeground: number; alignment: DiagramPixelComparison['alignment'] }
}

/** Promedio de cobertura exacta: no sobremuestrea barras finas al reducir PNG 2× a una escala CSS fraccionaria. */
export function resampleDiagramPixels(raster: PixelRaster, width: number, height: number): PixelRaster {
  if (![raster.width, raster.height, width, height].every(n => Number.isInteger(n) && n > 0)) throw new Error('Invalid oracle raster dimensions')
  if (width === raster.width && height === raster.height) return raster
  const data = new Uint8ClampedArray(width * height * 4), scaleX = raster.width / width, scaleY = raster.height / height
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const left = x * scaleX, right = Math.min(raster.width, (x + 1) * scaleX), top = y * scaleY, bottom = Math.min(raster.height, (y + 1) * scaleY)
    const sums = [0, 0, 0, 0]
    for (let yy = Math.floor(top); yy < Math.ceil(bottom); yy++) for (let xx = Math.floor(left); xx < Math.ceil(right); xx++) {
      const area = (Math.min(right, xx + 1) - Math.max(left, xx)) * (Math.min(bottom, yy + 1) - Math.max(top, yy))
      for (let c = 0; c < 4; c++) sums[c] += raster.data[(yy * raster.width + xx) * 4 + c] * area
    }
    for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = sums[c] / ((right - left) * (bottom - top))
  }
  return { width, height, data }
}

/** Función pura, autocontenida también al serializarla para ejecutarla junto al decoder del navegador. */
export function diagramPixelOracle(source: PixelRaster, exported: PixelRaster, geometry: LiveDiagramGeometry): DiagramPixelComparison {
  // El mismo filtro binomial 3×3 (σ≈0,707 píxeles CSS) en ambos rasters; radio y umbrales intactos.
  function normalize(raster: PixelRaster): PixelRaster {
    const horizontal = new Float64Array(raster.data.length), data = new Uint8ClampedArray(raster.data.length)
    for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) for (let c = 0; c < 4; c++) {
      const i = (y * raster.width + x) * 4 + c
      horizontal[i] = (raster.data[(y * raster.width + Math.max(0, x - 1)) * 4 + c] + 2 * raster.data[i] + raster.data[(y * raster.width + Math.min(raster.width - 1, x + 1)) * 4 + c]) / 4
    }
    for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) for (let c = 0; c < 4; c++) {
      const i = (y * raster.width + x) * 4 + c
      data[i] = (horizontal[(Math.max(0, y - 1) * raster.width + x) * 4 + c] + 2 * horizontal[i] + horizontal[(Math.min(raster.height - 1, y + 1) * raster.width + x) * 4 + c]) / 4
    }
    return { width: raster.width, height: raster.height, data }
  }
  function measureRasters(source: PixelRaster, exported: PixelRaster): Omit<DiagramPixelComparison, 'raw'> {
    const maxChannel = (a: number[], b: number[]): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
    const distance = (a: number[], b: number[]): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
    const rgb = (r: PixelRaster, x: number, y: number): number[] => {
      // Interpolación bilineal sólo al consultar la otra imagen en una coordenada subpíxel.
      // Los píxeles contados como tinta de cada dirección permanecen en su cuadrícula original.
      const x0 = Math.floor(x), y0 = Math.floor(y), u = x - x0, v = y - y0
      // Coordenadas enteras: resultado idéntico sin cuatro vecinos bilineales.
      if (u === 0 && v === 0) { const i = (y0 * r.width + x0) * 4; return [r.data[i], r.data[i + 1], r.data[i + 2]] }
      const result = [0, 0, 0]
      for (const [xx, wx] of [[x0, 1 - u], [Math.min(r.width - 1, x0 + 1), u]]) for (const [yy, wy] of [[y0, 1 - v], [Math.min(r.height - 1, y0 + 1), v]]) {
        for (let c = 0; c < 3; c++) result[c] += r.data[(yy * r.width + xx) * 4 + c] * wx * wy
      }
      return result
    }
    const inside = (r: PixelRaster, x: number, y: number): boolean => x >= 0 && y >= 0 && x < r.width && y < r.height
    const excluded = (x: number, y: number): boolean => geometry.exclusions.some(b => x >= b.x - 3 && y >= b.y - 3 && x < b.x + b.width + 3 && y < b.y + b.height + 3)
    // El borde redondeado pertenece al viewport. También se excluyen sus seis píxeles interiores.
    const exposed = (x: number, y: number): boolean => x >= 6 && y >= 6 && x < Math.min(source.width, geometry.width) - 6 && y < Math.min(source.height, geometry.height) - 6 && !excluded(x, y)
    const foreground = (color: number[], background: number[], threshold = 28): boolean => maxChannel(color, background) > threshold
    const score = (total: number, matched: number): MatchScore => ({ total, matched, ratio: total ? matched / total : 1 })
    const naturalWidth = geometry.canvas.naturalWidth * geometry.canvas.scale
    const naturalHeight = geometry.canvas.naturalHeight * geometry.canvas.scale
    const extraWidth = exported.width - naturalWidth, extraHeight = exported.height - naturalHeight
    if (![geometry.width, geometry.height, geometry.canvas.scale, naturalWidth, naturalHeight].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid independent live geometry')
    if (Math.abs(source.width - geometry.width) > 2 || Math.abs(source.height - geometry.height) > 2) throw new Error('The live screenshot must use CSS scale and cover the observed viewport')
    // Estos fixtures no están sujetos al downscale de 4096. Un export recortado no se realinea para ocultar el error.
    if (extraWidth < -2 || extraHeight < -2 || extraWidth > 256 * geometry.canvas.scale + 3 || extraHeight > 256 * geometry.canvas.scale + 3) throw new Error('PNG extent contradicts the independent natural canvas (or fixture exceeds uncapped oracle limits)')

    // El margen se deduce sólo del tamaño PNG y del lienzo DOM. No se presupone cómo reparte padding el exportador.
    const minX = Math.floor(-geometry.canvas.x - 3), maxX = Math.ceil(-geometry.canvas.x + Math.max(0, extraWidth) + 3)
    const minY = Math.floor(-geometry.canvas.y - 3), maxY = Math.ceil(-geometry.canvas.y + Math.max(0, extraHeight) + 3)
    const candidates: Array<{ x: number; y: number; color: number[] }> = []
    for (let y = 7; y < source.height - 7; y += 2) for (let x = 7; x < source.width - 7; x += 2) {
      if (!exposed(x, y)) continue
      const color = rgb(source, x, y)
      if (!foreground(color, geometry.background)) continue
      // Correlaciona contornos y letras, no superficies planas que permitirían desplazar una tarjeta entera.
      const gradient = Math.max(...[[x - 2, y], [x + 2, y], [x, y - 2], [x, y + 2]].map(([xx, yy]) => maxChannel(color, rgb(source, xx, yy))))
      if (gradient >= 14) candidates.push({ x, y, color })
    }
    const samples = candidates.length <= 700 ? candidates : Array.from({ length: 700 }, (_, i) => candidates[Math.floor(i * candidates.length / 700)])
    const localError = (r: PixelRaster, x: number, y: number, color: number[], radius: number): number => {
      let best = 255
      for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
        const xx = x + ox, yy = y + oy
        if (!inside(r, xx, yy)) continue
        best = Math.min(best, distance(color, rgb(r, xx, yy)) / 3)
      }
      return best
    }
    let dx = -geometry.canvas.x, dy = -geometry.canvas.y, bestCost = Infinity
    const tryOffset = (x: number, y: number): void => {
      if (!samples.length) return
      let cost = 0
      for (const sample of samples) {
        cost += Math.min(70, localError(exported, sample.x + x, sample.y + y, sample.color, 0))
        // Los costes son no negativos: esta traslación ya no puede mejorar el mínimo.
        if (cost / samples.length >= bestCost) return
      }
      cost /= samples.length
      if (cost < bestCost) { bestCost = cost; dx = x; dy = y }
    }
    if (samples.length) {
      // Un salto de dos píxeles puede omitir el mínimo entre barras periódicas.
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) tryOffset(x, y)
      const coarseX = dx, coarseY = dy
      for (let y = coarseY - 2; y <= coarseY + 2; y++) for (let x = coarseX - 2; x <= coarseX + 2; x++) if (x >= minX && x <= maxX && y >= minY && y <= maxY) tryOffset(x, y)
      // La captura CSS y el PNG pueden comenzar en distintas fases fraccionarias del píxel.
      // Correlaciona esa traslación; conserva el rango geométrico, radio de matching y umbrales.
      for (const [reach, step] of [[1, 1 / 4], [1 / 4, 1 / 8]]) {
        const centerX = dx, centerY = dy
        for (let y = centerY - reach; y <= centerY + reach; y += step) for (let x = centerX - reach; x <= centerX + reach; x += step) if (x >= minX && x <= maxX && y >= minY && y <= maxY) tryOffset(x, y)
      }
    }
    const matched = (r: PixelRaster, x: number, y: number, color: number[], background: number[]): boolean => {
      // Un solo píxel de tolerancia para antialias/subpixel; no puede ocultar el desplazamiento de una línea completa.
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox, yy = y + oy
        if (!inside(r, xx, yy)) continue
        const other = rgb(r, xx, yy)
        if (foreground(other, background, 18) && distance(color, other) <= 54 && maxChannel(color, other) <= 30) return true
      }
      return false
    }
    function measure(box: PixelRect, background: number[]): { recall: MatchScore; precision: MatchScore; exposedPixels: number } {
      let sourceTotal = 0, sourceMatched = 0, outputTotal = 0, outputMatched = 0, exposedPixels = 0
      const left = Math.max(0, Math.floor(box.x)), top = Math.max(0, Math.floor(box.y)), right = Math.min(source.width, Math.ceil(box.x + box.width)), bottom = Math.min(source.height, Math.ceil(box.y + box.height))
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        if (!exposed(x, y)) continue
        exposedPixels++
        const color = rgb(source, x, y)
        if (foreground(color, background)) { sourceTotal++; if (matched(exported, x + dx, y + dy, color, background)) sourceMatched++ }
        const ex = Math.round(x + dx), ey = Math.round(y + dy)
        if (!inside(exported, ex, ey)) continue
        const other = rgb(exported, ex, ey)
        if (foreground(other, background)) { outputTotal++; if (matched(source, ex - dx, ey - dy, other, background)) outputMatched++ }
      }
      return { recall: score(sourceTotal, sourceMatched), precision: score(outputTotal, outputMatched), exposedPixels }
    }
    function modalBackground(box: PixelRect): number[] {
      const colors = new Map<number, { count: number; sums: number[] }>()
      for (let y = Math.max(0, Math.floor(box.y) - 3); y < Math.min(source.height, Math.ceil(box.y + box.height) + 3); y++) for (let x = Math.max(0, Math.floor(box.x) - 3); x < Math.min(source.width, Math.ceil(box.x + box.width) + 3); x++) {
        if (!exposed(x, y)) continue
        const c = rgb(source, x, y), key = (c[0] >> 3) * 1024 + (c[1] >> 3) * 32 + (c[2] >> 3)
        const entry = colors.get(key) ?? { count: 0, sums: [0, 0, 0] }
        entry.count++; for (let i = 0; i < 3; i++) entry.sums[i] += c[i]
        colors.set(key, entry)
      }
      const winner = [...colors.values()].sort((a, b) => b.count - a.count)[0]
      return winner ? winner.sums.map(n => n / winner.count) : geometry.background
    }
    const all = measure({ x: 0, y: 0, width: source.width, height: source.height }, geometry.background)
    const labels = geometry.labels.map(label => {
      const background = modalBackground(label), result = measure(label, background)
      return { text: label.text, kind: label.kind ?? 'text' as const, background, ...result, skipped: result.exposedPixels < 24 }
    })
    let exportedForeground = 0
    for (let y = 0; y < exported.height; y++) for (let x = 0; x < exported.width; x++) if (foreground(rgb(exported, x, y), geometry.background)) exportedForeground++
    return {
      source: { width: source.width, height: source.height }, exported: { width: exported.width, height: exported.height, foreground: exportedForeground },
      natural: { width: naturalWidth, height: naturalHeight, scale: geometry.canvas.scale, extraWidth, extraHeight },
      alignment: { dx, dy, samples: samples.length, averageColorError: samples.length ? bestCost : 0, search: { minX, maxX, minY, maxY } },
      all: { recall: all.recall, precision: all.precision }, labels
    }
  }
  const raw = measureRasters(source, exported), normalized = measureRasters(normalize(source), normalize(exported))
  return { ...normalized, raw: { all: raw.all, labels: raw.labels, exportedForeground: raw.exported.foreground, alignment: raw.alignment } }

}

export function assertDiagramPixelComparison(result: DiagramPixelComparison, geometry: LiveDiagramGeometry): void {
  const check = (ok: boolean, message: string): void => { if (!ok) throw new Error(message) }
  if (geometry.expectedEmpty) {
    check(result.raw.all.recall.total < 24 && result.raw.exportedForeground < 24, `Blank fixture contains foreground: source=${result.raw.all.recall.total}, complete output=${result.raw.exportedForeground}`)
    return
  }
  check(result.alignment.samples >= 20, `Live oracle has too few distinct contours (${result.alignment.samples})`)
  check(result.raw.all.recall.total >= 80, `Live oracle has too little foreground (${result.all.recall.total})`)
  check(result.alignment.averageColorError <= 18, `No credible independent pixel alignment (${result.alignment.averageColorError.toFixed(2)})`)
  check(result.all.recall.ratio >= .92, `Diagram foreground recall ${result.all.recall.ratio.toFixed(4)} < .92`)
  check(result.all.precision.ratio >= .90, `Diagram foreground precision ${result.all.precision.ratio.toFixed(4)} < .90`)
  for (const [index, label] of result.labels.entries()) {
    if (label.skipped) continue // Casi completamente recortado/oculto por UI; se informa explícitamente.
    check(result.raw.labels[index].recall.total >= 8, `Visible ${label.kind} has no readable source contrast: ${label.text}`)
    // Si el filtro elimina toda la tinta tenue, su 0/0 no demuestra que siga presente.
    // El contraste crudo ya validado conserva la misma exigencia local para ambos sentidos.
    const ink = label.recall.total === 0 ? result.raw.labels[index] : label
    check(ink.recall.ratio >= .86, `Missing ${label.kind} pixels (${ink.recall.ratio.toFixed(4)}): ${label.text}`)
    check(ink.precision.ratio >= .82, `Extra ${label.kind} pixels (${ink.precision.ratio.toFixed(4)}): ${label.text}`)
  }
}

/** PNG decodificado por Image/Canvas del navegador; el cálculo usa sólo sus píxeles finales. */
export async function compareDiagramPixels(page: Page, live: Buffer, saved: Buffer, geometry: LiveDiagramGeometry, info: TestInfo, name: string): Promise<DiagramPixelComparison> {
  const input = { before: live.toString('base64'), after: saved.toString('base64'), geometry }
  // Se inserta nuestra función pura, nunca contenido ejecutable suministrado por el documento.
  const script = `(async () => {
    const input = ${JSON.stringify(input).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};
    const resample = ${resampleDiagramPixels.toString()};
    async function decode(base64, factor) {
      const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }); if (!context) throw new Error('Oracle canvas is unavailable');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const raster = { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
      canvas.width = canvas.height = 0; return resample(raster, Math.round(raster.width * factor), Math.round(raster.height * factor));
    }
    const compare = ${diagramPixelOracle.toString()};
    return compare(await decode(input.before, 1), await decode(input.after, input.geometry.canvas.scale / 2), input.geometry);
  })()`
  const result = await page.evaluate<DiagramPixelComparison>(script)
  const path = info.outputPath(`${name}-live-comparison.json`)
  writeFileSync(path, JSON.stringify(result, null, 2))
  await info.attach(`${name}-live-comparison.json`, { path, contentType: 'application/json' })
  assertDiagramPixelComparison(result, geometry)
  return result
}

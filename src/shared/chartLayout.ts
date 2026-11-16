/** Aritmética de las cajas HTML de Chart; no cuantiza texto inline ni geometría SVG. */
export type LayoutInterval = Readonly<{ lo: number; hi: number }>

export const CHART_LAYOUT_LIMITS = Object.freeze({
  maxUnit: 2 ** 24,
  minRawZoom: 1 / 16,
  maxRawZoom: 64,
  minCssZoom: 1 / 8,
  maxCssZoom: 8,
  minPrivateZoom: 1 / 2,
  maxPrivateZoom: 8
})

const bits = new DataView(new ArrayBuffer(8))
const fail = (message: string): never => { throw new RangeError(message) }
const finite = (n: number): number => Number.isFinite(n) ? n : fail('Valor no finito')
const float32 = (n: number): number =>
  Number.isFinite(n) && Math.fround(n) === n ? n : fail('Se esperaba un Float32 finito')

function boundedFloat32(n: number, lo: number, hi: number): number {
  float32(n)
  return n >= lo && n <= hi ? n : fail('Float32 fuera del dominio de Chart')
}

function rawZoom(n: number): number {
  return boundedFloat32(n, CHART_LAYOUT_LIMITS.minRawZoom, CHART_LAYOUT_LIMITS.maxRawZoom)
}

/** Vecino representable, no una tolerancia dependiente del tamaño de la escena. */
export function nextFloat32(n: number, direction: -1 | 1): number {
  float32(n)
  if (n === 0) return direction * 2 ** -149
  bits.setFloat32(0, n)
  bits.setUint32(0, bits.getUint32(0) + (n > 0 ? direction : -direction))
  return bits.getFloat32(0)
}

export function nextFloat64(n: number, direction: -1 | 1): number {
  finite(n)
  if (n === 0) return direction * Number.MIN_VALUE
  bits.setFloat64(0, n)
  bits.setBigUint64(0, bits.getBigUint64(0) + BigInt(n > 0 ? direction : -direction))
  return bits.getFloat64(0)
}

function interval(lo: number, hi: number): LayoutInterval {
  finite(lo)
  finite(hi)
  return lo <= hi ? { lo, hi } : fail('Intervalo invertido')
}

function checked(value: LayoutInterval): LayoutInterval {
  return interval(value.lo, value.hi)
}

function outward(lo: number, hi: number): LayoutInterval {
  return interval(nextFloat64(lo, -1), nextFloat64(hi, 1))
}

/** Extremos cerrados conservadores: los empates se filtran después mediante la operación exacta. */
export function float32Cell(n: number): LayoutInterval {
  float32(n)
  const previous = nextFloat32(n, -1)
  const next = nextFloat32(n, 1)
  // El umbral de overflow queda a media ULP del último valor finito.
  const lo = Number.isFinite(previous) ? (previous + n) / 2 : n - (next - n) / 2
  const hi = Number.isFinite(next) ? (n + next) / 2 : n + (n - previous) / 2
  return interval(lo, hi)
}

export function addIntervals(a: LayoutInterval, b: LayoutInterval): LayoutInterval {
  checked(a); checked(b)
  return outward(a.lo + b.lo, a.hi + b.hi)
}

export function subtractIntervals(a: LayoutInterval, b: LayoutInterval): LayoutInterval {
  checked(a); checked(b)
  return outward(a.lo - b.hi, a.hi - b.lo)
}

export function multiplyIntervals(a: LayoutInterval, b: LayoutInterval): LayoutInterval {
  checked(a); checked(b)
  const products = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi]
  return outward(Math.min(...products), Math.max(...products))
}

export function divideIntervals(a: LayoutInterval, b: LayoutInterval): LayoutInterval {
  checked(a); checked(b)
  if (b.lo <= 0 && b.hi >= 0) fail('Divisor que contiene cero')
  const quotients = [a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi]
  return outward(Math.min(...quotients), Math.max(...quotients))
}

// Sólo se enumeran preimágenes de una celda normal escalada, nunca una rejilla de posiciones.
function positiveFloat32Candidates(value: LayoutInterval, lo: number, hi: number): number[] {
  checked(value)
  const lower = Math.max(value.lo, lo)
  const upper = Math.min(value.hi, hi)
  if (lower > upper) return []
  let first = Math.fround(lower)
  if (first < lower) first = nextFloat32(first, 1)
  let last = Math.fround(upper)
  if (last > upper) last = nextFloat32(last, -1)
  if (first > last) return []
  bits.setFloat32(0, first)
  const firstBits = bits.getUint32(0)
  bits.setFloat32(0, last)
  const count = bits.getUint32(0) - firstBits + 1
  // Una entrada fuera del dominio demostrado falla; no se recorta la búsqueda.
  if (count > 8) fail('Preimagen Float32 demasiado amplia')
  return Array.from({ length: count }, (_, i) => {
    bits.setUint32(0, firstBits + i)
    return bits.getFloat32(0)
  })
}

/** La procedencia float/axis de los factores CTM debe comprobarse en el adaptador DOM. */
export function recoverEffectiveZoom(
  initialZoom: number,
  currentCssZoom: number,
  provenAxisScales?: readonly [number, number]
): number {
  float32(initialZoom)
  if (initialZoom <= 0) fail('InitialZoom debe ser positivo')
  boundedFloat32(currentCssZoom, CHART_LAYOUT_LIMITS.minCssZoom, CHART_LAYOUT_LIMITS.maxCssZoom)
  if (provenAxisScales) {
    if (provenAxisScales.length !== 2) fail('Se requieren los dos ejes')
    for (const scale of provenAxisScales) if (finite(scale) <= 0) fail('Escala de eje no positiva')
  }
  const possible = multiplyIntervals(float32Cell(currentCssZoom), { lo: initialZoom, hi: initialZoom })
  const candidates = positiveFloat32Candidates(possible, CHART_LAYOUT_LIMITS.minRawZoom, CHART_LAYOUT_LIMITS.maxRawZoom)
    .filter(e => Math.fround(e / initialZoom) === currentCssZoom)
    .filter(e => !provenAxisScales || provenAxisScales.every(scale => Math.fround(scale / e) * e === scale))
  return candidates.length === 1 ? candidates[0] : fail('EffectiveZoom ausente o ambiguo')
}

/** El intervalo ya debe incluir todos los redondeos de la medición y su transformación. */
export function recoverLayoutUnit(value: LayoutInterval): number {
  checked(value)
  const first = Math.ceil(value.lo)
  const last = Math.floor(value.hi)
  if (first !== last || !Number.isSafeInteger(first)) fail('Unidad de layout ausente o ambigua')
  if (Math.abs(first) > CHART_LAYOUT_LIMITS.maxUnit) fail('Unidad de layout fuera del dominio')
  return first === 0 ? 0 : first
}

/** W sólo reproduce E mediante f32(I·W); su recíproco no es una compensación de pintura. */
export function resolveWrapperZoom(initialZoom: number, effectiveZoom: number): number {
  boundedFloat32(initialZoom, CHART_LAYOUT_LIMITS.minPrivateZoom, CHART_LAYOUT_LIMITS.maxPrivateZoom)
  rawZoom(effectiveZoom)
  const possible = divideIntervals(float32Cell(effectiveZoom), { lo: initialZoom, hi: initialZoom })
  const candidates = positiveFloat32Candidates(possible, CHART_LAYOUT_LIMITS.minCssZoom, CHART_LAYOUT_LIMITS.maxCssZoom)
    .filter(w => Math.fround(initialZoom * w) === effectiveZoom)
  if (!candidates.length) fail('EffectiveZoom no representable por el wrapper permitido')
  const ideal = effectiveZoom / initialZoom
  // Sólo representantes ya válidos; empate determinista hacia el menor.
  return candidates.reduce((best, w) => Math.abs(w - ideal) < Math.abs(best - ideal) ? w : best)
}

/** Chromium152: double CSS·E → float → LayoutUnit6; la conversión entera trunca hacia cero. */
export function decodeLayoutUnit(cssPixels: number, effectiveZoom: number): number {
  finite(cssPixels)
  rawZoom(effectiveZoom)
  const unit = Math.trunc(Math.fround(cssPixels * effectiveZoom) * 64)
  if (!Number.isSafeInteger(unit) || Math.abs(unit) > CHART_LAYOUT_LIMITS.maxUnit) fail('Unidad de layout fuera del dominio')
  return unit === 0 ? 0 : unit
}

/** Emite una unidad conocida, no redondea una posición arbitraria ni una medida inline. */
export function emitLayoutUnit(unit: number, effectiveZoom: number): number {
  rawZoom(effectiveZoom)
  if (!Number.isSafeInteger(unit) || Math.abs(unit) > CHART_LAYOUT_LIMITS.maxUnit) fail('Unidad de layout fuera del dominio')
  // |n|≤2^24 hace n/64 Float32 exacto. La división double queda en el interior de
  // su celda Float32: el error relativo double es muy inferior a media ULP float.
  const cssPixels = (unit / 64) / effectiveZoom
  if (decodeLayoutUnit(cssPixels, effectiveZoom) !== unit) fail('Invariante de emisión LayoutUnit incumplida')
  return cssPixels === 0 ? 0 : cssPixels
}

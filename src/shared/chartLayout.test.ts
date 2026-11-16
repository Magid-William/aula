import { describe, expect, it } from 'vitest'
import {
  addIntervals, decodeLayoutUnit, divideIntervals, emitLayoutUnit, float32Cell,
  multiplyIntervals, nextFloat32, nextFloat64, recoverEffectiveZoom, recoverLayoutUnit,
  resolveWrapperZoom, subtractIntervals, type LayoutInterval
} from './chartLayout'

const point = (n: number): LayoutInterval => ({ lo: n, hi: n })

// Oráculo racional independiente: las operaciones de intervalos no se verifican
// contra la misma aritmética double que las construye.
type Rational = readonly [bigint, bigint]
function rational(n: number): Rational {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, n)
  const raw = view.getBigUint64(0)
  const exponent = Number((raw >> 52n) & 2047n)
  const mantissa = (raw & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n)
  const power = (exponent ? exponent - 1023 : -1022) - 52
  const signed = raw >> 63n ? -mantissa : mantissa
  return power >= 0 ? [signed << BigInt(power), 1n] : [signed, 1n << BigInt(-power)]
}

function encloses(interval: LayoutInterval, [num, den]: Rational): void {
  if (den < 0n) { num = -num; den = -den }
  const [lo, ld] = rational(interval.lo)
  const [hi, hd] = rational(interval.hi)
  expect(lo * den <= num * ld).toBe(true)
  expect(hi * den >= num * hd).toBe(true)
}

describe('vecinos y celdas IEEE754 de Chart', () => {
  it('distingue ULP asimétrica, signo, cero y subnormales Float32', () => {
    expect(nextFloat32(1, 1)).toBe(1 + 2 ** -23)
    expect(nextFloat32(1, -1)).toBe(1 - 2 ** -24)
    expect(nextFloat32(-1, 1)).toBe(-1 + 2 ** -24)
    expect(nextFloat32(-1, -1)).toBe(-1 - 2 ** -23)
    expect(nextFloat32(-0, 1)).toBe(2 ** -149)
    expect(nextFloat32(0, -1)).toBe(-(2 ** -149))
    expect(nextFloat32(2 ** -149, -1)).toBe(0)
    expect(float32Cell(0)).toEqual({ lo: -(2 ** -150), hi: 2 ** -150 })
  })

  it('conserva los empates como candidatos y permite descartarlos por decodificación', () => {
    expect(float32Cell(1)).toEqual({ lo: 1 - 2 ** -25, hi: 1 + 2 ** -24 })
    const odd = 1 + 2 ** -23
    const cell = float32Cell(odd)
    expect(cell).toEqual({ lo: 1 + 2 ** -24, hi: 1 + 3 * 2 ** -24 })
    expect(Math.fround(cell.lo)).toBe(1)
    expect(Math.fround(cell.hi)).toBe(1 + 2 ** -22)
    expect(Math.fround(nextFloat64(cell.lo, 1))).toBe(odd)
    expect(Math.fround(nextFloat64(cell.hi, -1))).toBe(odd)
  })

  it('acota también el umbral de overflow Float32 sin introducir infinito en la celda', () => {
    const max = (2 - 2 ** -23) * 2 ** 127
    expect(nextFloat32(max, 1)).toBe(Infinity)
    expect(float32Cell(max).hi).toBe(max + 2 ** 103)
    expect(float32Cell(-max).lo).toBe(-max - 2 ** 103)
  })

  it('calcula vecinos Float64 exactos y rechaza valores no representables', () => {
    expect(nextFloat64(1, 1)).toBe(1 + 2 ** -52)
    expect(nextFloat64(1, -1)).toBe(1 - 2 ** -53)
    expect(nextFloat64(-1, 1)).toBe(-1 + 2 ** -53)
    expect(nextFloat64(-1, -1)).toBe(-1 - 2 ** -52)
    expect(nextFloat64(0, -1)).toBe(-Number.MIN_VALUE)
    expect(nextFloat64(-0, 1)).toBe(Number.MIN_VALUE)
    for (const n of [NaN, Infinity, -Infinity, 1.1]) {
      expect(() => float32Cell(n)).toThrow(RangeError)
      expect(() => nextFloat32(n, 1)).toThrow(RangeError)
    }
    expect(() => nextFloat64(NaN, 1)).toThrow(RangeError)
  })
})

describe('intervalos hacia fuera y unidades únicas', () => {
  it('encierra resultados racionales exactos aun con cancelación, underflow y cocientes inexactos', () => {
    const samples = [0, Number.MIN_VALUE, -(2 ** -149), 0.1, -0.3, 1, -3, 2 ** 40]
    for (const a of samples) for (const b of samples) {
      const [an, ad] = rational(a)
      const [bn, bd] = rational(b)
      encloses(addIntervals(point(a), point(b)), [an * bd + bn * ad, ad * bd])
      encloses(subtractIntervals(point(a), point(b)), [an * bd - bn * ad, ad * bd])
      encloses(multiplyIntervals(point(a), point(b)), [an * bn, ad * bd])
      // El overflow queda fuera del dominio de los intervalos finitos.
      if (b !== 0 && Number.isFinite(a / b)) encloses(divideIntervals(point(a), point(b)), [an * bd, ad * bn])
    }
  })

  it('respeta extremos interiores, signos mixtos y divisores negativos', () => {
    const a = { lo: -3, hi: 2 }, b = { lo: -7, hi: -4 }
    for (const x of [-3, -1, 0, 2]) for (const y of [-7, -5, -4]) {
      const [xn, xd] = rational(x), [yn, yd] = rational(y)
      encloses(multiplyIntervals(a, b), [xn * yn, xd * yd])
      encloses(divideIntervals(a, b), [xn * yd, xd * yn])
      encloses(subtractIntervals(a, b), [xn * yd - yn * xd, xd * yd])
    }
  })

  it('rechaza intervalos mal formados, división por cero y overflow', () => {
    for (const bad of [{ lo: 2, hi: 1 }, { lo: NaN, hi: 2 }, { lo: 0, hi: Infinity }]) {
      expect(() => addIntervals(bad, point(1))).toThrow(RangeError)
      expect(() => recoverLayoutUnit(bad)).toThrow(RangeError)
    }
    expect(() => divideIntervals(point(1), { lo: -1, hi: 1 })).toThrow(RangeError)
    expect(() => divideIntervals(point(0), point(0))).toThrow(RangeError)
    expect(() => multiplyIntervals(point(Number.MAX_VALUE), point(2))).toThrow(RangeError)
  })

  it('recupera una sola unidad firmada sin elegir la más cercana ni recortar el dominio', () => {
    expect(recoverLayoutUnit({ lo: 30.99, hi: 31.01 })).toBe(31)
    expect(recoverLayoutUnit({ lo: -31.01, hi: -30.99 })).toBe(-31)
    expect(recoverLayoutUnit({ lo: -0.1, hi: 0.1 })).toBe(0)
    expect(recoverLayoutUnit(point(2 ** 24))).toBe(2 ** 24)
    for (const bad of [point(0.5), { lo: 31, hi: 32 }, { lo: 1.1, hi: 1.9 }, point(2 ** 24 + 1), { lo: 2 ** 24, hi: 2 ** 24 + 1 }]) {
      expect(() => recoverLayoutUnit(bad)).toThrow(RangeError)
    }
  })

  it('propaga la incertidumbre de dos BCR y rechaza un origen demasiado grande', () => {
    const recover = (origin: number, unit: number): number => {
      const position = Math.fround(origin + 1.75 * (unit / (64 * 3.5)))
      const relative = subtractIntervals(float32Cell(position), float32Cell(origin))
      return recoverLayoutUnit(multiplyIntervals(divideIntervals(relative, point(1.75)), point(64 * 3.5)))
    }
    for (const origin of [19.1171875, 1023.125, -1023.125]) {
      expect(recover(origin, 3360)).toBe(3360)
      expect(recover(origin, 3361)).toBe(3361)
      expect(recover(origin, -3360)).toBe(-3360)
    }
    expect(() => recover(2 ** 27, 3360)).toThrow(/ambigua/)
    // Un resultado inline de media unidad no entra en esta recuperación de cajas.
    expect(() => recoverLayoutUnit(point(3360.5))).toThrow(/ausente/)
  })
})

describe('EffectiveZoom y representante CSS', () => {
  it('distingue InitialZoom, EffectiveZoom y el zoom propio del wrapper', () => {
    expect(recoverEffectiveZoom(2, 1.75)).toBe(3.5)
    expect(resolveWrapperZoom(2, 3.5)).toBe(1.75)
    expect(resolveWrapperZoom(1, 3.5)).toBe(3.5)
    expect(recoverEffectiveZoom(16, 1)).toBe(16)
    expect(resolveWrapperZoom(8, 64)).toBe(8)
    expect(resolveWrapperZoom(0.5, 1 / 16)).toBe(1 / 8)
  })

  it('no elige uno de dos E que producen el mismo currentCSSZoom', () => {
    const initial = Math.fround(1.2)
    expect(Math.fround(2.625 / initial)).toBe(2.1875)
    expect(Math.fround(2.625000238418579 / initial)).toBe(2.1875)
    expect(() => recoverEffectiveZoom(initial, 2.1875)).toThrow(/ambiguo/)
    // Estos factores son datos de una cadena axis-float demostrada, no una matriz arbitraria.
    expect(recoverEffectiveZoom(initial, 2.1875, [1.3125, 1.3125])).toBe(2.625)
    expect(() => recoverEffectiveZoom(initial, 2.1875, [1.3125, 1.3125001192092896])).toThrow(/ausente/)
  })

  it('elige entre representantes válidos por distancia algebraica y conserva el decode exacto', () => {
    const e = 1.0000001192092896
    expect(Math.fround(1.25 * 0.8000000715255737)).toBe(e)
    expect(Math.fround(1.25 * 0.8000001311302185)).toBe(e)
    expect(resolveWrapperZoom(1.25, e)).toBe(0.8000000715255737)
    for (const i of [0.5, 1, 1.25, 1.5, 2, 3, 8]) for (const css of [0.125, 1.4, 1.8, 1.75, 2.1875, 8]) {
      const effective = Math.fround(i * Math.fround(css))
      const wrapper = resolveWrapperZoom(i, effective)
      expect(Math.fround(i * Number(String(wrapper)))).toBe(effective)
      expect(wrapper).toBeGreaterThanOrEqual(0.125)
      expect(wrapper).toBeLessThanOrEqual(8)
    }
  })

  it('no confunde la elección de W con una compensación de pintura', () => {
    const w = resolveWrapperZoom(1.25, 3.875)
    expect(w).toBe(Math.fround(3.1))
    expect(Math.fround(1.25 * w)).toBe(3.875)
    expect(Math.fround(1 / w)).toBe(0.3225806653499603)
    expect(Math.fround(1.25 / 3.875)).toBe(0.32258063554763794)
  })

  it('rechaza preimágenes ausentes y límites sin ensancharlos con una tolerancia', () => {
    expect(() => resolveWrapperZoom(1.25, 3.5000007152557373)).toThrow(/no representable/)
    for (const [i, e] of [[1, 64], [8, 1 / 16], [1, 65], [0.25, 1], [16, 2], [1.2, 2], [1, 1.1], [1, NaN], [1, Infinity]]) {
      expect(() => resolveWrapperZoom(i, e)).toThrow(RangeError)
    }
    for (const [i, css] of [[0, 1], [-1, 1], [Infinity, 1], [1.2, 1], [1, 1.1], [1, 9], [1, 0.0625]]) {
      expect(() => recoverEffectiveZoom(i, css)).toThrow(RangeError)
    }
    expect(() => recoverEffectiveZoom(2, 1.75, [Infinity, 1])).toThrow(RangeError)
    expect(() => recoverEffectiveZoom(2, 1.75, [-1, 1])).toThrow(RangeError)
  })
})

describe('emisión de unidades HTML conocidas', () => {
  it('trunca hacia cero, incluyendo las celdas negativas y cero', () => {
    expect(decodeLayoutUnit(-1.5 / 64, 1)).toBe(-1)
    expect(decodeLayoutUnit(1.5 / 64, 1)).toBe(1)
    expect(decodeLayoutUnit(-0.5 / 64, 1)).toBe(0)
    expect(decodeLayoutUnit(0.5 / 64, 1)).toBe(0)
    expect(decodeLayoutUnit(-2 / 64, 1)).toBe(-2)
    expect(Object.is(emitLayoutUnit(-0, 1), -0)).toBe(false)
  })

  it('reproduce vectores impares medidos en Chromium152 con InitialZoom1 y2', () => {
    // initial-zoom-control-v2: mismos anchos CSS, sin CDP; el segundo vector
    // conserva unidades impares que el modelo pageZoom-only perdería.
    const authored = [0, 1 / 128, 3 / 128, 31 / 128, 1 / 64, 3 / 64]
    const native1 = [0, 0, 1 / 64, 30 / 128, 1 / 64, 3 / 64]
    const native2 = [0, 1 / 128, 3 / 128, 31 / 128, 1 / 64, 3 / 64]
    expect(authored.map(q => decodeLayoutUnit(q, 1) / 64)).toEqual(native1)
    expect(authored.map(q => decodeLayoutUnit(q, 2) / 128)).toEqual(native2)
    const i = Math.fround(2.4), e = Math.fround(i * 1.75)
    const observed = [0, 0.013020833022892475, 0.0390625, 0.4231770634651184, 0.02604166604578495, 0.078125]
    expect(authored.map(q => Math.fround((decodeLayoutUnit(q, e) / 64) * Math.fround(1 / i)))).toEqual(observed)
  })

  it('emite exactamente extremos, signos, vecinos de potencias y zooms no diádicos', () => {
    const units = new Set([0, 1, 3, 31, 103, 12345, 2 ** 24])
    for (let k = 1; k <= 24; k++) for (const delta of [-1, 0, 1]) {
      const n = 2 ** k + delta
      if (n <= 2 ** 24) units.add(n)
    }
    const zooms = [1 / 16, 1, 1.4, 1.8, 1.75, 2.1875, 3.1, 64].map(Math.fround)
    for (const base of zooms) for (const e of [nextFloat32(base, -1), base, nextFloat32(base, 1)].filter(z => z >= 1 / 16 && z <= 64)) {
      for (const positive of units) for (const sign of [-1, 1]) {
        const n = positive * sign
        const q = emitLayoutUnit(n, e)
        expect(Number(String(q))).toBe(q)
        // Verifica el valor float intermedio exacto, más fuerte que sólo truncar.
        expect(Math.fround(Number(String(q)) * e)).toBe(n === 0 ? 0 : n / 64)
        expect(decodeLayoutUnit(q, e)).toBe(n === 0 ? 0 : n)
      }
    }
  })

  it('no redondea inline/subgrid ni admite unidades fuera del límite probado', () => {
    for (const n of [0.5, -0.5, 2 ** 24 + 1, -(2 ** 24) - 1, NaN, Infinity]) {
      expect(() => emitLayoutUnit(n, 1)).toThrow(RangeError)
    }
    expect(() => emitLayoutUnit(1, 1.4)).toThrow(RangeError)
    expect(() => decodeLayoutUnit(Infinity, 1)).toThrow(RangeError)
    expect(() => decodeLayoutUnit(2 ** 24, 1)).toThrow(RangeError)
  })
})

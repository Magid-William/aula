// Lectura descriptor-safe compartida; cada escena conserva sus propios presupuestos.
import { FIGURE_LIMITS, FigureValidationError } from '@shared/figures'

export const failFigure = (large = false): never => { throw new FigureValidationError(large ? 'too_large' : 'invalid') }
const fail = failFigure
const numberToken = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const arities: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

export interface FigureSceneLimits {
  maxBytes: number
  maxPrimitives: number
  maxPathNumbers?: number
  strictArrays?: boolean
}

export class FigureSceneReader {
  constructor(private readonly limits: FigureSceneLimits) {}
  pathNumbers = 0
  bytes = 0
  primitives = 0
  texts = 0
  pathExtent = new Map<string, number>()
  add(bytes: number): void { this.bytes += bytes; if (this.bytes > this.limits.maxBytes) fail(true) }
  primitive(): void { if (++this.primitives > this.limits.maxPrimitives) fail(true) }
  object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail()
    const names = Reflect.ownKeys(value)
    if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) return fail()
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      const prop = Object.getOwnPropertyDescriptor(value, key)
      if (!prop || !('value' in prop) || !prop.enumerable) return fail()
      out[key] = prop.value
    }
    this.add(2 + keys.reduce((sum, key) => sum + key.length + 4, 0))
    return out
  }
  array<T>(value: unknown, max: number, read: (value: unknown) => T): T[] {
    if (!Array.isArray(value) || (this.limits.strictArrays && Object.getPrototypeOf(value) !== Array.prototype)) return fail()
    if (value.length > max) return fail(true)
    if (Reflect.ownKeys(value).length !== value.length + 1) return fail()
    this.add(value.length + 2)
    const out: T[] = []
    for (let i = 0; i < value.length; i++) {
      const prop = Object.getOwnPropertyDescriptor(value, i)
      if (!prop || !('value' in prop) || !prop.enumerable) return fail()
      out.push(read(prop.value))
    }
    return out
  }
  number(value: unknown, min: number = -FIGURE_LIMITS.maxCoordinate, max: number = FIGURE_LIMITS.maxCoordinate): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail()
    this.add(String(value).length); return value
  }
  enum<T extends string | number>(value: unknown, choices: readonly T[]): T {
    if (!choices.includes(value as T)) return fail()
    this.add(String(value).length + 2); return value as T
  }
  bool(value: unknown): boolean { if (typeof value !== 'boolean') return fail(); this.add(5); return value }
  string(value: unknown, max: number, empty = false): string {
    if (typeof value !== 'string' || (!empty && !value.length)) return fail()
    if (value.length > max) return fail(true)
    let bytes = 2
    for (const c of value) {
      const n = c.codePointAt(0)!
      if ((n < 32 && ![9, 10, 13].includes(n)) || (n >= 0xd800 && n <= 0xdfff) || n === 0xfffe || n === 0xffff) fail()
      bytes += n < 128 ? (/["\\\n\r\t]/.test(c) ? 2 : 1) : n < 2048 ? 2 : n < 65536 ? 3 : 4
    }
    if (bytes - 2 > max) fail(true)
    this.add(bytes); return value
  }
  color(value: unknown, none = false): string {
    const color = this.string(value, 7)
    if (!(none && color === 'none') && !/^#[\da-f]{6}$/i.test(color)) return fail()
    return color
  }
  path(value: unknown, empty = false): string {
    const path = this.string(value, 128_000, empty)
    if (!path && empty) return path
    if (!/^\s*[Mm]/.test(path) || /,\s*,|[MmLlHhVvCcSsQqTtAaZz]\s*,|,\s*(?:[MmLlHhVvCcSsQqTtAaZz]|$)/.test(path)) return fail()
    let at = 0, command = '', values: number[] = [], count = 0, x = 0, y = 0, sx = 0, sy = 0, extent = 0, previous = '', controlX = 0, controlY = 0
    const point = (px: number, py: number): void => { extent = Math.max(extent, Math.abs(px), Math.abs(py)); if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(px) > FIGURE_LIMITS.maxCoordinate || Math.abs(py) > FIGURE_LIMITS.maxCoordinate) fail(true) }
    const apply = (): void => {
      const upper = command.toUpperCase(), relative = upper !== command, dx = relative ? x : 0, dy = relative ? y : 0
      if (upper === 'A') {
        if (values[0] < 0 || values[1] < 0 || ![0, 1].includes(values[3]) || ![0, 1].includes(values[4])) fail()
        const endX = values[5] + dx, endY = values[6] + dy, rx = values[0], ry = values[1]
        if (rx && ry) {
          // SVG amplía los radios si no alcanzan los extremos; contar sólo los radios dados no basta.
          const angle = values[2] * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
          const halfX = (x - endX) / 2, halfY = (y - endY) / 2
          const correction = Math.max(1, Math.hypot((cos * halfX + sin * halfY) / rx, (-sin * halfX + cos * halfY) / ry))
          const radiusX = Math.hypot(rx * cos, ry * sin) * correction, radiusY = Math.hypot(rx * sin, ry * cos) * correction
          point(x + radiusX * 2, y + radiusY * 2); point(x - radiusX * 2, y - radiusY * 2)
        }
        x = endX; y = endY
      } else if (upper === 'H') x = values[0] + dx
      else if (upper === 'V') y = values[0] + dy
      else {
        if (upper === 'S' && ['C', 'S'].includes(previous) || upper === 'T' && ['Q', 'T'].includes(previous)) {
          controlX = 2 * x - controlX; controlY = 2 * y - controlY; point(controlX, controlY)
        } else if (upper === 'T') { controlX = x; controlY = y }
        for (let i = 0; i < values.length; i += 2) point(values[i] + dx, values[i + 1] + dy)
        if (['C', 'S', 'Q'].includes(upper)) { controlX = values[values.length - 4] + dx; controlY = values[values.length - 3] + dy }
        x = values[values.length - 2] + dx; y = values[values.length - 1] + dy
      }
      point(x, y); previous = upper
      if (upper === 'M') { sx = x; sy = y; command = relative ? 'l' : 'L' }
      values = []
    }
    while (at < path.length) {
      if (/[\s,]/.test(path[at])) { at++; continue }
      if (/[MmLlHhVvCcSsQqTtAaZz]/.test(path[at])) {
        if (values.length) fail()
        command = path[at++]
        if (command.toUpperCase() === 'Z') { x = sx; y = sy; command = ''; previous = 'Z' }
        else {
          let next = at
          while (next < path.length && /[\s,]/.test(path[next])) next++
          if (next === path.length || /[a-df-z]/i.test(path[next])) fail()
        }
        continue
      }
      if (!command) return fail()
      numberToken.lastIndex = at
      const match = numberToken.exec(path)
      if (!match) return fail()
      const n = Number(match[0])
      if (!Number.isFinite(n) || Math.abs(n) > FIGURE_LIMITS.maxCoordinate) return fail()
      if (++count > 32_000 || ++this.pathNumbers > (this.limits.maxPathNumbers ?? Infinity)) return fail(true)
      values.push(n); at = numberToken.lastIndex
      if (values.length === arities[command.toUpperCase()]) apply()
    }
    if (values.length) return fail()
    this.pathExtent.set(path, extent)
    return path
  }
}

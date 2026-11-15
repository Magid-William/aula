// Serialización desde un árbol cerrado, no «limpieza» de XML arbitrario. La misma representación sirve para PNG.
import { FIGURE_LIMITS as L, FigureValidationError } from '@shared/figures'

const fail = (large = false): never => { throw new FigureValidationError(large ? 'too_large' : 'invalid') }
const TAGS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan'])
const POSITIONS = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'dx', 'dy', 'stroke-dashoffset', 'letter-spacing', 'word-spacing'])
const LENGTHS = new Set(['r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-miterlimit', 'font-size', 'pathLength'])
const OPACITIES = new Set(['opacity', 'fill-opacity', 'stroke-opacity'])
const ENUMS: Record<string, readonly string[]> = {
  'fill-rule': ['nonzero', 'evenodd'],
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel'],
  'font-family': ['sans-serif', 'serif', 'monospace'],
  'font-style': ['normal', 'italic', 'oblique'],
  'text-anchor': ['start', 'middle', 'end'],
  'dominant-baseline': ['auto', 'alphabetic', 'middle', 'central', 'hanging', 'ideographic', 'mathematical', 'text-before-edge', 'text-after-edge']
}
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const TOKEN = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== null && proto !== Object.prototype) return fail()
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(k => !allowed.includes(k))) fail()
}
function finite(value: unknown, min: number = -L.maxCoordinate, max: number = L.maxCoordinate): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail()
  return value
}
function numeric(value: string | number, min: number = -L.maxCoordinate, max: number = L.maxCoordinate): string {
  const s = String(value).trim().replace(/px$/, '')
  if (!NUMBER.test(s)) return fail()
  return String(finite(Number(s), min, max))
}
function numbers(text: string, maxItems: number, nonnegative = false): number[] {
  if (!text.trim() || text.length > 128_000) return fail(text.length > 128_000)
  const result: number[] = []
  let i = 0
  while (i < text.length) {
    if (/[\s,]/.test(text[i])) { i++; continue }
    TOKEN.lastIndex = i
    const m = TOKEN.exec(text)
    if (!m) return fail()
    result.push(finite(Number(m[0]), nonnegative ? 0 : -L.maxCoordinate))
    if (result.length > maxItems) return fail(true)
    i = TOKEN.lastIndex
  }
  return result.length ? result : fail()
}
function color(text: string): string {
  const s = text.trim()
  if (['none', 'transparent', 'black', 'white'].includes(s) || /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(s)) return s
  const m = /^(rgb|rgba)\(([^()]*)\)$/.exec(s)
  if (!m) return fail()
  const parts = m[2].split(',').map(n => n.trim())
  if (parts.length !== (m[1] === 'rgb' ? 3 : 4) || parts.some(n => !NUMBER.test(n))) return fail()
  const values = parts.map((n, i) => finite(Number(n), 0, i === 3 ? 1 : 255))
  return `${m[1]}(${values.join(',')})`
}
function transform(text: string): string {
  const command = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)\s*/y
  let i = 0, count = 0
  const out: string[] = []
  while (i < text.length) {
    command.lastIndex = i
    const m = command.exec(text)
    if (!m || ++count > 32) return fail()
    const ns = numbers(m[2], 6)
    const valid = m[1] === 'matrix' ? ns.length === 6 : m[1] === 'rotate' ? ns.length === 1 || ns.length === 3 : m[1] === 'translate' || m[1] === 'scale' ? ns.length <= 2 : ns.length === 1
    if (!valid) return fail()
    out.push(`${m[1]}(${ns.join(' ')})`)
    i = command.lastIndex
  }
  return out.length ? out.join(' ') : fail()
}
function pathData(text: string): string {
  if (!/^\s*[Mm]/.test(text) || text.length > 128_000) return fail(text.length > 128_000)
  // Sólo comandos de trazado y números finitos; no referencias, unidades, CSS ni sintaxis XML.
  let i = 0, count = 0
  while (i < text.length) {
    if (/[\s,MmZzLlHhVvCcSsQqTtAa]/.test(text[i])) { i++; continue }
    TOKEN.lastIndex = i
    const m = TOKEN.exec(text)
    if (!m) return fail()
    finite(Number(m[0]))
    if (++count > 32_000) return fail(true)
    i = TOKEN.lastIndex
  }
  return text
}
function attribute(name: string, value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return fail()
  if (String(value).length > 128_000) return fail(true)
  if (POSITIONS.has(name)) return numeric(value)
  if (LENGTHS.has(name)) return numeric(value, 0)
  if (OPACITIES.has(name)) return numeric(value, 0, 1)
  const text = String(value).trim()
  if (name === 'fill' || name === 'stroke') return color(text)
  if (name === 'transform') return transform(text)
  if (name === 'd') return pathData(text)
  if (name === 'points') {
    const ns = numbers(text, 32_000)
    if (ns.length % 2) return fail()
    return ns.join(' ')
  }
  if (name === 'stroke-dasharray') return text === 'none' ? text : numbers(text, 64, true).join(' ')
  if (name === 'font-weight') return ['normal', 'bold'].includes(text) ? text : numeric(value, 1, 1000)
  if (Object.hasOwn(ENUMS, name) && ENUMS[name].includes(text)) return text
  return fail()
}
function escaped(text: string): string {
  // XML 1.0: sin controles prohibidos ni pares UTF-16 rotos.
  for (const char of text) {
    const n = char.codePointAt(0)!
    if ((n < 32 && n !== 9 && n !== 10 && n !== 13) || (n >= 0xd800 && n <= 0xdfff) || n === 0xfffe || n === 0xffff) fail()
  }
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Acepta sólo el AST de figuras, también cuando la llamada llega de un renderer comprometido. */
export function serializeFigureSvg(value: unknown): string {
  const root = object(value)
  keys(root, ['width', 'height', 'viewBox', 'children'])
  const width = finite(root.width, 1, L.maxDimension), height = finite(root.height, 1, L.maxDimension)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width * height > L.maxPixels) return fail(true)
  if (!Array.isArray(root.viewBox) || root.viewBox.length !== 4) return fail()
  const box = Array.from(root.viewBox, n => finite(n))
  if (box[2] <= 0 || box[3] <= 0 || Math.abs(box[0] + box[2]) > L.maxCoordinate || Math.abs(box[1] + box[3]) > L.maxCoordinate) return fail()
  if (!Array.isArray(root.children)) return fail()
  const out: string[] = []
  const encoder = new TextEncoder()
  let bytes = 0, nodes = 0
  const write = (part: string) => { bytes += encoder.encode(part).length; if (bytes > L.maxSvgBytes) fail(true); out.push(part) }
  function node(value: unknown, depth: number, parent: string): void {
    if (++nodes > L.maxNodes || depth > L.maxDepth) return fail(true)
    if (typeof value === 'string') {
      if ((parent !== 'text' && parent !== 'tspan') || value.length > L.maxSvgBytes) return fail()
      write(escaped(value)); return
    }
    const n = object(value)
    keys(n, ['tag', 'attrs', 'children'])
    if (typeof n.tag !== 'string' || !TAGS.has(n.tag)) return fail()
    if (n.tag === 'tspan' && parent !== 'text' && parent !== 'tspan') return fail()
    if ((parent === 'text' || parent === 'tspan') && n.tag !== 'tspan') return fail()
    write(`<${n.tag}`)
    if (n.attrs !== undefined) {
      const attrs = object(n.attrs), names = Object.keys(attrs)
      if (names.length > 40) return fail()
      for (const name of names) write(` ${name}="${escaped(attribute(name, attrs[name]))}"`)
    }
    if (n.children !== undefined && !Array.isArray(n.children)) return fail()
    const children = (n.children ?? []) as unknown[]
    if (children.length && !['g', 'text', 'tspan'].includes(n.tag)) return fail()
    write('>')
    for (const child of children) node(child, depth + 1, n.tag)
    write(`</${n.tag}>`)
  }
  write(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box.join(' ')}" font-family="sans-serif">`)
  for (const child of root.children) node(child, 1, 'svg')
  write('</svg>')
  return out.join('')
}

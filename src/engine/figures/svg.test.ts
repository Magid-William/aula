import { describe, expect, it } from 'vitest'
import { FIGURE_LIMITS as L, type FigureSvg } from '@shared/figures'
import { serializeFigureSvg as svg } from './svg'

const figure = (children: unknown[] = []) => ({ width: 200, height: 100, viewBox: [-10, -5, 200, 100], children })

describe('SVG autónomo de figuras', () => {
  it('conserva proporción, transparencia, trazos aromáticos y texto escapado con fuente genérica', () => {
    const result = svg(figure([
      { tag: 'rect', attrs: { width: 200, height: 100, fill: 'rgba(250,249,247,0)' } },
      { tag: 'g', attrs: { transform: 'translate(-2.5 4)', opacity: 0.5 }, children: [
        { tag: 'path', attrs: { d: 'M0 1 L2 3 Q4 5 6 7 A8 9 0 0 1 10 11 Z', fill: 'none', stroke: '#123456', 'stroke-width': '1.5px', 'stroke-dasharray': '2, 3', 'stroke-dashoffset': -1 } },
        { tag: 'text', attrs: { x: 3, y: 5, 'font-family': 'serif', 'font-weight': 600, 'text-anchor': 'middle' }, children: ['<&"\'🧪', { tag: 'tspan', attrs: { 'font-size': 8, dy: 2 }, children: ['2'] }] }
      ] }
    ]))
    expect(result).toContain('width="200" height="100" viewBox="-10 -5 200 100"')
    expect(result).toContain('fill="rgba(250,249,247,0)"')
    expect(result).toContain('stroke-dasharray="2 3" stroke-dashoffset="-1"')
    expect(result).toContain('font-family="serif"')
    expect(result).toContain('&lt;&amp;&quot;&apos;🧪<tspan')
    expect(result).not.toContain('style=')
  })

  it.each(['script', 'foreignObject', 'image', 'use', 'style', 'a', 'animate', 'svg', 'defs'])('rechaza el elemento activo o no previsto %s', tag => {
    expect(() => svg(figure([{ tag }]))).toThrow()
  })

  it.each([
    ['onload', 'alert(1)'], ['href', 'https://example.invalid/'], ['xmlns', 'http://example.invalid/'],
    ['style', 'fill:red'], ['class', 'external'], ['fill', 'url(https://example.invalid/a.svg)'],
    ['stroke', 'var(--ink)'], ['font-family', 'https://example.invalid/font.woff'],
    ['d', 'M0 0 <script>'], ['d', 'M0 0 L1e400 0'], ['transform', 'translate(1) url(x)'],
    ['opacity', 2], ['stroke-width', -1], ['r', Infinity], ['stroke-dasharray', '1 -1']
  ])('rechaza atributo o valor %s=%s', (name, value) => {
    expect(() => svg(figure([{ tag: 'path', attrs: { [name]: value } }]))).toThrow()
  })

  it('escapa contenido parecido a XML y rechaza caracteres XML inválidos', () => {
    expect(svg(figure([{ tag: 'text', children: ['<!DOCTYPE svg><script>alert(1)</script>'] }]))).not.toContain('<script>')
    for (const text of ['\0', '\ud800', '\uffff']) expect(() => svg(figure([{ tag: 'text', children: [text] }]))).toThrow()
    expect(() => svg(figure(['texto fuera de text']))).toThrow()
    expect(() => svg(figure([{ tag: 'text', children: [{ tag: 'path' }] }]))).toThrow()
  })

  it('valida dimensiones, todos los índices del viewBox y coordenadas', () => {
    for (const patch of [
      { width: 0 }, { height: 4097 }, { width: 10.5 }, { viewBox: Array(4) }, { viewBox: [0, 0, 100, ,] },
      { viewBox: [0, , 100, 100] }, { viewBox: [0, 0, -1, 1] }, { viewBox: [1e6, 0, 10, 10] },
      { viewBox: [0, NaN, 1, 1] }, { onload: 'evil' }
    ]) expect(() => svg({ ...figure(), ...patch })).toThrow()
    expect(() => svg(figure([{ tag: 'circle', attrs: { cx: 1e7 } }]))).toThrow()
  })

  it('acota nodos, profundidad, ciclos y bytes incluso después de escapar', () => {
    expect(() => svg(figure(Array.from({ length: L.maxNodes + 1 }, () => ({ tag: 'g' }))))).toThrow()
    const cyclic = { tag: 'g', children: [] as unknown[] }; cyclic.children.push(cyclic)
    expect(() => svg(figure([cyclic]))).toThrow()
    expect(() => svg(figure([{ tag: 'text', children: ['&'.repeat(L.maxSvgBytes / 4)] }]))).toThrow()
    const typed: FigureSvg = { width: 4096, height: 4096, viewBox: [0, 0, 1, 1], children: [] }
    expect(() => svg(typed)).not.toThrow()
  })
})

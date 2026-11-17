import { describe, expect, it } from 'vitest'
import { splitEquations } from './mathSplit'

describe('una fila de ecuaciones', () => {
  it('se parte por los \\qquad de arriba del todo', () => {
    const tex = '180^\\circ=\\pi\\ \\text{rad}\\qquad 1^\\circ=\\frac{\\pi}{180}\\ \\text{rad}\\qquad 1\\ \\text{rad}=\\frac{180^\\circ}{\\pi}\\approx 57.3^\\circ'
    expect(splitEquations(tex)).toEqual(['180^\\circ=\\pi\\ \\text{rad}', '1^\\circ=\\frac{\\pi}{180}\\ \\text{rad}', '1\\ \\text{rad}=\\frac{180^\\circ}{\\pi}\\approx 57.3^\\circ'])
  })
  it('no parte dentro de llaves, de \\left…\\right ni de un entorno', () => {
    expect(splitEquations('\\text{a \\qquad b}')).toEqual(['\\text{a \\qquad b}'])
    expect(splitEquations('\\left( a \\qquad b \\right)')).toEqual(['\\left( a \\qquad b \\right)'])
    expect(splitEquations('\\begin{cases} x \\qquad y \\end{cases}')).toEqual(['\\begin{cases} x \\qquad y \\end{cases}'])
    expect(splitEquations('\\{ a \\} \\qquad b')).toEqual(['\\{ a \\}', 'b'])
  })
  it('sin separador, o con órdenes que solo empiezan igual, la fórmula tal cual', () => {
    expect(splitEquations('x^2 + y^2 = r^2')).toEqual(['x^2 + y^2 = r^2'])
    expect(splitEquations('a \\leftarrow b \\qquad c')).toEqual(['a \\leftarrow b', 'c'])
    expect(splitEquations('\\qquad x')).toEqual(['\\qquad x'])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FigureRenderBounds } from '@shared/figuresRender'
import { diagramExportBounds } from './diagramBounds'
import { unionDrawingBounds } from './drawingBounds'

const nominal = { width: 2411, height: 72 }
const expected = { x: -9, y: -2, width: 2429, height: 97 }
const scale = 1.685878962536023
// Rectángulos de Chromium nativo: escena de nueve nodos, primer y último label con sombra e1.
const framed = { x: 15.172910690307617, y: 3.371757984161377, width: 4064.654296875, height: 121.38328552246094 }
const framedLabels = [
  { x: 42.14697265625, y: 30.345821380615234, width: 354.03460693359375, height: 67.43516540527344 },
  { x: 3698.818359375, y: 30.345821380615234, width: 354.03466796875, height: 67.43516540527344 }
]
function fixture(): { scene: HTMLElement; naturalLabels: FigureRenderBounds[] } {
  const properties = new Map<string, { value: string; priority: string }>()
  const style = {
    getPropertyValue: (name: string): string => properties.get(name)?.value ?? '',
    getPropertyPriority: (name: string): string => properties.get(name)?.priority ?? '',
    setProperty: (name: string, value: string, priority = ''): void => { properties.set(name, { value, priority }) },
    removeProperty: (name: string): void => { properties.delete(name) }
  }
  const transformed = (): boolean => !['', 'none'].includes(style.getPropertyValue('transform'))
  const naturalLabels = [{ x: 16, y: 16, width: 210, height: 40 }, { x: 2185, y: 16, width: 210, height: 40 }]
  const labels = naturalLabels.map((rect, i) => ({
    dataset: { diagramShadow: 'e1' },
    getBoundingClientRect: () => transformed() ? framedLabels[i] : rect,
    querySelectorAll: () => []
  }))
  const scene = {
    style,
    getBoundingClientRect: () => transformed() ? framed : { x: 0, y: 0, ...nominal },
    querySelectorAll: (selector: string) => selector === '[data-diagram-geometry]' ? [] : labels
  } as unknown as HTMLElement
  vi.stubGlobal('document', { createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({ detach: () => undefined }) })
  vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 })
  return { scene, naturalLabels }
}
afterEach(() => vi.unstubAllGlobals())

describe('encuadre natural Diagram', () => {
  it('evita que la cuantización del viewport escalado amplíe ambas sombras sin cambiar el layout', () => {
    const { scene } = fixture()
    expect(diagramExportBounds(scene, nominal)).toEqual(expected)
    expect(scene.style.getPropertyValue('transform')).toBe('')
    const transform = 'translate(15.172910662824208px, 3.371757925072046px) scale(1.685878962536023)'
    scene.style.setProperty('transform', transform, 'important')
    scene.style.setProperty('transform-origin', '0px 0px', 'important')
    // La inversión de los números nativos cruzaba los dos enteros y disparaba el guard > 1.
    expect(unionDrawingBounds([{ x: 0, y: 0, ...nominal }, ...framedLabels.map((r) => ({
      x: (r.x - framed.x) / scale - 23, y: (r.y - framed.y) / scale - 9,
      width: r.width / scale + 46, height: r.height / scale + 46
    }))])).toEqual({ x: -10, y: -2, width: 2431, height: 98 })
    expect(diagramExportBounds(scene, nominal)).toEqual(expected)
    expect(scene.style.getPropertyValue('transform')).toBe(transform)
    expect(scene.style.getPropertyPriority('transform')).toBe('important')
    expect(scene.style.getPropertyValue('transform-origin')).toBe('0px 0px')
    expect(scene.style.getPropertyPriority('transform-origin')).toBe('important')
  })

  it('vuelve a medir el DOM y conserva un cambio real de layout tras el encuadre', () => {
    const { scene, naturalLabels } = fixture()
    expect(diagramExportBounds(scene, nominal)).toEqual(expected)
    scene.style.setProperty('transform', 'scale(1.685878962536023)')
    naturalLabels[1].width += 4
    expect(diagramExportBounds(scene, nominal)).toEqual({ ...expected, width: expected.width + 4 })
  })

  it('conserva zoom y compensación internos al neutralizar sólo el encuadre exterior', () => {
    const { scene, naturalLabels } = fixture()
    const wrapper = { style: Object.freeze({ zoom: '1.75', transform: 'scale(0.5714285714285714)', transformOrigin: '0 0' }) }
    const read = scene.querySelectorAll.bind(scene)
    scene.querySelectorAll = ((selector: string) => {
      expect(scene.style.getPropertyValue('transform')).toBe('none')
      expect(wrapper.style).toEqual({ zoom: '1.75', transform: 'scale(0.5714285714285714)', transformOrigin: '0 0' })
      return selector === '*' ? [wrapper, ...read(selector)] : read(selector)
    }) as HTMLElement['querySelectorAll']
    scene.style.setProperty('transform', 'scale(2)')
    expect(diagramExportBounds(scene, nominal)).toEqual(expected)
    naturalLabels[1].width += 4
    expect(diagramExportBounds(scene, nominal)).toEqual({ ...expected, width: expected.width + 4 })
    expect(scene.style.getPropertyValue('transform')).toBe('scale(2)')
  })

  it('restaura el transform y su prioridad también si falla la medición', () => {
    const { scene } = fixture()
    scene.style.setProperty('transform', 'scale(2)', 'important')
    scene.getBoundingClientRect = () => { throw new Error('layout unavailable') }
    expect(() => diagramExportBounds(scene, nominal)).toThrow('layout unavailable')
    expect(scene.style.getPropertyValue('transform')).toBe('scale(2)')
    expect(scene.style.getPropertyPriority('transform')).toBe('important')
  })

  it.each([
    ['path', 'miter', { x: -22, y: -22, width: 64, height: 64 }],
    ['path', 'round', { x: -7, y: -7, width: 34, height: 34 }],
    ['ellipse', 'miter', { x: -7, y: -7, width: 34, height: 34 }]
  ] as const)('incluye el alcance del trazo %s/%s sin recortar sus uniones', (localName, strokeLinejoin, bounds) => {
    const { scene } = fixture()
    const shape = { localName, getBBox: () => ({ x: 0, y: 0, width: 20, height: 20 }), getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1 }) }
    scene.querySelectorAll = ((selector: string) => selector === '[data-diagram-label]' ? [] : [shape]) as unknown as HTMLElement['querySelectorAll']
    vi.stubGlobal('getComputedStyle', () => ({ stroke: '#112233', fill: 'none', strokeWidth: '10', strokeLinejoin }))
    vi.stubGlobal('DOMPoint', class {
      constructor(public x: number, public y: number) {}
      matrixTransform(): { x: number; y: number } { return { x: this.x, y: this.y } }
    })
    expect(diagramExportBounds(scene, { width: 20, height: 20 })).toEqual(bounds)
  })
})

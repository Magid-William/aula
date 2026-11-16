import { describe, expect, it, vi } from 'vitest'
import { figureRenderLayout, validateFigureRenderInput as validate } from './render'
import { diagramSceneFixture } from './testing'

describe('protocolo privado discriminado de figuras', () => {
  it.each([1, 1.75, 1.8])('conserva dimensiones CSS propias de cada escena con zoom %s', cssZoom => {
    const diagram = diagramSceneFixture()
    diagram.metrics.cssZoom = cssZoom
    expect(figureRenderLayout(validate({ kind: 'diagram', scene: diagram }))).toEqual({ width: 100, height: 80 })
    const drawing = { version: 1, canvas: { width: 100, height: 80 }, metrics: { pixelWidth: 200, layoutWidth: 125, textK: 1, unitsPerPx: .5, rootFontPx: 16, bodyFont: 'sans', bodyItalic: false, cssZoom }, appearance: { ...diagram.appearance }, items: [], output: { scale: 2 } }
    const { background: _background, ...appearance } = drawing.appearance
    expect(figureRenderLayout(validate({ kind: 'drawing', scene: { ...drawing, appearance } }))).toEqual({ width: 125, height: 100 })
  })
  it('rechaza mezcla de clases, envoltorios abiertos y discriminantes activos antes de montar', () => {
    const scene = diagramSceneFixture(), getter = vi.fn(() => 'diagram')
    const active = { scene }; Object.defineProperty(active, 'kind', { get: getter, enumerable: true })
    for (const input of [{ kind: 'drawing', scene }, { kind: 'unknown', scene }, { kind: 'diagram', scene, url: 'file:///private' }, scene, active]) expect(() => validate(input)).toThrow()
    expect(getter).not.toHaveBeenCalled()
  })
})

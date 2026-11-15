import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIGURE_LIMITS } from '@shared/figures'
import { bounded, checkFigureSize, figureBounds, portableFont, snapshotSvg } from './snapshot'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('instantánea portable', () => {
  it('resuelve las familias por su fallback real, sin confundir sans-serif con serif', () => {
    expect(portableFont('-apple-system, "Inter Variable", sans-serif')).toBe('sans-serif')
    expect(portableFont('"Newsreader Variable", Georgia, serif')).toBe('serif')
    expect(portableFont('Menlo, "monospace"')).toBe('monospace')
    expect(portableFont('Unknown')).toBe('sans-serif')
  })
  it('limita antes de asignar un canvas y coincide con el contrato principal', () => {
    expect(() => checkFigureSize(FIGURE_LIMITS.maxDimension, FIGURE_LIMITS.maxDimension)).not.toThrow()
    for (const pair of [[0, 1], [-1, 1], [1.5, 1], [Infinity, 1], [NaN, 1], [1, FIGURE_LIMITS.maxDimension + 1]]) expect(() => checkFigureSize(...pair as [number, number])).toThrow()
  })
  it('incluye el rodeado que desborda el viewBox y conserva el tamaño natural si todo cabe', () => {
    const natural = { x: 0, y: 0, width: 500, height: 150 }
    expect(figureBounds(natural, { x: 22, y: 22, width: 450, height: 100 }, 3)).toEqual([0, 0, 500, 150])
    expect(figureBounds(natural, { x: -12.2, y: -4, width: 530, height: 160 }, 3)).toEqual([-16, -7, 537, 166])
    expect(() => figureBounds(natural, { x: -9000, y: 0, width: 9500, height: 100 }, 1)).toThrow()
  })
  it('conserva los guiones semánticos y sólo copia geometría, sin datos del tutor ni eventos', () => {
    const attributes: Record<string, string> = { d: 'M0 0 L10 10', 'data-ask-label': 'respuesta secreta', onclick: 'unsafe()', class: 'animated' }
    const path = { localName: 'path', hasAttribute: (key: string) => key in attributes, getAttribute: (key: string) => attributes[key], getCTM: () => null, childNodes: [] }
    vi.stubGlobal('getComputedStyle', () => ({ opacity: '1', fill: 'none', stroke: '#123456', fillOpacity: '1', strokeOpacity: '1', strokeWidth: '2px', strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: '4px, 2px', strokeDashoffset: '2px' }))
    vi.stubGlobal('CSS', { supports: () => true })
    const canvas = { width: 1, height: 1, getContext: () => ({ clearRect: () => undefined, fillRect: () => undefined, getImageData: () => ({ data: [18, 52, 86, 255] }) }) }
    const svg = {
      width: { baseVal: { value: 100 } }, height: { baseVal: { value: 80 } },
      viewBox: { baseVal: { x: 0, y: 0, width: 100, height: 80 } },
      ownerDocument: { createElement: () => canvas }, querySelectorAll: () => [], children: [path],
      getBBox: () => ({ x: 10, y: 10, width: 20, height: 20 })
    } as unknown as SVGSVGElement
    const result = snapshotSvg(svg, '#123456')
    expect(result.children[1].attrs).toMatchObject({ d: 'M0 0 L10 10', stroke: 'rgba(18, 52, 86, 1)', 'stroke-dasharray': '4, 2', 'stroke-dashoffset': 2 })
    expect(JSON.stringify(result)).not.toMatch(/data-ask|onclick|class|secret/)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })
  it('espera fuentes con límite y cancela al desmontar', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const pending = bounded(new Promise(() => undefined), controller.signal)
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await cancelled
    expect(vi.getTimerCount()).toBe(0)
    const timeout = bounded(new Promise(() => undefined), new AbortController().signal, 20)
    const rejected = expect(timeout).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
    await expect(bounded(Promise.resolve(7), new AbortController().signal)).resolves.toBe(7)
    expect(vi.getTimerCount()).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { decodeDrawing } from '@shared/schema/common'
import { drawItemShape } from './shapes'
import { drawingLayout, placeAutoLabels } from './labels'

describe('dibujos ajenos: trabajo acotado', () => {
  it.each([false, true])('acota el contorno de una polilínea larga (smooth=%s), sin cambiar el camino', (smooth) => {
    const points = Array.from({ length: 2000 }, (_, i) => i % 2 ? [100000, 100000] : [-100000, -100000])
    const block = decodeDrawing({ items: [{ kind: 'polyline', points, smooth }] })!
    const shape = drawItemShape(block.items[0])
    expect(shape.outline.length).toBeLessThanOrEqual(4096)
    expect(shape.outline[0]).toEqual(points[0])
    expect(shape.outline.at(-1)).toEqual(points.at(-1))
    expect(shape.paths[0].d.match(smooth ? /C/g : /L/g)).toHaveLength(1999)
  })

  it('el límite conserva un dibujo normal y coloca todas sus etiquetas', () => {
    const block = decodeDrawing({ items: [
      { kind: 'rect', x: 20, y: 20, w: 80, h: 60, label: 'A', anchor: 'auto' },
      { kind: 'line', x1: 150, y1: 20, x2: 150, y2: 100, label: 'B', anchor: 'auto' }
    ] })!
    const shapes = drawingLayout(block.items, 400, 300)
    expect(shapes.map((s) => s.labels[0].text)).toEqual(['A', 'B'])
    expect(shapes[0].outline).toHaveLength(57)
    expect(shapes[1].outline).toHaveLength(17)
  })

  it('acota las muestras que cada etiqueta compara con el conjunto de formas', () => {
    let reads = 0
    const point: [number, number] = [0, 0]
    Object.defineProperty(point, '0', { get: () => { reads++; return 0 } })
    const shapes = Array.from({ length: 32 }, (_, i) => ({
      ...drawItemShape({ kind: 'rect', x: i * 10, y: 0, w: 10, h: 10, ...(i === 0 ? { label: 'A', anchor: 'auto' as const } : {}) }),
      outline: Array.from({ length: 4096 }, () => point)
    }))
    expect(placeAutoLabels(shapes, 400, 300)[0].labels[0].text).toBe('A')
    expect(reads).toBeLessThanOrEqual(8192 * 9)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { DiagramRenderSceneV1 } from '@shared/figuresDiagram'
import { DIAGRAM_LIMITS, diagramGeometryNodes, diagramTexts, validateDiagramRenderScene as validate } from './diagram'
import { diagramLabelFixture, diagramSceneFixture as fixture } from './testing'

describe('DTO cerrado de Diagram completo', () => {
  it.each([.125, 1, 1.75, 1.8, 8])('conserva zoom CSS %s sin reescalar geometría ni texto', cssZoom => {
    const source = fixture(); source.metrics.cssZoom = cssZoom
    const result = validate(source)
    expect(result).toEqual(source)
    expect(result.metrics).not.toBe(source.metrics)
  })
  it.each([0, -.5, .124, 8.001, NaN, Infinity, '1.75', '175%', 'var(--zoom)', undefined])('rechaza zoom CSS fuera del contrato (%s)', cssZoom => {
    const source = fixture(); Object.assign(source.metrics, { cssZoom })
    expect(() => validate(source)).toThrow('Invalid figure export')
  })
  it('rechaza el getter de zoom sin ejecutarlo', () => {
    const source = fixture(), getter = vi.fn(() => 1.75)
    Object.defineProperty(source.metrics, 'cssZoom', { enumerable: true, get: getter })
    expect(() => validate(source)).toThrow('Invalid figure export')
    expect(getter).not.toHaveBeenCalled()
  })
  it('presupuesta todas las familias antes de compensar zoom y mantiene los límites sin zoom', () => {
    const changes: Array<(scene: DiagramRenderSceneV1) => void> = [
      s => { s.canvas.width = 9000 }, s => { s.canvas.height = 9000 },
      s => { s.primitives.find(p => p.kind === 'path')!.d = 'M0 0L20000 0' },
      s => { s.primitives.find(p => p.kind === 'ellipse')!.rx = 9000 },
      s => { s.primitives.find(p => p.kind === 'ellipse')!.cx = -20000 },
      s => { s.primitives.find(p => p.kind === 'ink')!.box.width = 9000 },
      s => { s.primitives.find(p => p.kind === 'ink')!.box.x = -20000 },
      s => { s.primitives.find(p => p.kind === 'ink')!.strokes[0].spine = 'M0 0L20000 0' },
      s => { s.primitives.find(p => p.kind === 'venn-region')!.include[0].r = 9000 },
      s => { s.primitives.find(p => p.kind === 'venn-region')!.exclude[0].cx = 20000 },
      s => { s.primitives.find(p => p.kind === 'label')!.x = -20000 },
      s => { s.primitives.find(p => p.kind === 'label')!.width = 9000 },
      s => { s.primitives.find(p => p.kind === 'label')!.height = 9000 },
      s => { s.primitives.find(p => p.kind === 'label')!.maxWidth = 9000 },
      s => { s.primitives.find(p => p.kind === 'label')!.lines[0].height = 9000 },
      s => { s.primitives.find(p => p.kind === 'label')!.lines[0].size = 200 },
      s => { s.primitives.find(p => p.kind === 'label')!.lines[0].lineHeight = 200 },
      s => { s.primitives.find(p => p.kind === 'label')!.lines[0].marginTop = 200 },
      s => { s.primitives.find(p => p.kind === 'group')!.children.find(p => p.kind === 'path')!.d = 'M0 0L20000 0' }
    ]
    for (const change of changes) {
      const source = fixture(); change(source)
      expect(validate(source)).toEqual(source)
      source.metrics.cssZoom = 2
      expect(() => validate(source)).toThrow('exceeds export limits')
    }
    const root = fixture(); root.metrics.rootFontPx = 64; root.metrics.cssZoom = 8
    expect(() => validate(root)).toThrow('exceeds export limits')
    const small = fixture(); small.metrics.cssZoom = .125; small.primitives.find(p => p.kind === 'path')!.d = 'M0 0L40000 0'
    expect(() => validate(small)).toThrow('exceeds export limits')
  })
  it('distingue las unidades viewBox de Ink de las dimensiones CSS zoomadas', () => {
    const source = fixture(), ink = source.primitives.find(p => p.kind === 'ink')!
    ink.viewWidth = ink.viewHeight = 16000; source.metrics.cssZoom = 2
    expect(validate(source)).toEqual(source)
  })
  it('acota márgenes zoomados y altura agregada de columnas sin height', () => {
    const source = fixture(), label = diagramLabelFixture()
    label.height = null; label.x = label.y = label.paddingX = label.paddingY = label.borderWidth = 0; label.shadow = 'none'
    label.lines = Array.from({ length: 32 }, () => ({ ...label.lines[0], text: 'X', size: 32, lineHeight: 32, marginTop: 256, clamp: 0 }))
    source.primitives = [label]
    expect(validate(source)).toEqual(source)
    source.metrics.cssZoom = 8
    expect(() => validate(source)).toThrow('exceeds export limits')
    source.metrics.cssZoom = 1
    for (const line of label.lines) { line.marginTop = 0; line.height = 1200 }
    expect(() => validate(source)).toThrow('exceeds export limits')
    // Una caja grande de línea ya se cuenta aunque el label tenga una altura pequeña.
    label.height = 40
    expect(() => validate(source)).toThrow('exceeds export limits')
  })
  it('presupuesta el alto explícito del clamp antes de compensar zoom', () => {
    const source = fixture(), label = diagramLabelFixture()
    label.height = null
    label.lines = Array.from({ length: 32 }, () => ({ ...label.lines[0], text: 'X', size: 16, lineHeight: 128, clamp: 6 }))
    source.primitives = [label]
    expect(validate(source)).toEqual(source)
    source.metrics.cssZoom = 2
    expect(() => validate(source)).toThrow('exceeds export limits')
  })
  it('cuenta el wrapper de zoom contra el presupuesto DOM agregado', () => {
    const source = fixture(), path = source.primitives.find(p => p.kind === 'path')!
    source.primitives = Array.from({ length: 4999 }, () => ({ ...path, dash: [...path.dash] }))
    expect(diagramGeometryNodes(source)).toBe(DIAGRAM_LIMITS.maxDomNodes)
    expect(validate(source)).toEqual(source)
    source.metrics.cssZoom = 1.75
    expect(diagramGeometryNodes(source)).toBe(DIAGRAM_LIMITS.maxDomNodes + 1)
    expect(() => validate(source)).toThrow('exceeds export limits')
  })
  it.each(['flow', 'concept', 'tree', 'cycle', 'layers', 'pyramid', 'funnel', 'venn', 'mindmap'] as const)('proyecta %s sin compartir objetos o borrar enlaces de texto', family => {
    const source = fixture(); source.family = family
    const result = validate(source)
    expect(result).toEqual(source); expect(result.primitives[0]).not.toBe(source.primitives[0])
    expect(diagramTexts(result)).toContain('$x<y$ [visible](https://example.invalid)')
    source.primitives.length = 0
    expect(result.primitives).toHaveLength(6)
  })
  it('conserva URLs visibles como texto plano sin otorgarles autoridad de recurso', () => {
    const source = fixture(), label = diagramLabelFixture(); label.lines[0].content = 'plain'; label.lines[0].text = 'https://example.invalid/aula'
    source.primitives = [label]
    expect(validate(source)).toEqual(source)
    expect(diagramTexts(source)).toEqual([])
  })
  it('acepta el lienzo vacío de un paso narrativo de construcción sin relajar su contrato', () => {
    const source = fixture(); source.primitives = []
    const result = validate(source)
    expect(result).toEqual(source)
    expect(result.primitives).not.toBe(source.primitives)
    expect(diagramGeometryNodes(result)).toBe(2)
    expect(diagramTexts(result)).toEqual([])
    source.canvas.width = 0
    expect(() => validate(source)).toThrow()
  })
  it.each(['sans', 'serif', 'mono', 'rounded'] as const)('conserva la tipografía heredada %s y cursiva con un enum cerrado', bodyFont => {
    const source = fixture(); source.metrics = { rootFontPx: 16, bodyFont, bodyItalic: true, cssZoom: 1 }
    expect(validate(source).metrics).toEqual(source.metrics)
    Object.assign(source.metrics, { bodyFont: 'url(file:///font)' })
    expect(() => validate(source)).toThrow()
  })
  it.each(['block', 'column', 'grid', 'bottom'] as const)('valida la disposición %s sin descartar líneas silenciosamente', layout => {
    const source = fixture(), label = diagramLabelFixture(); label.layout = layout; source.primitives = [label]
    expect(validate(source)).toEqual(source)
    label.lines.push({ ...label.lines[0] })
    if (layout === 'column') expect(validate(source)).toEqual(source)
    else expect(() => validate(source)).toThrow()
    Object.assign(label, { layout: 'display:contents' })
    expect(() => validate(source)).toThrow()
  })
  it('rechaza campos extra, accessors, prototipos, símbolos, no enumerables y arrays dispersos', () => {
    const getter = vi.fn(() => 100), active = fixture(); Object.defineProperty(active.canvas, 'width', { get: getter, enumerable: true })
    const hidden = fixture(); Object.assign(hidden.primitives[0], { secret: 'HIDDEN' })
    const prototype = Object.assign(Object.create({}), fixture())
    const symbol = fixture(); Object.assign(symbol, { [Symbol('extra')]: 1 })
    const nonEnumerable = fixture(); Object.defineProperty(nonEnumerable.canvas, 'width', { value: 100, enumerable: false })
    const sparse = fixture(); sparse.primitives = new Array(2)
    const arrayPrototype = fixture(); Object.setPrototypeOf(arrayPrototype.primitives, Object.create(Array.prototype))
    const indexAccessor = fixture(); Object.defineProperty(indexAccessor.primitives, '0', { get: getter, enumerable: true })
    for (const value of [active, hidden, prototype, symbol, nonEnumerable, sparse, arrayPrototype, indexAccessor]) expect(() => validate(value)).toThrow('Invalid figure export')
    expect(getter).not.toHaveBeenCalled()
  })
  it('valida discriminantes sin invocar getters, y no admite grupos anidados ni ciclos', () => {
    const getter = vi.fn(() => 'label'), active = fixture(); Object.defineProperty(active.primitives[0], 'kind', { get: getter, enumerable: true })
    const nested = fixture(); nested.primitives = [{ kind: 'group', opacity: 1, children: [{ kind: 'group', opacity: 1, children: [] }] }] as unknown as DiagramRenderSceneV1['primitives']
    const cycle = fixture(), group: { kind: string; opacity: number; children: unknown[] } = { kind: 'group', opacity: 1, children: [] }; group.children.push(group); cycle.primitives = [group] as DiagramRenderSceneV1['primitives']
    for (const value of [active, nested, cycle]) expect(() => validate(value)).toThrow('Invalid figure export')
    expect(getter).not.toHaveBeenCalled()
  })
  it('sólo admite colores hex concretos y papel opaco; no CSS, enlaces ni recursos', () => {
    for (const color of ['url(file:///private)', 'var(--text)', 'red', '#12345', '#fffffffff', 'rgba(1,2,3,0.5)']) {
      const value = fixture(); value.appearance.background.color = color; expect(() => validate(value)).toThrow()
    }
    const paper = fixture(); paper.appearance.palette.paper = '#ffffff80'; expect(() => validate(paper)).toThrow()
  })
  it.each(['miter', 'round'] as const)('conserva la unión %s del trazo sin convertirla', strokeLinejoin => {
    const source = fixture(); Object.assign(source.primitives[0], { strokeLinejoin })
    expect(validate(source).primitives[0]).toEqual(source.primitives[0])
  })
  it.each(['bevel', 'miter-clip', 'arcs', 'inherit', 'var(--join)', 'url(file:///join)', '', undefined, null, 4])('rechaza una unión fuera del contrato (%s)', strokeLinejoin => {
    const source = fixture(); Object.assign(source.primitives[0], { strokeLinejoin })
    expect(() => validate(source)).toThrow('Invalid figure export')
  })
  it('rechaza el accessor de una unión sin invocarlo', () => {
    const source = fixture(), getter = vi.fn(() => 'round')
    Object.defineProperty(source.primitives[0], 'strokeLinejoin', { get: getter, enumerable: true })
    expect(() => validate(source)).toThrow('Invalid figure export')
    expect(getter).not.toHaveBeenCalled()
  })
  it.each(['M0 0 L', 'M0,,0L10 10', 'M,0 0', 'M0 0,', 'M0 0L1', 'M0 0A1 2 0 8 0 3 4', 'M0 0L1e999 1', 'M0 0<script>', 'M0 0l900000 0 900000 0', 'M0 0A0.000001 100 0 0 1 10 0'])('rechaza path malformado o expansivo %s', d => {
    const value = fixture(); Object.assign(value.primitives[0], { d }); expect(() => validate(value)).toThrow()
  })
  it('acota coordenadas, tamaños, opacidad, elipses, SVG de tinta y layout antes de montar', () => {
    const changes: Array<(scene: DiagramRenderSceneV1) => void> = [
      scene => { scene.canvas.width = 16_385 }, scene => { scene.metrics.rootFontPx = Infinity },
      scene => { Object.assign(scene.primitives[0], { opacity: NaN }) }, scene => { Object.assign(scene.primitives[0], { d: 'M0 0L40000 0' }) },
      scene => { Object.assign(scene.primitives[1], { cx: 32000, rx: 1000 }) }, scene => { Object.assign(scene.primitives[2], { viewWidth: .01 }) },
      scene => { Object.assign(scene.primitives[3], { x: 32768 }) }, scene => { Object.assign(scene.primitives[4], { include: [] }) }
    ]
    for (const change of changes) { const value = fixture(); change(value); expect(() => validate(value)).toThrow() }
  })
  it('permite tinta sin dry, pero rechaza pares dry/dryWidth incompletos o activos', () => {
    const value = fixture(), ink = value.primitives[2]; if (ink.kind !== 'ink') throw new Error('fixture')
    delete ink.strokes[0].dry; delete ink.strokes[0].dryWidth
    expect(validate(value)).toEqual(value)
    ink.strokes[0].dryWidth = 1; expect(() => validate(value)).toThrow()
  })
  it('cuenta geometría acumulada, no sólo cada path aislado', () => {
    const value = fixture(), path = value.primitives[0]; if (path.kind !== 'path') throw new Error('fixture')
    value.primitives = Array.from({ length: 5 }, () => ({ ...path, d: `M0 0 ${'L0 0 '.repeat(15_999)}` }))
    expect(() => validate(value)).toThrow('exceeds export limits')
  })
  it('acota texto agregado y DOM derivado, incluyendo tinta, Venn y grupos', () => {
    const text = fixture(), label = diagramLabelFixture(); label.lines[0].text = 'x'.repeat(DIAGRAM_LIMITS.maxLabelBytes)
    text.primitives = Array.from({ length: 9 }, () => structuredClone(label)); expect(() => validate(text)).toThrow('exceeds export limits')
    label.lines[0].text += 'x'; text.primitives = [label]; expect(() => validate(text)).toThrow('exceeds export limits')
    const dom = fixture(), dense = diagramLabelFixture(); dense.lines = Array.from({ length: 32 }, () => ({ ...dense.lines[0], text: 'x' }))
    dom.primitives = Array.from({ length: 80 }, () => structuredClone(dense))
    expect(diagramGeometryNodes(dom)).toBeGreaterThan(DIAGRAM_LIMITS.maxDomNodes)
    expect(() => validate(dom)).toThrow('exceeds export limits')
    const clean = fixture(); expect(diagramGeometryNodes(clean)).toBeGreaterThan(30)
  })
})

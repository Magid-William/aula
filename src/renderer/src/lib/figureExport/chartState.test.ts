import { afterEach, describe, expect, it, vi } from 'vitest'
import { freezeChartExportState } from './chartState'
vi.mock('./drawingFonts', () => ({ assertDrawingFontsReady: vi.fn() }))
vi.mock('./chartTypography', () => ({ chartTypography: () => ({ bodyFont: 'sans', bodyItalic: false, cssZoom: 1 }) }))

afterEach(() => vi.unstubAllGlobals())

function emptyLegendFixture(effectiveZoom = 1) {
  const css = { width: '300px', height: '160px', transform: 'none', transformOrigin: '0px 0px', writingMode: 'horizontal-tb', perspective: 'none', transformStyle: 'flat', rotate: 'none', scale: 'none', translate: 'none', position: 'static', columnCount: 'auto', fontSize: '16px', fontWeight: '400', fontStyle: 'normal', color: '#ffffff', backgroundColor: '#123456', borderTopWidth: '0px', borderTopColor: '#123456', borderTopLeftRadius: '3px', paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', borderLeftWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', whiteSpace: 'normal', overflowX: 'visible', textOverflow: 'clip', textAlign: 'start', lineHeight: '16px', letterSpacing: 'normal', fontVariantNumeric: 'normal', direction: 'ltr', display: 'block', visibility: 'visible', columnGap: '6px', anchorName: 'none', positionAnchor: 'normal', positionArea: 'none' }
  class Unit { constructor(public value: number, public unit: string) {} }
  class Keyword { constructor(public value: string) {} }
  class Transform extends Array<unknown> {}
  class Scale { is2D = true; z = 1; constructor(public x: number, public y: number) {} }
  class Translate { is2D = true; z = new Unit(0, 'px'); constructor(public x: Unit, public y: Unit) {} }
  class Matrix { constructor(public matrix: { isIdentity: boolean }) {} }
  vi.stubGlobal('CSSUnitValue', Unit); vi.stubGlobal('CSSKeywordValue', Keyword); vi.stubGlobal('CSSTransformValue', Transform)
  vi.stubGlobal('CSSScale', Scale); vi.stubGlobal('CSSTranslate', Translate); vi.stubGlobal('CSSMatrixComponent', Matrix)
  vi.stubGlobal('HTMLElement', class { static [Symbol.hasInstance](value: { namespaceURI?: string }): boolean { return value.namespaceURI === 'http://www.w3.org/1999/xhtml' } })
  const typedTransforms: Record<string, unknown> = {
    'matrix(1, 0, 0, 1, 0, 0)': new Matrix({ isIdentity: true }),
    'matrix(1, 0, 0, 1, 4.5, 0)': new Translate(new Unit(4.5, 'px'), new Unit(0, 'px')),
    'matrix(1, 0, 0, 1, 0, 2)': new Translate(new Unit(0, 'px'), new Unit(2, 'px')),
    'matrix(2, 0, 0, 2, 0, 0)': new Scale(2, 2),
    'scale(1.25)': new Scale(1.25, 1.25)
  }
  const styles = new Map<object, Partial<typeof css>>()
  const computed = (element: object) => {
    const value = { ...css, ...styles.get(element) }
    return { ...value, getPropertyValue: (name: string) => /^border-(left|right|top|bottom)-style$/.test(name) ? 'solid' : value[name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof typeof css] ?? '' }
  }
  const typed = (element: object) => ({ get: (name: string) => {
    const style = computed(element)
    if (name === 'transform') return new Transform(typedTransforms[style.transform] ?? new Matrix({ isIdentity: false }))
    const key = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof typeof css
    const value = style[key]
    return value?.endsWith('px') ? new Unit(Math.fround(Math.fround(parseFloat(value) * effectiveZoom) / effectiveZoom), 'px') : new Keyword(value)
  } })
  const documentElement = { lang: 'en', computedStyleMap: () => typed(documentElement) }
  const document = {
    documentElement, defaultView: { devicePixelRatio: 1 },
    createElement: (tag: string) => tag === 'canvas' ? { width: 0, height: 0, getContext: () => ({ clearRect() {}, fillRect() {}, getImageData: () => ({ data: [255, 255, 255, 255] }), fillStyle: '' }) } : { style: { display: '', color: '' }, remove() {} },
    createRange: vi.fn<() => Pick<Range, 'selectNodeContents' | 'getClientRects' | 'detach'>>(() => { throw new Error('An absent text node must not be measured') })
  }
  const root = {
    isConnected: true, ownerDocument: document, parentElement: null, closest: () => ({ getAttribute: () => 'en' }),
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 300, height: 160 }), appendChild() {}, querySelectorAll: () => [legend, swatch, emptyTipLabel]
  }
  const legend = { children: [] as unknown[], childNodes: [] as unknown[], parentElement: root, hasAttribute: (name: string): boolean => name === 'data-chart-legend' }
  const swatch = { parentElement: legend, dataset: {}, hasAttribute: (name: string) => name === 'data-chart-panel', getBoundingClientRect: () => ({ x: 2, y: 4, width: 10, height: 10 }) }
  legend.children.push(swatch)
  Object.assign(legend, { firstElementChild: swatch })
  const emptyTipLabel = { children: [], textContent: '', parentElement: root, ownerDocument: document, hasAttribute: (name: string) => name === 'data-chart-text', getBoundingClientRect: () => ({ x: 20, y: 30, width: 0, height: 16 }) }
  const boxes = [[root, 0, 0, 300, 160], [legend, 0, 0, 40, 16], [swatch, 2, 4, 10, 10], [emptyTipLabel, 20, 30, 0, 16]] as const
  Object.assign(legend, { getBoundingClientRect: () => ({ x: 0, y: 0, width: 40, height: 16 }) })
  const used = (n: number): number => Math.trunc(Math.fround(n * effectiveZoom) * 64) / 64
  for (const [element, x, y, width, height] of boxes) Object.assign(element, {
    namespaceURI: 'http://www.w3.org/1999/xhtml', currentCSSZoom: effectiveZoom, offsetLeft: Math.round(used(x) / effectiveZoom), offsetTop: Math.round(used(y) / effectiveZoom), offsetWidth: Math.round(used(width) / effectiveZoom), offsetHeight: Math.round(used(height) / effectiveZoom),
    offsetParent: element === root ? null : root, scrollLeft: 0, scrollTop: 0,
    getClientRects: () => [{ x: used(x), y: used(y), width: used(width), height: used(height) }],
    getBoundingClientRect: () => ({ x: used(x), y: used(y), width: used(width), height: used(height) }), computedStyleMap: () => typed(element)
  })
  Object.assign(root, { contains: (element: object) => boxes.some(([known]) => known === element) })
  vi.stubGlobal('getComputedStyle', computed)
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('Node', { TEXT_NODE: 3 })
  return { root: root as unknown as HTMLElement, document, styles, legend, swatch, emptyTipLabel }
}

describe('hojas HTML comprometidas de Chart', () => {
  it('acepta el position-anchor normal observado en Chromium152 cuando position-area es none', () => {
    const { root, styles } = emptyLegendFixture()
    // Diagnóstico academic: los 38 nodos tenían anchor-name:none y position-anchor:normal.
    const scene = freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)
    styles.set(root, { positionAnchor: 'none' })
    expect(freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)).toEqual(scene)
  })

  it('rechaza anclas implícitas, nombres y position-area que convierte normal en auto', () => {
    for (const anchor of [{ positionAnchor: 'auto' }, { positionAnchor: '--tip' }, { positionAnchor: '' }, { anchorName: '--tip' }, { positionArea: 'top' }]) {
      const { root, styles } = emptyLegendFixture()
      styles.set(root, anchor)
      expect(() => freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)).toThrow('Chart geometry is unavailable')
    }
  })
  it('compone una leyenda multilínea sin cuantizar la anchura Range ni la mitad de su altura', () => {
    const e = Math.fround(Math.fround(5 / 6) * 1.75)
    const { root, styles, legend, document } = emptyLegendFixture(e)
    const n = (value: number): number => Math.trunc(Math.fround(value * e) * 64)
    const lineUnit = Math.round(Math.fround(16 * e) * 64)
    const rangeWidth = Math.fround(30.123456789 * e)
    legend.childNodes.push({ nodeType: 3, textContent: 'Alpha Beta' })
    Object.assign(legend, { offsetHeight: 40, getBoundingClientRect: () => ({ x: 0, y: 0, width: n(40) / 64, height: n(40) / 64 }) })
    document.createRange.mockReturnValue({ selectNodeContents() {}, detach() {}, getClientRects: () => [
      { x: 18 * e, y: 2 * e, width: rangeWidth }, { x: 18 * e, y: 18 * e, width: 10 * e }
    ] as unknown as DOMRectList })
    const first = freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)
    expect(first.layers[0]).toMatchObject({ kind: 'html-text', text: 'Alpha Beta', box: {
      x: ((n(2) + n(10) + n(6)) / 64) / e,
      y: ((n(40) - 2 * lineUnit) / 2) / 64 / e,
      width: rangeWidth / e, height: 2 * (lineUnit / 64 / e)
    } })
    styles.set(legend, { direction: 'rtl' })
    expect(freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null).layers[0]).toMatchObject({ kind: 'html-text', direction: 'rtl', box: { x: 0 } })
  })
  it('compone padding usado y borde físico antes de emitir la caja bajo zoom no diádico', () => {
    for (const e of [1, 1.75, Math.fround(Math.fround(1.2) * 1.75), Math.fround(Math.fround(5 / 6) * 1.75), 3.5]) {
      const { root, styles, swatch, emptyTipLabel } = emptyLegendFixture(e)
      const n = (value: number): number => Math.trunc(Math.fround(value * e) * 64)
      styles.set(emptyTipLabel, { paddingLeft: '12px', borderLeftWidth: `${1 / e}px` })
      styles.set(swatch, { borderTopWidth: `${1 / e}px` })
      Object.assign(emptyTipLabel, { offsetWidth: 40, getBoundingClientRect: () => ({ x: n(20) / 64, y: n(30) / 64, width: n(40) / 64, height: n(16) / 64 }) })
      const scene = freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)
      expect(scene.metrics.rawEffectiveZoom).toBe(e)
      expect(scene.layers[0]).toMatchObject({ kind: 'panel', borderWidth: 1 / e })
      expect(scene.layers[1]).toMatchObject({ kind: 'html-text', box: {
        x: ((n(20) + n(12) + 64) / 64) / e, width: ((n(40) - n(12) - 64) / 64) / e
      } })
    }
  })
  it('conserva la muestra de una leyenda sin nombre y una lectura con label vacío', () => {
    const { root, document } = emptyLegendFixture()
    const scene = freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)
    expect(scene.layers).toMatchObject([
      { kind: 'panel', box: { x: 2, y: 4, width: 10, height: 10 } },
      { kind: 'html-text', text: '', box: { x: 20, y: 30, width: 0, height: 16 } }
    ])
    expect(document.createRange).not.toHaveBeenCalled()
  })

  it('rechaza matrices identidad cuya ruta de precisión no es scale/translate', () => {
    const { root, styles, legend, swatch, emptyTipLabel } = emptyLegendFixture()
    for (const element of [legend, swatch, emptyTipLabel]) styles.set(element, { transform: 'matrix(1, 0, 0, 1, 0, 0)' })
    Object.assign(swatch, { offsetParent: legend })
    expect(() => freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)).toThrow('Chart geometry is unavailable')
  })

  it('asienta la traslación Pie marcada en coordenadas lógicas, incluso con el cuerpo escalado', () => {
    const { root, styles, legend, swatch, emptyTipLabel } = emptyLegendFixture()
    const before = legend.hasAttribute
    legend.hasAttribute = name => name === 'data-chart-enter-x' || before(name)
    styles.set(legend, { transform: 'matrix(1, 0, 0, 1, 4.5, 0)' })
    styles.set(root, { transform: 'scale(1.25)' })
    Object.assign(swatch, { offsetParent: legend })
    root.getBoundingClientRect = () => ({ x: 20, y: 30, width: 375, height: 200 }) as DOMRect
    swatch.getBoundingClientRect = () => ({ x: 20 + (2 + 4.5) * 1.25, y: 30 + 4 * 1.25, width: 10 * 1.25, height: 10 * 1.25 })
    emptyTipLabel.getBoundingClientRect = () => ({ x: 20 + 20 * 1.25, y: 30 + 30 * 1.25, width: 0, height: 16 * 1.25 })
    expect(freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null).layers).toMatchObject([
      { kind: 'panel', box: { x: 2, y: 4, width: 10, height: 10 } },
      { kind: 'html-text', box: { x: 20, y: 30, width: 0, height: 16 } }
    ])
    expect(styles.get(legend)?.transform).toBe('matrix(1, 0, 0, 1, 4.5, 0)')
  })

  it.each([
    ['hoja', 'matrix(1, 0, 0, 1, 4.5, 0)'],
    ['ancestro', 'matrix(1, 0, 0, 1, 4.5, 0)'],
    ['ancestro', 'matrix(2, 0, 0, 2, 0, 0)'],
    ['hoja', 'matrix(0, 1, -1, 0, 0, 0)'],
    ['ancestro', 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.01, 0, 0, 0, 1)']
  ])('rechaza transformación no modelada en %s: %s', (where, transform) => {
    const { root, styles, legend, swatch } = emptyLegendFixture()
    styles.set(where === 'hoja' ? swatch : legend, { transform })
    expect(() => freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)).toThrow('Chart geometry is unavailable')
  })

  it.each(['matrix(1, 0, 0, 1, 0, 2)', 'matrix(2, 0, 0, 2, 0, 0)', 'matrix(0, 1, -1, 0, 0, 0)'])('la marca Pie no autoriza otra transformación: %s', transform => {
    const { root, styles, legend } = emptyLegendFixture()
    const before = legend.hasAttribute
    legend.hasAttribute = name => name === 'data-chart-enter-x' || before(name)
    styles.set(legend, { transform })
    expect(() => freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)).toThrow('Chart geometry is unavailable')
  })
})

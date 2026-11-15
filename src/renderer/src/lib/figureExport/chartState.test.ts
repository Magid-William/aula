import { afterEach, describe, expect, it, vi } from 'vitest'
import { freezeChartExportState } from './chartState'
vi.mock('./drawingFonts', () => ({ assertDrawingFontsReady: vi.fn() }))
vi.mock('./chartTypography', () => ({ chartTypography: () => ({ bodyFont: 'sans', bodyItalic: false, cssZoom: 1 }) }))

afterEach(() => vi.unstubAllGlobals())

function emptyLegendFixture() {
  const css = { width: '300px', height: '160px', transform: 'none', fontSize: '16px', fontWeight: '400', fontStyle: 'normal', color: '#ffffff', backgroundColor: '#123456', borderTopWidth: '0px', borderTopColor: '#123456', borderTopLeftRadius: '3px', paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', borderLeftWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', whiteSpace: 'normal', overflowX: 'visible', textOverflow: 'clip', textAlign: 'start', lineHeight: '16px', letterSpacing: 'normal', fontVariantNumeric: 'normal', direction: 'ltr', display: 'block', visibility: 'visible', columnGap: '6px' }
  const document = {
    documentElement: { lang: 'en' },
    createElement: (tag: string) => tag === 'canvas' ? { width: 0, height: 0, getContext: () => ({ clearRect() {}, fillRect() {}, getImageData: () => ({ data: [255, 255, 255, 255] }), fillStyle: '' }) } : { style: { display: '', color: '' }, remove() {} },
    createRange: vi.fn(() => { throw new Error('An absent text node must not be measured') })
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
  const styles = new Map<object, Partial<typeof css>>()
  vi.stubGlobal('getComputedStyle', (element: object) => ({ ...css, ...styles.get(element) }))
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('Node', { TEXT_NODE: 3 })
  return { root: root as unknown as HTMLElement, document, styles, legend, swatch, emptyTipLabel }
}

// La plataforma aporta matrices ya resueltas; estos fixtures no reimplementan su parser ni la política del capturador.
function matrixFixtures() {
  const matrices: Record<string, { is2D: boolean; a: number; b: number; c: number; d: number; m41: number; m42: number }> = {
    'matrix(1, 0, 0, 1, 0, 0)': { is2D: true, a: 1, b: 0, c: 0, d: 1, m41: 0, m42: 0 },
    'matrix(1, 0, 0, 1, 4.5, 0)': { is2D: true, a: 1, b: 0, c: 0, d: 1, m41: 4.5, m42: 0 },
    'matrix(1, 0, 0, 1, 0, 2)': { is2D: true, a: 1, b: 0, c: 0, d: 1, m41: 0, m42: 2 },
    'matrix(2, 0, 0, 2, 0, 0)': { is2D: true, a: 2, b: 0, c: 0, d: 2, m41: 0, m42: 0 },
    'matrix(0, 1, -1, 0, 0, 0)': { is2D: true, a: 0, b: 1, c: -1, d: 0, m41: 0, m42: 0 },
    'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.01, 0, 0, 0, 1)': { is2D: false, a: 1, b: 0, c: 0, d: 1, m41: 0, m42: 0 }
  }
  vi.stubGlobal('DOMMatrixReadOnly', class {
    constructor(value: string) {
      const matrix = matrices[value]
      if (!matrix) throw new Error(`Unexpected matrix fixture: ${value}`)
      return Object.freeze({ ...matrix })
    }
  })
}

describe('hojas HTML comprometidas de Chart', () => {
  it('conserva la muestra de una leyenda sin nombre y una lectura con label vacío', () => {
    const { root, document } = emptyLegendFixture()
    const scene = freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)
    expect(scene.layers).toMatchObject([
      { kind: 'panel', box: { x: 2, y: 4, width: 10, height: 10 } },
      { kind: 'html-text', text: '', box: { x: 20, y: 30, width: 0, height: 16 } }
    ])
    expect(document.createRange).not.toHaveBeenCalled()
  })

  it('acepta identidad explícita en hojas y ancestros internos sin cambiar sus cajas', () => {
    const { root, styles, legend, swatch, emptyTipLabel } = emptyLegendFixture()
    matrixFixtures()
    for (const element of [legend, swatch, emptyTipLabel]) styles.set(element, { transform: 'matrix(1, 0, 0, 1, 0, 0)' })
    expect(freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null).layers).toMatchObject([
      { kind: 'panel', box: { x: 2, y: 4, width: 10, height: 10 } },
      { kind: 'html-text', text: '', box: { x: 20, y: 30, width: 0, height: 16 } }
    ])
  })

  it('asienta la traslación Pie marcada en coordenadas lógicas, incluso con el cuerpo escalado', () => {
    const { root, styles, legend, swatch, emptyTipLabel } = emptyLegendFixture()
    matrixFixtures()
    const before = legend.hasAttribute
    legend.hasAttribute = name => name === 'data-chart-enter-x' || before(name)
    styles.set(legend, { transform: 'matrix(1, 0, 0, 1, 4.5, 0)' })
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
    matrixFixtures()
    styles.set(where === 'hoja' ? swatch : legend, { transform })
    expect(() => freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)).toThrow('Chart presentation is unavailable')
  })

  it.each(['matrix(1, 0, 0, 1, 0, 2)', 'matrix(2, 0, 0, 2, 0, 0)', 'matrix(0, 1, -1, 0, 0, 0)'])('la marca Pie no autoriza otra transformación: %s', transform => {
    const { root, styles, legend } = emptyLegendFixture()
    matrixFixtures()
    const before = legend.hasAttribute
    legend.hasAttribute = name => name === 'data-chart-enter-x' || before(name)
    styles.set(legend, { transform })
    expect(() => freezeChartExportState({ chartKind: 'line', empty: true, dark: false }, root, null)).toThrow('Chart presentation is unavailable')
  })
})

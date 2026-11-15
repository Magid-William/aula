import { afterEach, describe, expect, it, vi } from 'vitest'
import { DIAGRAM_FONTS, diagramTypography } from './diagramTypography'
import { figureTypography } from './figureTypography'

const computed = { sans: 'system-ui, "Inter Variable", sans-serif', serif: 'ui-serif, "Newsreader Variable", serif', mono: 'ui-monospace, "JetBrains Mono", monospace', rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif' }
function fixture(fontFamily: string, fontStyle = 'normal') {
  const probe = { style: { display: '', fontFamily: '' }, remove: vi.fn() }
  const element = { ownerDocument: { createElement: () => probe }, appendChild: vi.fn() } as unknown as HTMLElement
  vi.stubGlobal('getComputedStyle', (target: unknown) => {
    if (target === element) return { fontFamily, fontStyle, zoom: '1' }
    const key = (Object.keys(DIAGRAM_FONTS) as Array<keyof typeof DIAGRAM_FONTS>).find((key) => DIAGRAM_FONTS[key] === probe.style.fontFamily)
    return { fontFamily: key ? computed[key] : '', zoom: '1' }
  })
  return { element, probe }
}
afterEach(() => { vi.unstubAllGlobals() })

describe('tipografía comprometida y cerrada de Diagram', () => {
  it('comparte el capturador cerrado de fuentes y zoom con Drawing', () => {
    expect(diagramTypography).toBe(figureTypography)
    const { element } = fixture(computed.serif)
    const original = getComputedStyle, parent = {} as HTMLElement
    Object.assign(element, { parentElement: parent })
    vi.stubGlobal('getComputedStyle', (target: Element) => target === parent ? { zoom: '1.25' } : target === element ? { ...original(target), zoom: '1.75' } : original(target))
    expect(diagramTypography(element)).toEqual({ bodyFont: 'serif', bodyItalic: false, cssZoom: 2.1875 })
  })
  it.each(['sans', 'serif', 'mono', 'rounded'] as const)('reconoce %s heredada sin transportar CSS', (family) => {
    const { element, probe } = fixture(computed[family], 'italic')
    expect(diagramTypography(element)).toEqual({ bodyFont: family, bodyItalic: true, cssZoom: 1 })
    expect(probe.remove).toHaveBeenCalledOnce()
  })
  it('normaliza comillas y separadores del stack sin cambiar familias', () => {
    const { element } = fixture("ui-serif , 'Newsreader Variable' , serif")
    expect(diagramTypography(element)).toEqual({ bodyFont: 'serif', bodyItalic: false, cssZoom: 1 })
  })
  it.each([['Private Font, serif', 'normal'], [computed.sans, 'oblique 20deg']])('falla con fuente o estilo no representable y limpia el probe', (font, style) => {
    const { element, probe } = fixture(font, style)
    expect(() => diagramTypography(element)).toThrow(/Unsupported figure font/)
    expect(probe.remove).toHaveBeenCalledOnce()
  })
})

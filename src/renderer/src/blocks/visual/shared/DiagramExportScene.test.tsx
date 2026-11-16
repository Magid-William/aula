import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DiagramLabel, DiagramRenderSceneV1 } from '@shared/figuresDiagram'
import { diagramGeometryNodes, diagramTexts, validateDiagramRenderScene } from '@engine/figures/diagram'
import { preflightDrawingTexts } from '@renderer/lib/figureExport/StaticDrawingText'
import { DiagramExportScene, diagramBackgroundStyle } from './DiagramExportScene'

const label: DiagramLabel = {
  kind: 'label', x: 20, y: 30, width: 160, height: 95, maxWidth: null, anchor: 'top-left', layout: 'column', align: 'center', vertical: 'center', paddingX: 14, paddingY: 8,
  wrap: 'normal', truncate: false, shape: 'note', background: '#fffdf9', tint: '#b4502f24', border: '#847f7a', borderWidth: .75, shadow: 'e2', opacity: 1,
  lines: [{ text: '**Rótulo** $\\frac{a_1}{\\sqrt{b}}$ y $\\ce{H2O}$', content: 'rich', color: '#201e1a', font: 'inherit', size: 14, lineHeight: 19, weight: 600, tabular: false, clamp: 6, breakWords: true, fullWidth: false, height: null, marginTop: 0 },
    { text: '[Web](https://example.com) https://example.org', content: 'rich', color: '#585550', font: 'inherit', size: 12, lineHeight: 16, weight: 400, tabular: false, clamp: 3, breakWords: false, fullWidth: false, height: null, marginTop: 4 }]
}
const scene: DiagramRenderSceneV1 = {
  version: 1, family: 'venn', canvas: { width: 400, height: 300 }, metrics: { rootFontPx: 16, bodyFont: 'sans', bodyItalic: false, cssZoom: 1 },
  appearance: { theme: 'dark', language: 'ar', direction: 'rtl', palette: { paper: '#13110e', text: '#ece5db', text2: '#bbb3a7', text3: '#9a9388', link: '#dc926d', accent: '#b4502f', brick: '#b4502f' }, background: { kind: 'dots', color: '#ffffff1a', spacing: 18, radius: 1, fadeRadius: 1.2 } },
  primitives: [
    { kind: 'group', opacity: .24, children: [{ kind: 'path', d: 'M0 0L200 0L200 140Z', fill: '#fffdf9', stroke: 'none', strokeWidth: 0, strokeLinejoin: 'round', opacity: 1, dash: [], dashOffset: 0 }, label] },
    { kind: 'path', d: 'M0 0L200 200', fill: 'none', stroke: '#eeeeee', strokeWidth: 1.2, strokeLinejoin: 'miter', opacity: .85, dash: [2, 12], dashOffset: -19.5 },
    { kind: 'venn-region', include: [{ cx: 170, cy: 140, r: 85 }, { cx: 220, cy: 140, r: 85 }], exclude: [{ cx: 195, cy: 205, r: 85 }], fill: '#ffffff17' },
    { kind: 'ink', box: { x: -10, y: -15, width: 50, height: 40 }, viewWidth: 50, viewHeight: 40, color: '#b4502f', opacity: 1, strokes: [{ d: 'M0 0L50 0L50 40Z', spine: 'M0 0L50 0', reach: 6, dry: 'M5 0L8 0', dryWidth: .3 }] }
  ], output: { scale: 2 }
}

describe('escena estática Diagram', () => {
  it('compensa zoom dentro del root sin cambiar el árbol normal ni la pintura', () => {
    const normal = renderToStaticMarkup(<DiagramExportScene scene={scene} />)
    expect(normal).not.toContain('data-figure-css-zoom')
    const zoomed = { ...scene, metrics: { ...scene.metrics, cssZoom: 1.75 } }
    const html = renderToStaticMarkup(<DiagramExportScene scene={validateDiagramRenderScene(zoomed)} />)
    const opening = '<div data-figure-css-zoom="true" style="position:absolute;left:0;top:0;width:400px;height:300px;zoom:1.75;transform-origin:0 0;transform:scale(0.5714285714285714)">'
    expect(html).toContain(opening)
    // Quitando sólo el wrapper nuevo, el root, los grupos y el orden deben ser exactamente iguales.
    expect(html.replace(opening, '').replace(/<\/div><\/div>$/, '</div>')).toBe(normal)
    expect(diagramGeometryNodes(zoomed)).toBe(diagramGeometryNodes(scene) + 1)
    expect(diagramBackgroundStyle(zoomed, 2, 22, 34)).toEqual(diagramBackgroundStyle(scene, 2, 22, 34))
  })
  it('mantiene HTML RichText/KaTeX/mhchem inerte y tipografía de caja', () => {
    preflightDrawingTexts(diagramTexts(scene), diagramGeometryNodes(scene))
    const html = renderToStaticMarkup(<DiagramExportScene scene={validateDiagramRenderScene(scene)} />)
    expect(html).toContain('data-diagram-scene')
    expect(html).toContain('width:400px;height:300px')
    expect(html).toContain('line-height:19px')
    expect(html).toContain('-webkit-line-clamp:6')
    expect(html).toContain('-webkit-line-clamp:3')
    expect(html).toContain('border-radius:4px 14px 4px 4px')
    expect(html).toContain('var(--e2)')
    expect(html).toContain('katex-html')
    expect(html).toContain('https://example.org')
    expect(html).toContain('lang="ar" dir="rtl"')
    expect(html).not.toMatch(/<a\s|href=|src=|data-ask|data-reveal|<button|<input|foreignObject|animation:|transition:/)
  })
  it('conserva grupos de composición, tinta seca, máscaras Venn, orden y fase de flujo', () => {
    const html = renderToStaticMarkup(<DiagramExportScene scene={scene} />)
    expect(html).toContain('inset:0;opacity:0.24')
    expect(html).toContain('stroke-dasharray="2 12" stroke-dashoffset="-19.5"')
    expect(html).toContain('clip-path="url(#d-2-c0)"')
    expect(html).toContain('clip-path="url(#d-2-c1)"')
    expect(html).toContain('mask="url(#d-2-m)"')
    expect(html).toContain('cx="195" cy="205" r="85" fill="#000"')
    expect(html).toContain('stroke="#000" stroke-width="0.3"')
    expect(html.indexOf('data-diagram-label')).toBeLessThan(html.indexOf('stroke-dashoffset="-19.5"'))
    expect(html.indexOf('id="d-2-m"')).toBeLessThan(html.indexOf('id="d-3-0"'))
  })
  it('el fondo sigue el origen natural al ampliar márgenes y cambiar escala', () => {
    expect(diagramBackgroundStyle(scene, 2, 22, 34)).toEqual({ backgroundColor: '#13110e', backgroundImage: 'radial-gradient(circle, #ffffff1a 2px, transparent 2.4px)', backgroundSize: '36px 36px', backgroundPosition: '22px 34px' })
    expect(diagramBackgroundStyle(scene).backgroundPosition).toBe('0px 0px')
  })
  it('pinta cada unión del contrato y mantiene el límite SVG de miter en cuatro', () => {
    const html = renderToStaticMarkup(<DiagramExportScene scene={validateDiagramRenderScene(scene)} />)
    expect(html).toMatch(/d="M0 0L200 0L200 140Z"[^>]+stroke-linejoin="round" stroke-miterlimit="4"/)
    expect(html).toMatch(/d="M0 0L200 200"[^>]+stroke-linejoin="miter" stroke-miterlimit="4"/)
  })
  it('es determinista, sin estado ni mutaciones posteriores', () => {
    const before = JSON.stringify(scene)
    expect(renderToStaticMarkup(<DiagramExportScene scene={scene} />)).toBe(renderToStaticMarkup(<DiagramExportScene scene={scene} />))
    expect(JSON.stringify(scene)).toBe(before)
  })
  it('conserva el cuerpo serif/cursiva heredado de una diapositiva', () => {
    const inherited = { ...scene, metrics: { ...scene.metrics, bodyFont: 'serif' as const, bodyItalic: true } }
    const html = renderToStaticMarkup(<DiagramExportScene scene={inherited} />)
    expect(html).toContain('font-family:var(--font-serif);font-style:italic')
    expect(html).not.toContain('font-family:var(--font-sans)')
  })
  it('rechaza recursos Markdown antes de montar la escena', () => {
    const bad = structuredClone(scene)
    const group = bad.primitives[0]
    if (group.kind !== 'group' || group.children[1].kind !== 'label') throw new Error('fixture')
    group.children[1].lines[0].text = '![No](https://example.com/private.png)'
    expect(() => preflightDrawingTexts(diagramTexts(bad), diagramGeometryNodes(bad))).toThrow(/resources/)
  })
})

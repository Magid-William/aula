import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { chartSceneFixture, chartTextFixture } from '@engine/figures/testing'
import { chartGeometryNodes, validateChartRenderScene } from '@engine/figures/chart'
import { ChartExportScene } from './ChartExportScene'

describe('escena pasiva Chart', () => {
  it('pinta SVG real en un único lienzo y mantiene cada regla cerrada de trazo y tspan', () => {
    const scene = validateChartRenderScene(chartSceneFixture()), html = renderToStaticMarkup(<ChartExportScene scene={scene} />)
    expect(html.match(/<svg /g)).toHaveLength(1)
    expect(html).toContain('stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4"')
    expect(html).toContain('fill-opacity="0.8" stroke-opacity="0.6"')
    expect(html).toContain('<tspan x="20" dy="0">Primera</tspan><tspan x="20" dy="14">Segunda</tspan>')
    expect(html).toContain('font-size="12" font-weight="500" text-anchor="middle"')
    expect(html).toContain('font-variant-numeric:tabular-nums')
    expect(html.indexOf('data-chart-svg')).toBeLessThan(html.indexOf('data-chart-panel'))
    expect(html.indexOf('data-chart-panel')).toBeLessThan(html.indexOf('data-chart-text'))
    // Tres hojas de texto más todos los elementos reales; ningún wrapper oculto por primitive.
    expect(chartGeometryNodes(scene)).toBe((html.match(/<[a-z][a-z-]*/g)?.length ?? 0) + 3)
  })
  it('reproduce la caja de contenido y ellipsis CSS sin interpretar texto literal o añadir padding', () => {
    const scene = chartSceneFixture(), text = chartTextFixture()
    text.text = '**texto** $x$ <img src="https://private"> العربية 👩‍🔬 COLA OCULTA'; text.direction = 'rtl'; text.align = 'end'; text.letterSpacing = -.2; text.opacity = .6
    text.box = { x: 22.125, y: -12.5, width: 37.75, height: 19.5 }; scene.layers.push(text)
    const html = renderToStaticMarkup(<ChartExportScene scene={validateChartRenderScene(scene)} />)
    expect(html).toContain('left:22.125px;top:-12.5px;width:37.75px;height:19.5px;box-sizing:content-box;padding:0;border:0;margin:0')
    expect(html).toContain('direction:rtl;text-align:end;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.6')
    expect(html).toContain('**texto** $x$ &lt;img src=&quot;https://private&quot;&gt; العربية 👩‍🔬 COLA OCULTA')
    expect(html).not.toMatch(/<a\s|href=|<img|<script|foreignObject|<button|data-ask|animation:|transition:|max-width:|display:flex|display:grid|katex|<strong/)
  })
  it('compensa zoom y conserva fuente propia serif/cursiva de HTML y herencia mono SVG', () => {
    const scene = chartSceneFixture(); scene.metrics.bodyFont = 'mono'; scene.metrics.bodyItalic = true
    const text = chartTextFixture(); text.font = 'serif'; text.italic = true; scene.layers.push(text)
    const normal = renderToStaticMarkup(<ChartExportScene scene={scene} />)
    scene.metrics.cssZoom = 1.75
    const zoomed = renderToStaticMarkup(<ChartExportScene scene={validateChartRenderScene(scene)} />)
    const opening = '<div data-figure-css-zoom="true" style="position:absolute;left:0;top:0;width:100px;height:80px;zoom:1.75;transform-origin:0 0;transform:scale(0.5714285714285714)">'
    expect(zoomed).toContain(opening)
    expect(zoomed.replace(opening, '').replace(/<\/div><\/div>$/, '</div>')).toBe(normal)
    expect(zoomed).toContain('font-family:var(--font-mono);font-style:italic')
    expect(zoomed).toContain('font-family:var(--font-serif);font-style:italic')
    expect(zoomed).toContain('box-shadow:var(--e2)')
  })
  it('conserva direction/idioma efectivos y overflow SVG de cada rama sin reinterpretarlos', () => {
    const scene = chartSceneFixture(); scene.chartKind = 'pie'; scene.branch = 'donut'; scene.appearance.language = 'ar'; scene.appearance.direction = 'ltr'
    const svg = scene.layers[0]; if (svg.kind !== 'svg') throw new Error('fixture'); svg.overflow = 'hidden'
    const html = renderToStaticMarkup(<ChartExportScene scene={validateChartRenderScene(scene)} />)
    expect(html).toContain('data-chart-scene="true" lang="ar" dir="ltr"')
    expect(html).toMatch(/<svg[^>]+overflow:hidden/)
  })
  it('es determinista y no muta la escena al pintar el panel vacío con su leyenda', () => {
    const scene = chartSceneFixture(); scene.branch = 'empty'; scene.layers.shift()
    const before = JSON.stringify(scene), html = renderToStaticMarkup(<ChartExportScene scene={scene} />)
    expect(html).toBe(renderToStaticMarkup(<ChartExportScene scene={scene} />))
    expect(JSON.stringify(scene)).toBe(before); expect(html).not.toContain('<svg')
    expect(html).toContain('data-chart-panel'); expect(html).toContain('data-chart-text')
  })
})

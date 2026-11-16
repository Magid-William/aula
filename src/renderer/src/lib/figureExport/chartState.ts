// Congela sólo el commit de Chart y sus hojas HTML conocidas; no interpreta HTML ni serializa el DOM.
import type { ChartBox, ChartLayer, ChartPanel, ChartRenderSceneV1, ChartTextBox } from '@shared/figuresChart'
import { projectChartSvg, type CommittedChartSvg } from '@renderer/blocks/chart/presentation'
import { assertDrawingFontsReady } from './drawingFonts'
import { chartTypography } from './chartTypography'
import { chartCssPixels, createChartGeometry } from './chartGeometry'

export interface ChartCommittedState {
  chartKind: ChartRenderSceneV1['chartKind']
  empty: boolean
  dark: boolean
}
const fail = (): never => { throw new Error('Chart presentation is unavailable') }
const radiusOf = (css: CSSStyleDeclaration): number => { const n = parseFloat(css.borderTopLeftRadius); return Number.isFinite(n) ? n : fail() }
const weightOf = (value: string): 400 | 500 | 600 => { const n = Number(value); return n === 400 || n === 500 || n === 600 ? n : fail() }

/** La dirección y lang del curso no giran las figuras: se conserva el contexto DOM efectivo. */
export function chartLanguage(element: HTMLElement): string {
  const language = element.closest('[lang]')?.getAttribute('lang') || element.ownerDocument.documentElement.lang || 'en'
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) return fail()
  return language
}

export function freezeChartExportState(state: ChartCommittedState, body: HTMLElement, svg: CommittedChartSvg | null): ChartRenderSceneV1 {
  if (!body.isConnected || state.empty === !!svg || svg && (!svg.element.isConnected || !body.contains(svg.element))) return fail()
  assertDrawingFontsReady(body)
  const document = body.ownerDocument, rootStyle = getComputedStyle(body)
  const geometry = createChartGeometry(body, svg?.element ?? null), { width, height } = geometry
  if (svg && Math.abs(width - svg.layoutWidth) > 1.1) return fail()
  const probe = document.createElement('span'), canvas = document.createElement('canvas')
  probe.style.display = 'none'; body.appendChild(probe)
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!context) { probe.remove(); return fail() }
  const colors = new Map<string, string>()
  const resolve = (value: string): string => {
    if (value === 'none') return value
    const cached = colors.get(value)
    if (cached) return cached
    probe.style.color = ''; probe.style.color = value
    const css = getComputedStyle(probe).color
    if (!probe.style.color || !css || !CSS.supports('color', css)) return fail()
    context.clearRect(0, 0, 1, 1); context.fillStyle = css; context.fillRect(0, 0, 1, 1)
    const rgba = [...context.getImageData(0, 0, 1, 1).data]
    const hex = '#' + rgba.slice(0, rgba[3] === 255 ? 3 : 4).map(n => n.toString(16).padStart(2, '0')).join('')
    colors.set(value, hex); return hex
  }
  const text = (element: HTMLElement, value: string, box?: ChartBox): ChartTextBox => {
    const css = getComputedStyle(element), font = chartTypography(element)
    const whiteSpace = css.whiteSpace === 'nowrap' ? 'nowrap' : css.whiteSpace === 'normal' ? 'normal' : fail()
    const overflow = css.overflowX === 'hidden' ? 'hidden' : css.overflowX === 'visible' ? 'visible' : fail()
    const align = css.textAlign
    if (!['left', 'right', 'center', 'start', 'end'].includes(align)) return fail()
    return {
      kind: 'html-text', box: box ?? geometry.contentBox(element), text: value, color: resolve(css.color), font: font.bodyFont, italic: font.bodyItalic,
      size: chartCssPixels(element, 'font-size'), lineHeight: geometry.lineHeight(element), weight: weightOf(css.fontWeight), letterSpacing: chartCssPixels(element, 'letter-spacing', true),
      tabular: css.fontVariantNumeric.includes('tabular-nums'), direction: css.direction === 'rtl' ? 'rtl' : 'ltr', align: align as ChartTextBox['align'],
      whiteSpace, overflow, truncate: css.textOverflow === 'ellipsis', opacity: 1
    }
  }
  try {
    const layers: ChartLayer[] = []
    if (svg) {
      const box = geometry.boxOf(svg.element)
      if (Math.abs(box.width - svg.width) > 1 || Math.abs(box.height - svg.height) > 1) return fail()
      layers.push({ kind: 'svg', box: { ...box, width: svg.width, height: svg.height }, overflow: svg.overflow, primitives: projectChartSvg(svg.children, resolve, { weight: weightOf(rootStyle.fontWeight) }) })
    }
    const leaves = body.querySelectorAll<HTMLElement>('[data-chart-panel], [data-chart-text], [data-chart-legend]')
    if (leaves.length > 10_000) return fail()
    let textBytes = 0
    for (const element of leaves) {
      const css = getComputedStyle(element)
      if (css.display === 'none' || css.visibility !== 'visible') return fail()
      if (element.hasAttribute('data-chart-panel')) {
        const box = geometry.boxOf(element), borderWidth = geometry.borderWidth(element), background = element.dataset.chartBackground ?? css.backgroundColor
        const panel: ChartPanel = {
          kind: 'panel', box, background: resolve(background), border: borderWidth ? resolve(css.borderTopColor) : 'none', borderWidth,
          radius: Math.min(radiusOf(css), box.width / 2, box.height / 2), shadow: element.dataset.chartShadow === 'e2' ? 'e2' : 'none', opacity: 1
        }
        layers.push(panel)
      }
      if (element.hasAttribute('data-chart-text')) {
        if (element.children.length) return fail()
        const value = element.textContent ?? ''
        textBytes += new TextEncoder().encode(value).length
        if (textBytes > 65_536 || value.length > 8192) return fail()
        layers.push(text(element, value))
      }
      if (element.hasAttribute('data-chart-legend')) {
        // El texto directo es el anonymous flex item original; no añadimos un wrapper que cambie su min-width.
        const swatch = element.firstElementChild
        const nodes = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
        if (!swatch || nodes.length > 1 || element.children.length !== 1) return fail()
        if (!nodes.length) continue
        const value = nodes[0].textContent ?? '', range = document.createRange()
        range.selectNodeContents(nodes[0])
        const rects = [...range.getClientRects()]; range.detach()
        const rows = new Set(rects.map(r => Math.round(r.y * 100))).size || 1
        const legend = geometry.legend(element, swatch), lineHeight = geometry.lineHeight(element)
        const textWidth = Math.max(legend.available, ...rects.map(r => r.width / geometry.scaleX))
        const rtl = css.direction === 'rtl'
        const box = { x: rtl ? legend.left : legend.start, y: legend.textY(rows), width: textWidth, height: rows * lineHeight }
        textBytes += new TextEncoder().encode(value).length
        if (textBytes > 65_536 || value.length > 8192) return fail()
        layers.push(text(element, value, box))
      }
    }
    geometry.assertCurrent()
    return {
      version: 1, family: 'chart', chartKind: state.chartKind, branch: svg?.branch ?? 'empty', canvas: { width, height },
      metrics: { rootFontPx: chartCssPixels(document.documentElement, 'font-size'), ...chartTypography(body), rawEffectiveZoom: geometry.effectiveZoom },
      appearance: { theme: state.dark ? 'dark' : 'light', language: chartLanguage(body), direction: rootStyle.direction === 'rtl' ? 'rtl' : 'ltr', palette: {
        paper: resolve('var(--surface)'), text: resolve('var(--text)'), text2: resolve('var(--text2)'), text3: resolve('var(--text3)'), link: resolve('var(--accent-text)'), accent: resolve('var(--accent)'), brick: resolve('var(--pigment-brick)')
      } },
      layers, output: { scale: 2 }
    }
  } finally { probe.remove(); canvas.width = canvas.height = 0 }
}

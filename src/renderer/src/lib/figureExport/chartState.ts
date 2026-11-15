// Congela sólo el commit de Chart y sus hojas HTML conocidas; no interpreta HTML ni serializa el DOM.
import type { ChartBox, ChartLayer, ChartPanel, ChartRenderSceneV1, ChartTextBox } from '@shared/figuresChart'
import { projectChartSvg, type CommittedChartSvg } from '@renderer/blocks/chart/presentation'
import { assertDrawingFontsReady } from './drawingFonts'
import { chartTypography } from './chartTypography'

export interface ChartCommittedState {
  chartKind: ChartRenderSceneV1['chartKind']
  empty: boolean
  dark: boolean
}
const fail = (): never => { throw new Error('Chart presentation is unavailable') }
const px = (value: string): number => { const n = parseFloat(value); return Number.isFinite(n) ? n : fail() }
const weightOf = (value: string): 400 | 500 | 600 => { const n = Number(value); return n === 400 || n === 500 || n === 600 ? n : fail() }
const normalize = (value: number): number => Math.abs(value) < 1e-8 ? 0 : value

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
  const width = px(rootStyle.width), height = px(rootStyle.height), origin = body.getBoundingClientRect()
  if (width <= 0 || height <= 0 || width > 16_384 || height > 16_384) return fail()
  const sx = origin.width / width, sy = origin.height / height
  if (![sx, sy].every(k => Number.isFinite(k) && k > 0)) return fail()
  if (svg && Math.abs(width - svg.layoutWidth) > 1.1) return fail()
  // Los contextos de diapositiva pueden escalar/trasladar. Una rotación/perspectiva no admite estas cajas ortogonales.
  for (let ancestor: Element | null = body; ancestor; ancestor = ancestor.parentElement) {
    const transform = getComputedStyle(ancestor).transform
    if (transform !== 'none') {
      const m = new DOMMatrixReadOnly(transform)
      if (!m.is2D || m.b !== 0 || m.c !== 0 || m.a <= 0 || m.d <= 0) return fail()
    }
  }
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
  const boxOf = (element: Element): ChartBox => {
    const r = element.getBoundingClientRect()
    let dx = 0
    // Sólo las filas Pie trasladan sus hojas al entrar. El destino conocido es x=0, sin tocar la animación viva.
    for (let a: Element | null = element; a && a !== body; a = a.parentElement) {
      const transform = getComputedStyle(a).transform
      if (transform === 'none') continue
      const m = new DOMMatrixReadOnly(transform)
      if (!a.hasAttribute('data-chart-enter-x')) {
        if (!m.is2D || m.a !== 1 || m.d !== 1 || m.b || m.c || m.m41 || m.m42) return fail()
        continue
      }
      if (!m.is2D || m.a !== 1 || m.d !== 1 || m.b || m.c || m.m42) return fail()
      dx += m.m41
    }
    return { x: normalize((r.x - origin.x) / sx - dx), y: normalize((r.y - origin.y) / sy), width: r.width / sx, height: r.height / sy }
  }
  const contentBox = (element: HTMLElement, css: CSSStyleDeclaration): ChartBox => {
    const box = boxOf(element)
    const left = px(css.paddingLeft) + px(css.borderLeftWidth), right = px(css.paddingRight) + px(css.borderRightWidth)
    const top = px(css.paddingTop) + px(css.borderTopWidth), bottom = px(css.paddingBottom) + px(css.borderBottomWidth)
    return { x: box.x + left, y: box.y + top, width: Math.max(0, box.width - left - right), height: Math.max(0, box.height - top - bottom) }
  }
  const text = (element: HTMLElement, value: string, box?: ChartBox): ChartTextBox => {
    const css = getComputedStyle(element), font = chartTypography(element)
    const whiteSpace = css.whiteSpace === 'nowrap' ? 'nowrap' : css.whiteSpace === 'normal' ? 'normal' : fail()
    const overflow = css.overflowX === 'hidden' ? 'hidden' : css.overflowX === 'visible' ? 'visible' : fail()
    const align = css.textAlign
    if (!['left', 'right', 'center', 'start', 'end'].includes(align)) return fail()
    return {
      kind: 'html-text', box: box ?? contentBox(element, css), text: value, color: resolve(css.color), font: font.bodyFont, italic: font.bodyItalic,
      size: px(css.fontSize), lineHeight: px(css.lineHeight), weight: weightOf(css.fontWeight), letterSpacing: css.letterSpacing === 'normal' ? 0 : px(css.letterSpacing),
      tabular: css.fontVariantNumeric.includes('tabular-nums'), direction: css.direction === 'rtl' ? 'rtl' : 'ltr', align: align as ChartTextBox['align'],
      whiteSpace, overflow, truncate: css.textOverflow === 'ellipsis', opacity: 1
    }
  }
  try {
    const layers: ChartLayer[] = []
    if (svg) {
      const box = boxOf(svg.element)
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
        const box = boxOf(element), borderWidth = px(css.borderTopWidth), background = element.dataset.chartBackground ?? css.backgroundColor
        const panel: ChartPanel = {
          kind: 'panel', box, background: resolve(background), border: borderWidth ? resolve(css.borderTopColor) : 'none', borderWidth,
          radius: Math.min(px(css.borderTopLeftRadius), box.width / 2, box.height / 2), shadow: element.dataset.chartShadow === 'e2' ? 'e2' : 'none', opacity: 1
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
        const own = contentBox(element, css), swatchBox = boxOf(swatch), gap = px(css.columnGap), lineHeight = px(css.lineHeight)
        const available = Math.max(0, own.width - swatchBox.width - gap)
        const textWidth = Math.max(available, ...rects.map(r => r.width / sx))
        const rtl = css.direction === 'rtl'
        const box = { x: rtl ? own.x : swatchBox.x + swatchBox.width + gap, y: own.y + (own.height - rows * lineHeight) / 2, width: textWidth, height: rows * lineHeight }
        textBytes += new TextEncoder().encode(value).length
        if (textBytes > 65_536 || value.length > 8192) return fail()
        layers.push(text(element, value, box))
      }
    }
    return {
      version: 1, family: 'chart', chartKind: state.chartKind, branch: svg?.branch ?? 'empty', canvas: { width, height },
      metrics: { rootFontPx: px(getComputedStyle(document.documentElement).fontSize), ...chartTypography(body) },
      appearance: { theme: state.dark ? 'dark' : 'light', language: chartLanguage(body), direction: rootStyle.direction === 'rtl' ? 'rtl' : 'ltr', palette: {
        paper: resolve('var(--surface)'), text: resolve('var(--text)'), text2: resolve('var(--text2)'), text3: resolve('var(--text3)'), link: resolve('var(--accent-text)'), accent: resolve('var(--accent)'), brick: resolve('var(--pigment-brick)')
      } },
      layers, output: { scale: 2 }
    }
  } finally { probe.remove(); canvas.width = canvas.height = 0 }
}

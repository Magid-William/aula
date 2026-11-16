import type { ChartBox } from '@shared/figuresChart'
import {
  addIntervals, CHART_LAYOUT_LIMITS, computedChartPixelsRange, divideIntervals, emitLayoutUnit,
  float32Cell, multiplyIntervals, nextFloat32, recoverEffectiveZoom,
  recoverComputedLayoutUnit, recoverComputedLineHeightUnit, recoverComputedUsedUnit,
  recoverLayoutUnit, subtractIntervals, type LayoutInterval
} from '@shared/chartLayout'

const fail = (): never => { throw new Error('Chart geometry is unavailable') }
const point = (n: number): LayoutInterval => ({ lo: n, hi: n })
const magnitude = (v: LayoutInterval): number => Math.max(Math.abs(v.lo), Math.abs(v.hi))
const positive = (n: number): number => Number.isFinite(n) && n > 0 ? n : fail()
const floatHull = (v: LayoutInterval): LayoutInterval => ({ lo: float32Cell(Math.fround(v.lo)).lo, hi: float32Cell(Math.fround(v.hi)).hi })
const expanded = (v: LayoutInterval, error: number): LayoutInterval => addIntervals(v, { lo: -error, hi: error })

/** Typed OM evita la serialización %.6g; no acepta auto, porcentajes ni cadenas CSS. */
export function chartCssPixels(element: Element, property: string, normalIsZero = false): number {
  const value = element.computedStyleMap().get(property)
  if (normalIsZero && value instanceof CSSKeywordValue && value.value === 'normal') return 0
  if (!(value instanceof CSSUnitValue) || value.unit !== 'px' || !Number.isFinite(value.value)) return fail()
  return value.value
}

interface AxisOperation { x: number; y: number; tx: number; ty: number; transformed: boolean }
interface ElementInfo { css: CSSStyleDeclaration; zoom: LayoutInterval; operation: AxisOperation }
interface UnitBox { x: number; y: number; width: number; height: number }

function numeric(value: CSSNumberish, unit: 'number' | 'px'): number {
  if (typeof value === 'number') return unit === 'number' && Number.isFinite(value) ? value : fail()
  return value instanceof CSSUnitValue && value.unit === unit && Number.isFinite(value.value) ? value.value : fail()
}

/** Sólo las operaciones presentes en Chart/Slides. Una matriz arbitraria pierde esta procedencia. */
function operation(element: Element, css: CSSStyleDeclaration): AxisOperation {
  const identity = { x: 1, y: 1, tx: 0, ty: 0, transformed: false }
  if (css.transform === 'none') return identity
  const value = element.computedStyleMap().get('transform')
  if (!(value instanceof CSSTransformValue) || value.length !== 1) return fail()
  const component = value[0]
  // Incluso matrix(identity) puede promover gfx::Transform a Matrix44 double;
  // no pertenece al mapa axis Float32 demostrado para scale/translate.
  if (component instanceof CSSScale) {
    if (!component.is2D || numeric(component.z, 'number') !== 1 || !/^0px 0px(?: 0px)?$/.test(css.transformOrigin)) return fail()
    return { ...identity, x: positive(Math.fround(numeric(component.x, 'number'))), y: positive(Math.fround(numeric(component.y, 'number'))), transformed: true }
  }
  if (component instanceof CSSTranslate) {
    if (!component.is2D || numeric(component.z, 'px') !== 0) return fail()
    // ComputedStyle::RequireTransformOrigin omite el origen en una traducción sola.
    return { ...identity, tx: numeric(component.x, 'px'), ty: numeric(component.y, 'px'), transformed: true }
  }
  return fail()
}

/** Inversa conservadora de AdjustLayoutUnit(offset/E).Round(), sólo para cotas de magnitud. */
export function chartOffsetMagnitude(observed: number, effectiveZoom: LayoutInterval): number {
  // Una lectura saturada ya no proporciona una preimagen acotada.
  if (!Number.isSafeInteger(observed) || Math.abs(observed) >= 2 ** 25 - 1) return fail()
  const rounded = { lo: observed - 33 / 64, hi: observed + 33 / 64 }
  // Invierte división Float32 y ToFloat del LayoutUnit; no usa offsetLeft como posición final.
  return magnitude(floatHull(multiplyIntervals(floatHull(rounded), effectiveZoom)))
}

/** Cota por operaciones, independiente del residuo BCR observado. */
export function chartPointError(rawMagnitude: number, transforms: number, amplification: number): number {
  if (!Number.isFinite(rawMagnitude) || rawMagnitude < 0 || !Number.isInteger(transforms) || transforms < 0 || transforms > 128 || !Number.isFinite(amplification) || amplification < 1) return fail()
  // ApplyAccumulatedOffset + PostTranslate + MapPoint(mul/add), y la salida final.
  const operations = 4 * transforms + 2
  let growth = point(1)
  for (let n = 0; n < operations; n++) growth = multiplyIntervals(growth, point(1 + 2 ** -24))
  const bound = addIntervals(multiplyIntervals(point(rawMagnitude), growth), point(operations * 2 ** -150)).hi
  if (bound > CHART_LAYOUT_LIMITS.maxUnit / 64) return fail()
  let ceiling = Math.fround(Math.max(bound, 2 ** -126))
  if (ceiling < bound) ceiling = nextFloat32(ceiling, 1)
  const halfUlp = (nextFloat32(ceiling, 1) - ceiling) / 2
  return multiplyIntervals(point(operations * halfUlp), point(amplification)).hi
}

/** El scrollingElement expone scroll de ventana normalizado por I, no por su CSS zoom. */
export function chartScrollMagnitude(observed: number, effectiveZoom: LayoutInterval, viewportZoom?: number): number {
  const zoom = viewportZoom === undefined ? effectiveZoom : point(positive(viewportZoom))
  return magnitude(multiplyIntervals(floatHull(point(Math.abs(observed))), zoom))
}

export function createChartGeometry(body: HTMLElement, svg: SVGSVGElement | null) {
  const view = body.ownerDocument.defaultView
  if (!view) return fail()
  const initialZoom = positive(view.devicePixelRatio), reciprocal = Math.fround(1 / initialZoom)
  if (Math.fround(initialZoom) !== initialZoom) return fail()
  const infos = new Map<Element, ElementInfo>()
  const info = (element: Element): ElementInfo => {
    const cached = infos.get(element)
    if (cached) return cached
    const css = getComputedStyle(element), current = positive(element.currentCSSZoom)
    if (Math.fround(current) !== current || css.writingMode !== 'horizontal-tb' || css.perspective !== 'none' || css.transformStyle !== 'flat'
      || css.rotate !== 'none' || css.scale !== 'none' || css.translate !== 'none' || css.position === 'sticky'
      // Chromium152: normal es inicial; sólo equivale a none cuando no hay position-area.
      || css.getPropertyValue('anchor-name') !== 'none' || !['normal', 'none'].includes(css.getPropertyValue('position-anchor')) || css.getPropertyValue('position-area') !== 'none'
      || !['auto', '1'].includes(css.columnCount) || element.getClientRects().length !== 1) return fail()
    const result = { css, zoom: multiplyIntervals(float32Cell(current), point(initialZoom)), operation: operation(element, css) }
    infos.set(element, result)
    return result
  }
  const ancestors = (element: Element): Element[] => {
    const result: Element[] = []
    for (let at: Element | null = element; at; at = at.parentElement) {
      if (result.length >= 128) return fail()
      info(at); result.push(at)
    }
    return result
  }
  const outer = ancestors(body)
  let scaleX = 1, scaleY = 1, ctmX = reciprocal, ctmY = reciprocal
  // Slides aporta un scale externo; los otros ancestros actuales sólo trasladan.
  if (outer.filter(element => { const op = info(element).operation; return op.x !== 1 || op.y !== 1 }).length > 1) return fail()
  // CTM acumula matrices; los BCR aplanan puntos. Son mapas distintos.
  for (const element of outer.toReversed()) {
    const op = info(element).operation
    scaleX *= op.x; scaleY *= op.y
    ctmX = Math.fround(ctmX * op.x); ctmY = Math.fround(ctmY * op.y)
  }
  let axes: readonly [number, number] | undefined
  if (svg) {
    const css = info(svg).css, matrix = svg.getScreenCTM()
    if (svg.hasAttribute('viewBox') || svg.hasAttribute('transform') || css.transform !== 'none' || svg.currentCSSZoom !== body.currentCSSZoom
      || !matrix || matrix.b !== 0 || matrix.c !== 0 || css.display !== 'block'
      || ['padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'border-left-width', 'border-right-width', 'border-top-width', 'border-bottom-width'].some(name => chartCssPixels(svg, name) !== 0)) return fail()
    axes = [positive(matrix.a), positive(matrix.d)]
  }
  const effectiveZoom = recoverEffectiveZoom(initialZoom, body.currentCSSZoom, axes)
  if (axes && (axes[0] !== effectiveZoom * ctmX || axes[1] !== effectiveZoom * ctmY)) return fail()
  const magnitudeCache = new Map<Element, { errorX: number; errorY: number }>()
  const errors = (element: Element): { errorX: number; errorY: number } => {
    const cached = magnitudeCache.get(element)
    if (cached) return cached
    const chain = ancestors(element), offsets = new Set<Element>()
    let at = element as HTMLElement, mx = 0, my = 0
    if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
      if (element !== svg || !element.parentElement) return fail()
      at = element.parentElement
    }
    mx = chartOffsetMagnitude(at.offsetWidth, info(at).zoom)
    my = chartOffsetMagnitude(at.offsetHeight, info(at).zoom)
    for (let count = 0; at; count++) {
      if (count >= 128 || offsets.has(at) || info(at).css.display === 'inline') return fail()
      offsets.add(at)
      const zoom = info(at).zoom
      mx = addIntervals(point(mx), point(chartOffsetMagnitude(at.offsetLeft, zoom))).hi
      my = addIntervals(point(my), point(chartOffsetMagnitude(at.offsetTop, zoom))).hi
      const parent = at.offsetParent
      if (parent) {
        if (!(parent instanceof HTMLElement) || !chain.includes(parent)) return fail()
        const parentZoom = info(parent).zoom
        // OffsetPoint resta el borde del offsetParent no-body.
        mx = addIntervals(point(mx), multiplyIntervals(float32Cell(Math.abs(chartCssPixels(parent, 'border-left-width'))), parentZoom)).hi
        my = addIntervals(point(my), multiplyIntervals(float32Cell(Math.abs(chartCssPixels(parent, 'border-top-width'))), parentZoom)).hi
      }
      at = parent as HTMLElement
    }
    let transforms = 0, amplificationX = 1, amplificationY = 1
    for (const ancestor of chain) {
      const { zoom, operation: op } = info(ancestor)
      if (op.transformed && ancestor !== element && !offsets.has(ancestor)) return fail()
      // El scroll es una traducción adicional que offsetLeft no incluye.
      const viewportZoom = ancestor === body.ownerDocument.scrollingElement ? initialZoom : undefined
      mx = addIntervals(point(mx), point(chartScrollMagnitude(ancestor.scrollLeft, zoom, viewportZoom))).hi
      my = addIntervals(point(my), point(chartScrollMagnitude(ancestor.scrollTop, zoom, viewportZoom))).hi
      if (op.transformed) {
        transforms++
        mx = multiplyIntervals(addIntervals(point(mx), multiplyIntervals(float32Cell(Math.abs(op.tx)), zoom)), point(Math.max(1, op.x))).hi
        my = multiplyIntervals(addIntervals(point(my), multiplyIntervals(float32Cell(Math.abs(op.ty)), zoom)), point(Math.max(1, op.y))).hi
        amplificationX *= Math.max(1, op.x); amplificationY *= Math.max(1, op.y)
      }
    }
    const result = { errorX: chartPointError(mx, transforms, amplificationX), errorY: chartPointError(my, transforms, amplificationY) }
    magnitudeCache.set(element, result)
    return result
  }
  const origin = body.getBoundingClientRect(), originError = errors(body)
  const unitsCache = new Map<Element, UnitBox>()
  const unzoom = (observed: number): LayoutInterval => divideIntervals(float32Cell(observed), point(reciprocal))
  const unitsOf = (element: Element): UnitBox => {
    const cached = unitsCache.get(element)
    if (cached) return cached
    if (element !== body && !body.contains(element) || element.currentCSSZoom !== body.currentCSSZoom) return fail()
    const rect = element.getBoundingClientRect(), error = errors(element)
    let tx = point(0), entering = false
    for (let at: Element | null = element; at && at !== body; at = at.parentElement) {
      const op = info(at).operation
      if (!op.transformed) continue
      if (op.x === 1 && op.y === 1 && op.tx === 0 && op.ty === 0) continue
      if (entering || !at.hasAttribute('data-chart-enter-x') || op.x !== 1 || op.y !== 1 || op.ty !== 0) return fail()
      entering = true; tx = computedChartPixelsRange(op.tx, effectiveZoom)
    }
    const position = (value: number, base: number, error: number, scale: number, translation = point(0)): number => recoverLayoutUnit(multiplyIntervals(
      subtractIntervals(divideIntervals(expanded(subtractIntervals(unzoom(value), unzoom(base)), error), point(scale)), translation), point(64)))
    // RectF::BoundingBox resta dos corners Float32 antes de normalizar su tamaño.
    const dimension = (value: number, error: number, scale: number): number => recoverLayoutUnit(multiplyIntervals(
      divideIntervals(expanded(floatHull(unzoom(value)), 2 * error), point(scale)), point(64)))
    const result = {
      x: element === body ? 0 : position(rect.x, origin.x, error.errorX + originError.errorX, scaleX, tx),
      y: element === body ? 0 : position(rect.y, origin.y, error.errorY + originError.errorY, scaleY),
      width: dimension(rect.width, error.errorX, scaleX), height: dimension(rect.height, error.errorY, scaleY)
    }
    if (result.width < 0 || result.height < 0) return fail()
    unitsCache.set(element, result)
    return result
  }
  const emit = (n: number): number => emitLayoutUnit(n, effectiveZoom)
  const box = (value: UnitBox): ChartBox => ({ x: emit(value.x), y: emit(value.y), width: emit(value.width), height: emit(value.height) })
  const used = (element: Element, property: string): number => recoverComputedLayoutUnit(chartCssPixels(element, property), effectiveZoom)
  const border = (element: Element, side: 'left' | 'right' | 'top' | 'bottom'): number => {
    const style = info(element).css.getPropertyValue(`border-${side}-style`)
    // Typed OM puede separar el ancho interno del estilo none; aquí interesa el borde pintado/usado.
    if (style === 'none' || style === 'hidden') return 0
    if (style !== 'solid') return fail()
    const unit = recoverComputedUsedUnit(chartCssPixels(element, `border-${side}-width`), effectiveZoom)
    // Border*Width de ComputedStyle es int físico, no Length Float32.
    return unit >= 0 && unit % 64 === 0 ? unit : fail()
  }
  const lineHeight = (element: Element): number => recoverComputedLineHeightUnit(chartCssPixels(element, 'line-height'), effectiveZoom)
  const contentUnits = (element: HTMLElement): UnitBox => {
    const value = unitsOf(element)
    const left = used(element, 'padding-left') + border(element, 'left'), right = used(element, 'padding-right') + border(element, 'right')
    const top = used(element, 'padding-top') + border(element, 'top'), bottom = used(element, 'padding-bottom') + border(element, 'bottom')
    return { x: value.x + left, y: value.y + top, width: Math.max(0, value.width - left - right), height: Math.max(0, value.height - top - bottom) }
  }
  const canvas = box(unitsOf(body))
  if (canvas.width <= 0 || canvas.height <= 0 || canvas.width > 16_384 || canvas.height > 16_384) return fail()
  return {
    width: canvas.width, height: canvas.height, effectiveZoom,
    scaleX: scaleX * reciprocal * effectiveZoom, scaleY: scaleY * reciprocal * effectiveZoom,
    boxOf: (element: Element): ChartBox => box(unitsOf(element)),
    contentBox: (element: HTMLElement): ChartBox => box(contentUnits(element)),
    borderWidth: (element: Element): number => emit(border(element, 'top')),
    lineHeight: (element: Element): number => emit(lineHeight(element)),
    legend: (element: HTMLElement, swatch: Element) => {
      const own = contentUnits(element), sample = unitsOf(swatch), gap = used(element, 'column-gap')
      return {
        start: emit(sample.x + sample.width + gap), left: emit(own.x), available: emit(Math.max(0, own.width - sample.width - gap)),
        // La altura usada se redondea por línea; la mitad resultante no se vuelve a cuantizar.
        textY: (rows: number): number => (own.y + (own.height - rows * lineHeight(element)) / 2) / 64 / effectiveZoom
      }
    },
    assertCurrent: (): void => { if (view.devicePixelRatio !== initialZoom || body.currentCSSZoom !== Math.fround(effectiveZoom / initialZoom)) fail() }
  }
}

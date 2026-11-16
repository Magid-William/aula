// Referencia independiente de Chart: DOM vivo, origen de raster estable y papel continuo.
// No lee escenas DTO, atributos de exportación en las hojas ni helpers de bounds del producto.
import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { expect, type CDPSession, type ElectronApplication, type JSHandle, type Locator, type Page, type TestInfo } from 'playwright/test'
import type { LiveDiagramGeometry, PixelRect } from './diagram-pixels'

export interface ChartReferenceSnapshot {
  body: { box: PixelRect; naturalWidth: number; naturalHeight: number; scaleX: number; scaleY: number; styles: Record<string, string> }
  viewport: { width: number; height: number; scrollX: number; scrollY: number; devicePixelRatio: number }
  nodes: Array<{ path: string; tag: string; box: PixelRect; styles: Record<string, string>; attributes: Record<string, string> }>
  texts: Array<{ path: string; kind: 'text'; text: string; boxes: PixelRect[]; styles: Record<string, string> }>
}
interface ChartObservation {
  snapshot: ChartReferenceSnapshot
  ink: PixelRect
  labels: Array<PixelRect & { kind: 'text'; text: string }>
  background: [number, number, number]
  outerClips: Array<{ tag: string; x: boolean; y: boolean; box: PixelRect }>
}
interface ChartPlacementObservation {
  target: { x: number; y: number }
  quantum: { x: number; y: number }
  residual: { x: number; y: number }
  method: 'exact' | 'observed-css-grid'
}
export interface ChartReferencePlacement extends ChartPlacementObservation {
  before: ChartReferenceSnapshot
  after: ChartReferenceSnapshot
  /** Traslación global observada; ninguna coordenada interna se corrige. */
  displacement: { x: number; y: number }
  restore(): Promise<void>
}
export interface ChartReference {
  png: Buffer
  geometry: LiveDiagramGeometry
  clip: PixelRect
  snapshot: ChartReferenceSnapshot
  metadata: {
    clip: PixelRect
    ink: PixelRect
    canvasOffset: { x: number; y: number }
    isolation: { matte: PixelRect; hidden: Array<{ tag: string; className: string }>; maskedInk: false }
    capture: {
      api: 'Page.captureScreenshot'; sourceDpr: number; raster: 'dense'; width: number; height: number
      nativeContext: ChartNativeContext
      pageZoom: number
      calibration: { width: number; height: number; pixelsPerCss: number }; requestedScale: number; desiredPixelsPerCss: number
      observations: Array<{
        stage: string; before: ChartReferenceSnapshot; after: ChartReferenceSnapshot
        viewportBefore: ChartCaptureViewport; viewportAfter: ChartCaptureViewport; requestedDipClip: PixelRect & { scale: number }
      }>
    }
    invariantTolerance: number
    geometryTolerance: ChartReferenceGeometryTolerance
    placement: ChartPlacementObservation
  }
}

// Texto/estilos/atributos siguen exactos; sólo BCR admite su precisión observacional Float32.
const INVARIANT_TOLERANCE = 1e-6
const placements = new WeakMap<Locator, ChartPlacementObservation>()
interface ChartNativeContext { startupFactor: string; screenFactor: number; pageZoom: number; dpr: number }
interface ChartCaptureViewport { zoom: number; scale: number; offsetX: number; offsetY: number; pageX: number; pageY: number; clientWidth: number; clientHeight: number }
const nativeContexts = new WeakMap<Page, ChartNativeContext>()
const protocols = new WeakMap<Page, { session: CDPSession; sourceDpr: number; pageZoom: number }>()

/** Antes del viewport/CDP, comprueba el factor nativo real: el DPR emulado no identifica la rejilla de layout. */
export async function assertNativeChartContext(app: ElectronApplication, page: Page, sourceDpr: 1 | 2): Promise<void> {
  if (nativeContexts.has(page) || protocols.has(page)) throw new Error('Chart native context must be checked once before emulation')
  const native = await app.evaluate(({ app: main, BrowserWindow, screen }) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length !== 1) throw new Error('Chart native context requires its single source window')
    const win = windows[0]
    return { startupFactor: main.commandLine.getSwitchValue('force-device-scale-factor'), screenFactor: screen.getDisplayMatching(win.getBounds()).scaleFactor, pageZoom: win.webContents.getZoomFactor() }
  })
  const dpr = await page.evaluate<number>('devicePixelRatio')
  if (native.startupFactor !== String(sourceDpr) || native.screenFactor !== sourceDpr || native.pageZoom !== 1 || dpr !== sourceDpr) {
    throw new Error(`Chart native context differs from requested factor ${sourceDpr}: ${JSON.stringify({ ...native, dpr })}`)
  }
  nativeContexts.set(page, { ...native, dpr })
}

/** El viewport de Playwright restablece DPR=1; fijamos y comprobamos la densidad real antes del caso. */
export async function initializeChartReference(page: Page, sourceDpr: 1 | 2): Promise<void> {
  if (protocols.has(page)) throw new Error('Chart reference protocol is already initialized')
  if (nativeContexts.get(page)?.dpr !== sourceDpr) throw new Error('Verify the matching native Chart context before emulation')
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Chart reference needs an explicit viewport')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: sourceDpr, mobile: false })
  const actual = await page.evaluate<{ width: number; height: number; dpr: number }>('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})')
  if (actual.width !== viewport.width || actual.height !== viewport.height || actual.dpr !== sourceDpr) throw new Error('Chart source metrics do not match the requested viewport and DPR')
  // La página cierra la sesión. Un detach entre capturas puede restablecer la emulación de Electron.
  protocols.set(page, { session, sourceDpr, pageZoom: 1 })
}

/** Zoom de página real, después de instalar emulación equivalente al factor nativo y antes de navegar al caso. */
export async function setChartReferencePageZoom(app: ElectronApplication, page: Page, factor: number): Promise<void> {
  const protocol = protocols.get(page), native = nativeContexts.get(page)
  if (!protocol || !native || protocol.pageZoom !== 1 || !Number.isFinite(factor) || factor <= 0) throw new Error('Invalid Chart page zoom setup')
  const actual = await app.evaluate(({ BrowserWindow }, requested) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length !== 1) throw new Error('Chart page zoom requires its single source window')
    windows[0].webContents.setZoomFactor(requested)
    return windows[0].webContents.getZoomFactor()
  }, factor)
  if (actual !== factor) throw new Error('Chart page zoom differs from its requested factor')
  // En este dominio nativo/matched, Blink aplica Float32 al zoom de página y al producto de escala.
  const expectedDpr = Math.fround(native.screenFactor * Math.fround(factor))
  await expect.poll(() => page.evaluate<number>('devicePixelRatio'), { timeout: 5000, message: 'Chart page zoom must retain the matched native DPR' }).toBe(expectedDpr)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const stable = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
  if (stable !== factor || await page.evaluate<number>('devicePixelRatio') !== expectedDpr) throw new Error('Chart page zoom changed during setup')
  protocol.pageZoom = factor; protocol.sourceDpr = expectedDpr
}

export function requireContainedChartClip(clip: PixelRect, viewport: { width: number; height: number }): void {
  if (![clip.x, clip.y, clip.width, clip.height, viewport.width, viewport.height].every(Number.isFinite)
    || clip.x < 0 || clip.y < 0 || clip.width <= 0 || clip.height <= 0 || viewport.width <= 0 || viewport.height <= 0
    || clip.x + clip.width > viewport.width || clip.y + clip.height > viewport.height) throw new Error('The complete Chart reference clip must fit inside its actual viewport')
}

export interface ChartReferenceGeometryTolerance {
  screenUlp: number
  physicalPixels: number
  scale: { x: number; y: number }
  box: PixelRect
}

/** Presupuesto sólo para rectángulos observados; no para valores, fuentes, paths ni tamaños CSS. */
export function chartReferenceGeometryTolerance(before: ChartReferenceSnapshot, after: ChartReferenceSnapshot): ChartReferenceGeometryTolerance {
  let screenMagnitude = 1, logicalX = 0, logicalY = 0
  for (const snapshot of [before, after]) {
    const { box, naturalWidth, naturalHeight, scaleX, scaleY } = snapshot.body
    const dimensions = [naturalWidth, naturalHeight, scaleX, scaleY, box.width, box.height]
    if (!dimensions.every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid Chart precision dimensions')
    screenMagnitude = Math.max(screenMagnitude, snapshot.viewport.width, snapshot.viewport.height, Math.abs(box.x), Math.abs(box.y), Math.abs(box.x + box.width), Math.abs(box.y + box.height))
    logicalX = Math.max(logicalX, naturalWidth); logicalY = Math.max(logicalY, naturalHeight)
    for (const rect of [...snapshot.nodes.map(node => node.box), ...snapshot.texts.flatMap(text => text.boxes)]) {
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) throw new Error('Invalid Chart precision rectangle')
      logicalX = Math.max(logicalX, Math.abs(rect.x), Math.abs(rect.width), Math.abs(rect.x + rect.width))
      logicalY = Math.max(logicalY, Math.abs(rect.y), Math.abs(rect.height), Math.abs(rect.y + rect.height))
      screenMagnitude = Math.max(screenMagnitude, Math.abs(box.x + rect.x * scaleX), Math.abs(box.x + (rect.x + rect.width) * scaleX), Math.abs(box.y + rect.y * scaleY), Math.abs(box.y + (rect.y + rect.height) * scaleY))
    }
  }
  if (!Number.isFinite(screenMagnitude)) throw new Error('Invalid Chart screen precision')
  const screenUlp = Math.pow(2, Math.floor(Math.log2(screenMagnitude)) - 23)
  // Cada BCR resta dos extremos Float32. Al comparar dos capturas, el error máximo es dos ULP.
  const physicalPixels = 2 * screenUlp
  const sx = Math.min(before.body.scaleX, after.body.scaleX), sy = Math.min(before.body.scaleY, after.body.scaleY)
  const x = physicalPixels / sx + logicalX * physicalPixels / Math.min(before.body.box.width, after.body.box.width)
  const y = physicalPixels / sy + logicalY * physicalPixels / Math.min(before.body.box.height, after.body.box.height)
  if (Math.max(x, y, physicalPixels) >= 1 / 64) throw new Error('Chart observation precision cannot distinguish a CSS layout unit')
  // La segunda suma propaga la incertidumbre del denominador en (rect-origin)/scale.
  return { screenUlp, physicalPixels, scale: { x: physicalPixels / Math.min(before.body.naturalWidth, after.body.naturalWidth), y: physicalPixels / Math.min(before.body.naturalHeight, after.body.naturalHeight) }, box: { x, y, width: x, height: y } }
}

// El tsconfig de los E2E es Node: el código DOM se ejecuta como función autocontenida en
// la página, sin añadir lib.dom globalmente a main/engine ni depender del bundler de la app.
async function evaluateChartBody<T>(body: Locator, source: string, argument?: unknown): Promise<T> {
  const key = `__chartReference_${randomUUID()}`
  await body.evaluate((element, key) => { (globalThis as unknown as Record<string, unknown>)[key] = element }, key)
  try { return await body.page().evaluate<T>(`(${source})(globalThis[${JSON.stringify(key)}], ${JSON.stringify(argument ?? null)})`) }
  finally { await body.page().evaluate(key => { delete (globalThis as unknown as Record<string, unknown>)[key] }, key) }
}
async function evaluateChartBodyHandle<T>(body: Locator, source: string, argument?: unknown): Promise<JSHandle<T>> {
  const key = `__chartReference_${randomUUID()}`
  await body.evaluate((element, key) => { (globalThis as unknown as Record<string, unknown>)[key] = element }, key)
  try { return await body.page().evaluateHandle<T>(`(${source})(globalThis[${JSON.stringify(key)}], ${JSON.stringify(argument ?? null)})`) }
  finally { await body.page().evaluate(key => { delete (globalThis as unknown as Record<string, unknown>)[key] }, key) }
}

async function observe(body: Locator): Promise<ChartObservation> {
  return evaluateChartBody<ChartObservation>(body, `(root) => {
    if (!(root instanceof HTMLElement) || !root.isConnected)
        throw new Error('Chart reference body is unavailable');
    const css = getComputedStyle(root), origin = root.getBoundingClientRect();
    const naturalWidth = parseFloat(css.width), naturalHeight = parseFloat(css.height);
    const scaleX = origin.width / naturalWidth, scaleY = origin.height / naturalHeight;
    if (![naturalWidth, naturalHeight, scaleX, scaleY].every(n => Number.isFinite(n) && n > 0))
        throw new Error('Invalid live Chart dimensions');
    const elements = [root, ...root.querySelectorAll('*')];
    if (elements.length > 30_000)
        throw new Error('Chart reference DOM exceeds fixture limits');
    const rect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    const relative = (r) => ({ x: (r.x - origin.x) / scaleX, y: (r.y - origin.y) / scaleY, width: r.width / scaleX, height: r.height / scaleY });
    const keys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'fontVariantNumeric', 'fontFeatureSettings', 'fontOpticalSizing', 'fontVariationSettings', 'fontKerning', 'fontSizeAdjust', 'letterSpacing', 'textRendering', 'webkitFontSmoothing', 'direction', 'textAlign', 'whiteSpace', 'overflowX', 'overflowY', 'textOverflow', 'color', 'backgroundColor', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'boxShadow', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'display', 'visibility', 'opacity', 'zoom', 'transform', 'fill', 'fillOpacity', 'stroke', 'strokeOpacity', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeMiterlimit', 'strokeDasharray', 'strokeDashoffset'];
    const styles = (element) => {
        const computed = getComputedStyle(element);
        return Object.fromEntries(keys.map(key => [key, computed.getPropertyValue(key.replace(/[A-Z]/g, letter => \`-\${letter.toLowerCase()}\`).replace(/^webkit-/, '-webkit-'))]));
    };
    const paths = new Map([[root, 'body']]);
    for (const element of elements.slice(1)) {
        const parent = element.parentElement;
        paths.set(element, \`\${paths.get(parent)}/\${Array.prototype.indexOf.call(parent.children, element)}\`);
    }
    const shown = (element) => {
        for (let at = element; at; at = at.parentElement) {
            const c = getComputedStyle(at);
            if (c.display === 'none' || c.visibility !== 'visible' || Number(c.opacity) === 0)
                return false;
        }
        return true;
    };
    const clipping = ['hidden', 'clip', 'auto', 'scroll'];
    // Se aplican sólo recortes internos, incluidos SVG y truncate. El viewport/Slides exterior
    // se verifica aparte: no puede recortar silenciosamente la referencia de un PNG completo.
    const clipped = (element, r) => {
        let left = r.x, top = r.y, right = r.x + r.width, bottom = r.y + r.height;
        for (let at = element; at && at !== root; at = at.parentElement) {
            const c = getComputedStyle(at), b = at.getBoundingClientRect();
            if (clipping.includes(c.overflowX)) {
                left = Math.max(left, b.left);
                right = Math.min(right, b.right);
            }
            if (clipping.includes(c.overflowY)) {
                top = Math.max(top, b.top);
                bottom = Math.min(bottom, b.bottom);
            }
        }
        return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : undefined;
    };
    const paint = [rect(origin)];
    const labels = [];
    const texts = [];
    const addLabel = (element, boxes, text) => {
        const visible = boxes.map(box => clipped(element, box)).filter((box) => !!box);
        if (!visible.length)
            return;
        const x = Math.min(...visible.map(box => box.x)), y = Math.min(...visible.map(box => box.y));
        const right = Math.max(...visible.map(box => box.x + box.width)), bottom = Math.max(...visible.map(box => box.y + box.height));
        labels.push({ x, y, width: right - x, height: bottom - y, text: text.slice(0, 400), kind: 'text' });
    };
    const colorVisible = (value) => value !== 'none' && value !== 'transparent' && !/^rgba\\([^)]*,\\s*0\\s*\\)$/.test(value);
    const geometryTags = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text']);
    for (const element of elements) {
        if (!shown(element))
            continue;
        const c = getComputedStyle(element);
        if (element instanceof SVGGraphicsElement && geometryTags.has(element.localName)) {
            const fill = element.localName !== 'line' && colorVisible(c.fill) && Number(c.fillOpacity) > 0;
            const stroke = colorVisible(c.stroke) && Number(c.strokeOpacity) > 0 && parseFloat(c.strokeWidth) > 0;
            if (!fill && !stroke)
                continue;
            const b = element.getBBox(), matrix = element.getScreenCTM();
            if (!matrix)
                throw new Error('Live SVG reference matrix is unavailable');
            const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
            const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
            const miter = ['path', 'rect', 'polyline', 'polygon'].includes(element.localName) && c.strokeLinejoin === 'miter' ? parseFloat(c.strokeMiterlimit) : 1;
            const reach = stroke ? parseFloat(c.strokeWidth) * scale * Math.max(1, miter) / 2 : 0;
            const overhang = element.localName === 'text' && c.fontStyle === 'italic' ? parseFloat(c.fontSize) * scale / 4 : 0;
            const x = Math.min(...points.map(p => p.x)) - reach - overhang, y = Math.min(...points.map(p => p.y)) - reach;
            const extent = clipped(element, { x, y, width: Math.max(...points.map(p => p.x)) + reach + overhang - x, height: Math.max(...points.map(p => p.y)) + reach - y });
            if (extent)
                paint.push(extent);
            if (element.localName === 'text' && element.textContent?.trim()) {
                const box = rect(element.getBoundingClientRect());
                texts.push({ path: paths.get(element), kind: 'text', text: element.textContent, boxes: [relative(box)], styles: styles(element) });
                addLabel(element, [box], element.textContent);
            }
        }
        else if (element instanceof HTMLElement) {
            const b = element.getBoundingClientRect();
            const border = ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(c.getPropertyValue(\`border-\${side.toLowerCase()}-width\`)) > 0 && colorVisible(c.getPropertyValue(\`border-\${side.toLowerCase()}-color\`)));
            if (colorVisible(c.backgroundColor) || border) {
                const visible = clipped(element, rect(b));
                if (visible)
                    paint.push(visible);
            }
            if (c.boxShadow !== 'none') {
                for (const shadow of c.boxShadow.split(/,(?![^(]*\\))/)) {
                    if (shadow.includes('inset'))
                        continue;
                    const lengths = shadow.match(/-?(?:\\d*\\.)?\\d+px/g)?.map(parseFloat);
                    if (!lengths || lengths.length < 2 || lengths.length > 4)
                        throw new Error('Unsupported live Chart shadow');
                    const [dx, dy, blur = 0, spread = 0] = lengths, reach = Math.max(0, spread + blur * 1.5);
                    const x = b.left + Math.min(0, dx - reach) * scaleX, y = b.top + Math.min(0, dy - reach) * scaleY;
                    const extent = clipped(element, { x, y, width: b.right + Math.max(0, dx + reach) * scaleX - x, height: b.bottom + Math.max(0, dy + reach) * scaleY - y });
                    if (extent)
                        paint.push(extent);
                }
            }
        }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), range = document.createRange();
    try {
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement, text = node.textContent ?? '';
            if (!parent || parent.closest('svg') || !text.trim() || !shown(parent))
                continue;
            range.selectNodeContents(node);
            const raw = [...range.getClientRects()].map(rect), c = getComputedStyle(parent);
            texts.push({ path: \`\${paths.get(parent)}/text:\${Array.prototype.indexOf.call(parent.childNodes, node)}\`, kind: 'text', text, boxes: raw.map(relative), styles: styles(parent) });
            addLabel(parent, raw, text);
            const overhang = c.fontStyle === 'italic' ? parseFloat(c.fontSize) * scaleX / 4 : 0;
            for (const box of raw) {
                const visible = clipped(parent, { x: box.x - overhang, y: box.y, width: box.width + overhang * 2, height: box.height });
                if (visible)
                    paint.push(visible);
            }
        }
    }
    finally {
        range.detach();
    }
    const x = Math.min(...paint.map(box => box.x)), y = Math.min(...paint.map(box => box.y));
    const right = Math.max(...paint.map(box => box.x + box.width)), bottom = Math.max(...paint.map(box => box.y + box.height));
    const figure = root.closest('figure');
    if (!figure)
        throw new Error('Chart reference requires its live Figure');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!context)
        throw new Error('Chart paper probe is unavailable');
    context.fillStyle = getComputedStyle(figure).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const rgba = [...context.getImageData(0, 0, 1, 1).data];
    canvas.width = canvas.height = 0;
    if (rgba[3] !== 255)
        throw new Error('Chart reference paper must be opaque');
    const outerClips = [];
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
        const c = getComputedStyle(parent), x = clipping.includes(c.overflowX), y = clipping.includes(c.overflowY);
        if (x || y)
            outerClips.push({ tag: parent.tagName, x, y, box: rect(parent.getBoundingClientRect()) });
    }
    return {
        snapshot: {
            body: { box: rect(origin), naturalWidth, naturalHeight, scaleX, scaleY, styles: styles(root) },
            viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, devicePixelRatio },
            nodes: elements.slice(1).map(element => ({ path: paths.get(element), tag: element.tagName, box: relative(element.getBoundingClientRect()), styles: styles(element), attributes: element instanceof SVGElement ? Object.fromEntries(['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'x2', 'y1', 'y2', 'dx', 'dy', 'points', 'viewBox'].filter(name => element.hasAttribute(name)).map(name => [name, element.getAttribute(name)])) : {} })),
            texts
        },
        ink: { x, y, width: right - x, height: bottom - y }, labels, background: rgba.slice(0, 3), outerClips
    };
}`)
}

export async function snapshotChartReference(body: Locator): Promise<ChartReferenceSnapshot> { return (await observe(body)).snapshot }

/** Sólo se omite el origen externo. Texto, atributos SVG, estilos y geometría relativa deben conservarse. */
export function assertChartReferenceInvariant(before: ChartReferenceSnapshot, after: ChartReferenceSnapshot): void {
  const precision = chartReferenceGeometryTolerance(before, after)
  const comparable = (snapshot: ChartReferenceSnapshot) => ({ ...snapshot, body: { ...snapshot.body, box: { ...snapshot.body.box, x: 0, y: 0 } } })
  const tolerance = (path: string): number => {
    if (/^snapshot\.body\.box\.(width|height)$/.test(path)) return precision.physicalPixels
    if (path === 'snapshot.body.scaleX') return precision.scale.x
    if (path === 'snapshot.body.scaleY') return precision.scale.y
    const field = /^snapshot\.(?:nodes\.\d+\.box|texts\.\d+\.boxes\.\d+)\.(x|y|width|height)$/.exec(path)?.[1] as keyof PixelRect | undefined
    return field ? precision.box[field] : INVARIANT_TOLERANCE
  }
  const compare = (a: unknown, b: unknown, path: string): void => {
    if (typeof a === 'number' && typeof b === 'number') {
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tolerance(path)) throw new Error(`Chart reference changed ${path}: ${a} -> ${b}`)
      return
    }
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { if (a !== b) throw new Error(`Chart reference changed ${path}: ${String(a)} -> ${String(b)}`); return }
    const left = Object.keys(a), right = Object.keys(b)
    if (left.length !== right.length || left.some((key, i) => key !== right[i])) throw new Error(`Chart reference changed structure at ${path}`)
    for (const key of left) compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`)
  }
  compare(comparable(before), comparable(after), 'snapshot')
}

/** La captura, a diferencia de la colocación previa, tampoco puede mover el origen absoluto. */
export function assertChartCaptureInvariant(before: ChartReferenceSnapshot, after: ChartReferenceSnapshot): void {
  assertChartReferenceInvariant(before, after)
  for (const axis of ['x', 'y'] as const) {
    if (Math.abs(before.body.box[axis] - after.body.box[axis]) > INVARIANT_TOLERANCE) throw new Error(`Chart capture changed absolute body.${axis}`)
  }
}

/** Una traslación global de layout; no usa transform, zoom, redondeos de hojas ni cambios de fuente. */
export async function canonicalizeChartReference(body: Locator): Promise<ChartReferencePlacement> {
  if (placements.has(body)) throw new Error('Chart reference placement is already active')
  const before = await snapshotChartReference(body), target = { x: Math.floor(before.body.box.x), y: Math.floor(before.body.box.y) }
  const lease = await evaluateChartBodyHandle<{ restore(): void; placement: ChartPlacementObservation }>(body, `(root, target) => {
    if (!(root instanceof HTMLElement))
        throw new Error('Chart placement requires an HTML body');
    const css = getComputedStyle(root);
    if (!['static', 'relative'].includes(css.position) || css.right !== 'auto' || css.bottom !== 'auto')
        throw new Error('Unsupported Chart reference placement');
    const saved = ['position', 'left', 'top'].map(name => ({ name, value: root.style.getPropertyValue(name), priority: root.style.getPropertyPriority(name) }));
    let active = true;
    const restore = () => { if (!active)
        return; active = false; for (const { name, value, priority } of saved)
        value ? root.style.setProperty(name, value, priority) : root.style.removeProperty(name); };
    try {
        let left = css.position === 'relative' ? parseFloat(css.left) || 0 : 0, top = css.position === 'relative' ? parseFloat(css.top) || 0 : 0;
        const quantum = { x: 0, y: 0 };
        const result = () => { const b = root.getBoundingClientRect(); return { restore, placement: { target, quantum, residual: { x: b.x - target.x, y: b.y - target.y }, method: quantum.x || quantum.y ? 'observed-css-grid' : 'exact' } }; };
        root.style.setProperty('position', 'relative', 'important');
        for (let attempt = 0; attempt < 4; attempt++) {
            const box = root.getBoundingClientRect(), c = getComputedStyle(root), sx = box.width / parseFloat(c.width), sy = box.height / parseFloat(c.height);
            if (![sx, sy].every(n => Number.isFinite(n) && n > 0))
                throw new Error('Invalid Chart placement scale');
            if (Math.abs(box.x - target.x) <= 1e-6 && Math.abs(box.y - target.y) <= 1e-6)
                return result();
            left += (target.x - box.x) / sx;
            top += (target.y - box.y) / sy;
            root.style.setProperty('left', \`\${left}px\`, 'important');
            root.style.setProperty('top', \`\${top}px\`, 'important');
        }
        // CSS zoom y el scale externo pueden hacer inalcanzable un origen entero.
        // Buscamos los dos niveles de layout observados que rodean el objetivo.
        for (const [property, axis, initial] of [['left', 'x', left], ['top', 'y', top]]) {
            if (Math.abs(root.getBoundingClientRect()[axis] - target[axis]) <= 1e-6) continue;
            const sample = requested => {
                root.style.setProperty(property, requested + 'px', 'important');
                const position = root.getBoundingClientRect()[axis];
                if (!Number.isFinite(position)) throw new Error('Invalid Chart placement observation');
                return { requested, position };
            };
            let lower, upper, exact;
            for (let expansion = 0; expansion < 6 && (!lower || !upper); expansion++) {
                const step = Math.pow(2, expansion) / 4096;
                for (let n = -128; n <= 128; n++) {
                    const current = sample(initial + n * step);
                    if (Math.abs(current.position - target[axis]) <= 1e-6) { exact = current; break; }
                    if (current.position < target[axis] && (!lower || current.position > lower.position)) lower = current;
                    if (current.position > target[axis] && (!upper || current.position < upper.position)) upper = current;
                }
                if (exact) break;
            }
            if (exact) { sample(exact.requested); continue; }
            if (!lower || !upper || lower.requested >= upper.requested) throw new Error('Chart placement grid does not bracket the pixel origin');
            // Refinamiento de la frontera: no presupone un quantum fijo de CSS ni redondea hojas.
            for (let n = 0; n < 32; n++) {
                const requested = (lower.requested + upper.requested) / 2;
                if (requested === lower.requested || requested === upper.requested) break;
                const current = sample(requested);
                if (current.position < lower.position || current.position > upper.position) throw new Error('Chart placement is not monotonic');
                if (Math.abs(current.position - target[axis]) <= 1e-6) { exact = current; break; }
                if (current.position < target[axis]) lower = current; else upper = current;
            }
            if (exact) { sample(exact.requested); continue; }
            quantum[axis] = upper.position - lower.position;
            const best = target[axis] - lower.position <= upper.position - target[axis] ? lower : upper;
            sample(best.requested);
        }
        return result();
    }
    catch (error) {
        restore();
        throw error;
    }
}`, target)
  let restored = false
  const restore = async (): Promise<void> => {
    if (restored) return
    restored = true
    placements.delete(body)
    try { await lease.evaluate(state => state.restore()) } finally { await lease.dispose() }
  }
  try {
    await body.page().evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const after = await snapshotChartReference(body)
    assertChartReferenceInvariant(before, after)
    const placement = await lease.evaluate(state => state.placement)
    const precision = chartReferenceGeometryTolerance(before, after)
    for (const axis of ['x', 'y'] as const) {
      const residual = after.body.box[axis] - target[axis]
      if (Math.abs(residual - placement.residual[axis]) > precision.physicalPixels || Math.abs(residual) > placement.quantum[axis] / 2 + precision.screenUlp) throw new Error('Chart placement moved outside its observed grid')
      placement.residual[axis] = residual
    }
    placements.set(body, placement)
    return { before, after, ...placement, displacement: { x: after.body.box.x - before.body.box.x, y: after.body.box.y - before.body.box.y }, restore }
  } catch (error) { await restore(); throw error }
}

/** Captura completa con bordes DIP enteros; no oculta overflow ni usa el encuadre del exportador. */
export async function captureChartReference(body: Locator, info?: TestInfo, name = 'chart'): Promise<ChartReference> {
  const protocol = protocols.get(body.page())
  if (!protocol) throw new Error('Initialize the Chart reference protocol before capturing')
  const nativeContext = nativeContexts.get(body.page())
  if (!nativeContext) throw new Error('Chart native context is unavailable')
  const captureViewport = async (): Promise<ChartCaptureViewport> => {
    const { cssVisualViewport: value } = await protocol.session.send('Page.getLayoutMetrics')
    if (!value || typeof value.zoom !== 'number') throw new Error('Chart capture requires CSS visual viewport zoom metrics')
    const viewport: ChartCaptureViewport = {
      zoom: value.zoom, scale: value.scale, offsetX: value.offsetX, offsetY: value.offsetY,
      pageX: value.pageX, pageY: value.pageY, clientWidth: value.clientWidth, clientHeight: value.clientHeight
    }
    if (!Object.values(viewport).every(Number.isFinite) || viewport.zoom <= 0
      || viewport.zoom !== Math.fround(protocol.sourceDpr / nativeContext.screenFactor)
      || viewport.scale !== 1 || viewport.offsetX !== 0 || viewport.offsetY !== 0) throw new Error('Unsupported Chart CSS-to-DIP capture viewport')
    return viewport
  }
  const observation = await observe(body), { snapshot, ink, background } = observation
  if (snapshot.viewport.devicePixelRatio !== protocol.sourceDpr) throw new Error('Chart source DPR changed before capture')
  const initialViewport = await captureViewport()
  if (initialViewport.pageX !== snapshot.viewport.scrollX || initialViewport.pageY !== snapshot.viewport.scrollY) throw new Error('Chart capture scroll coordinates disagree')
  const geometryTolerance = chartReferenceGeometryTolerance(snapshot, snapshot)
  const placement = placements.get(body) ?? { target: { x: Math.round(snapshot.body.box.x), y: Math.round(snapshot.body.box.y) }, quantum: { x: 0, y: 0 }, residual: { x: 0, y: 0 }, method: 'exact' as const }
  for (const axis of ['x', 'y'] as const) {
    const residual = snapshot.body.box[axis] - placement.target[axis]
    if (Math.abs(residual - placement.residual[axis]) > geometryTolerance.physicalPixels || Math.abs(residual) > placement.quantum[axis] / 2 + geometryTolerance.screenUlp) throw new Error('Canonicalize the global Chart origin before capturing its reference')
  }
  if (Math.abs(snapshot.body.scaleX - snapshot.body.scaleY) > INVARIANT_TOLERANCE) {
    // CSSOM serializa estas longitudes con seis cifras significativas; no es una escala anisótropa.
    const serializedHalfStep = (n: number): number => Math.pow(10, Math.floor(Math.log10(n)) - 5) / 2
    const uncertainty = geometryTolerance.scale.x + geometryTolerance.scale.y + snapshot.body.scaleX * serializedHalfStep(snapshot.body.naturalWidth) / snapshot.body.naturalWidth + snapshot.body.scaleY * serializedHalfStep(snapshot.body.naturalHeight) / snapshot.body.naturalHeight
    const uniform = await evaluateChartBody<boolean>(body, `(root)=>{for(let n=root;n;n=n.parentElement){const c=getComputedStyle(n);if(c.rotate!=='none'||c.scale!=='none')return false;if(c.transform==='none')continue;const m=new DOMMatrixReadOnly(c.transform);if(!m.is2D||m.b||m.c||m.a!==m.d||m.a<=0)return false;}return true;}`)
    if (!uniform || Math.abs(snapshot.body.scaleX - snapshot.body.scaleY) > uncertainty) throw new Error('Chart pixel oracle requires uniform observed scale')
  }
  // El matcher omite seis píxeles del borde: ocho dejan toda la tinta observada dentro
  // de la zona auditada, también los extremos de trazo y el halo conservador de sombra.
  const cssClip = { x: Math.floor(ink.x - 8), y: Math.floor(ink.y - 8), width: Math.ceil(ink.x + ink.width + 8) - Math.floor(ink.x - 8), height: Math.ceil(ink.y + ink.height + 8) - Math.floor(ink.y - 8) }
  // Chromium trunca el tamaño DIP a entero antes de aplicar clip.scale. Expandimos
  // hacia fuera una sola vez y conservamos esos enteros en ambas capturas.
  const dipLeft = Math.floor((cssClip.x + initialViewport.pageX) * initialViewport.zoom)
  const dipTop = Math.floor((cssClip.y + initialViewport.pageY) * initialViewport.zoom)
  const dipClip = {
    x: dipLeft, y: dipTop,
    width: Math.ceil((cssClip.x + cssClip.width + initialViewport.pageX) * initialViewport.zoom) - dipLeft,
    height: Math.ceil((cssClip.y + cssClip.height + initialViewport.pageY) * initialViewport.zoom) - dipTop
  }
  const clip = {
    x: dipClip.x / initialViewport.zoom - initialViewport.pageX,
    y: dipClip.y / initialViewport.zoom - initialViewport.pageY,
    width: dipClip.width / initialViewport.zoom, height: dipClip.height / initialViewport.zoom
  }
  requireContainedChartClip(clip, snapshot.viewport)
  requireContainedChartClip(clip, { width: initialViewport.clientWidth, height: initialViewport.clientHeight })
  for (const outer of observation.outerClips) {
    if (outer.x && (ink.x < outer.box.x - 1e-6 || ink.x + ink.width > outer.box.x + outer.box.width + 1e-6) || outer.y && (ink.y < outer.box.y - 1e-6 || ink.y + ink.height > outer.box.y + outer.box.height + 1e-6)) throw new Error(`Chart reference ink is clipped by external ${outer.tag}`)
  }
  const isolation = await evaluateChartBodyHandle<{ restore(): void; metadata: ChartReference['metadata']['isolation'] }>(body, `(root, { clip, background }) => {
    if (!(root instanceof HTMLElement))
        throw new Error('Chart reference body is unavailable');
    const figure = root.closest('figure');
    if (!figure)
        throw new Error('Chart reference requires its Figure');
    const saved = [];
    const hidden = [];
    let matte, active = true;
    const restore = () => { if (!active)
        return; active = false; matte?.remove(); for (const { element, value, priority } of saved)
        value ? element.style.setProperty('visibility', value, priority) : element.style.removeProperty('visibility'); };
    try {
        for (let branch = root; branch !== figure;) {
            const parent = branch.parentElement;
            if (!parent)
                throw new Error('Chart Figure ancestry changed');
            for (const sibling of parent.children) {
                if (sibling === branch || !(sibling instanceof HTMLElement || sibling instanceof SVGElement))
                    continue;
                saved.push({ element: sibling, value: sibling.style.getPropertyValue('visibility'), priority: sibling.style.getPropertyPriority('visibility') });
                hidden.push({ tag: sibling.tagName, className: sibling.getAttribute('class') ?? '' });
                sibling.style.setProperty('visibility', 'hidden', 'important');
            }
            branch = parent;
        }
        const c = getComputedStyle(figure), box = figure.getBoundingClientRect(), sx = box.width / parseFloat(c.width), sy = box.height / parseFloat(c.height);
        if (c.position !== 'relative' || ![sx, sy].every(n => Number.isFinite(n) && n > 0))
            throw new Error('Unsupported Figure paper placement');
        matte = document.createElement('div');
        matte.setAttribute('aria-hidden', 'true');
        // Dos píxeles externos de margen evitan una rendija por cuantización CSS del matte.
        Object.assign(matte.style, { position: 'absolute', pointerEvents: 'none', zIndex: '0', margin: '0', padding: '0', border: '0', boxShadow: 'none', borderRadius: '0', background: \`rgb(\${background.join(',')})\`, left: \`\${(clip.x - box.x - 2) / sx - parseFloat(c.borderLeftWidth)}px\`, top: \`\${(clip.y - box.y - 2) / sy - parseFloat(c.borderTopWidth)}px\`, width: \`\${(clip.width + 4) / sx}px\`, height: \`\${(clip.height + 4) / sy}px\` });
        figure.prepend(matte);
        const painted = matte.getBoundingClientRect();
        return { restore, metadata: { matte: { x: painted.x, y: painted.y, width: painted.width, height: painted.height }, hidden, maskedInk: false } };
    }
    catch (error) {
        restore();
        throw error;
    }
}`, { clip, background })
  try {
    await body.page().evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assertChartCaptureInvariant(snapshot, await snapshotChartReference(body))
    const observations: ChartReference['metadata']['capture']['observations'] = []
    const capture = async (scale: number, stage: string): Promise<Buffer> => {
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid Chart reference capture scale')
      const before = await snapshotChartReference(body)
      assertChartCaptureInvariant(snapshot, before)
      requireContainedChartClip(clip, before.viewport)
      const viewportBefore = await captureViewport()
      if (JSON.stringify(viewportBefore) !== JSON.stringify(initialViewport)) throw new Error('Chart CSS visual viewport changed before capture')
      requireContainedChartClip(clip, { width: viewportBefore.clientWidth, height: viewportBefore.clientHeight })
      if (viewportBefore.pageX !== before.viewport.scrollX || viewportBefore.pageY !== before.viewport.scrollY) throw new Error('Chart capture scroll coordinates disagree')
      // Page.captureScreenshot recibe DIP; las cajas DOM y el oráculo permanecen en CSS px.
      const requestedDipClip = { ...dipClip, scale }
      // El clip completo cabe en el viewport: no permitimos el resize temporal de beyondViewport.
      const response = await protocol.session.send('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
        clip: requestedDipClip
      })
      const bytes = Buffer.from(response.data, 'base64'), viewportAfter = await captureViewport(), after = await snapshotChartReference(body)
      observations.push({ stage, before, after, viewportBefore, viewportAfter, requestedDipClip })
      if (info) {
        writeFileSync(info.outputPath(`${name}-${stage}.png`), bytes)
        writeFileSync(info.outputPath(`${name}-capture-observations.json`), JSON.stringify(observations, null, 2))
      }
      if (JSON.stringify(viewportBefore) !== JSON.stringify(viewportAfter)) throw new Error('Chart capture changed its CSS visual viewport')
      assertChartCaptureInvariant(before, after)
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Chart reference capture returned an invalid PNG')
      return bytes
    }
    // La densidad se mide en los píxeles recibidos, nunca se deduce sólo del DPR solicitado.
    const calibrated = await capture(1, 'live-calibration')
    const calibrationWidth = calibrated.readUInt32BE(16), calibrationHeight = calibrated.readUInt32BE(20)
    const pixelsPerCss = calibrationWidth / clip.width, verticalPixelsPerCss = calibrationHeight / clip.height
    if (![pixelsPerCss, verticalPixelsPerCss].every(n => Number.isFinite(n) && n > 0)
      || Math.abs(pixelsPerCss - verticalPixelsPerCss) > 1 / clip.width + 1 / clip.height) throw new Error('Chart reference density calibration is not uniform')
    const desiredPixelsPerCss = 2 / snapshot.body.scaleX, requestedScale = desiredPixelsPerCss / pixelsPerCss
    const png = await capture(requestedScale, 'live')
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
    if (Math.abs(width - clip.width * desiredPixelsPerCss) > 1 || Math.abs(height - clip.height * desiredPixelsPerCss) > 1) throw new Error('Chart reference raster does not match its calibrated density')
    const geometry: LiveDiagramGeometry = {
      width: clip.width, height: clip.height,
      canvas: { x: snapshot.body.box.x - clip.x, y: snapshot.body.box.y - clip.y, width: snapshot.body.box.width, height: snapshot.body.box.height, naturalWidth: snapshot.body.naturalWidth, naturalHeight: snapshot.body.naturalHeight, scale: snapshot.body.scaleX },
      background, exclusions: [], labels: observation.labels.map(label => ({ ...label, x: label.x - clip.x, y: label.y - clip.y }))
    }
    const metadata: ChartReference['metadata'] = {
      clip, ink, canvasOffset: { x: geometry.canvas.x, y: geometry.canvas.y }, isolation: await isolation.evaluate(state => state.metadata),
      capture: { api: 'Page.captureScreenshot', sourceDpr: protocol.sourceDpr, raster: 'dense', nativeContext, pageZoom: protocol.pageZoom, width, height, calibration: { width: calibrationWidth, height: calibrationHeight, pixelsPerCss }, requestedScale, desiredPixelsPerCss, observations },
      invariantTolerance: INVARIANT_TOLERANCE, geometryTolerance, placement
    }
    if (info) {
      const imagePath = info.outputPath(`${name}-live.png`), dataPath = info.outputPath(`${name}-live-dom.json`)
      writeFileSync(imagePath, png); writeFileSync(dataPath, JSON.stringify({ geometry, metadata, snapshot }, null, 2))
      await info.attach(`${name}-live.png`, { path: imagePath, contentType: 'image/png' }); await info.attach(`${name}-live-dom.json`, { path: dataPath, contentType: 'application/json' })
    }
    return { png, geometry, clip, snapshot, metadata }
  } finally {
    try { await isolation.evaluate(state => state.restore()) } finally { await isolation.dispose() }
    assertChartCaptureInvariant(snapshot, await snapshotChartReference(body))
  }
}

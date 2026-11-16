// Referencia viva independiente: ningún DTO, bounds ni texto del renderer de exportación.
import { expect, type CDPSession, type Locator, type Page, type TestInfo } from 'playwright/test'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import type { LiveDiagramGeometry } from './diagram-pixels'

/** Referencia DOM independiente: no consulta escenas, datos IPC, bounds ni helpers del exportador. */
export async function evaluateLiveElement<R>(target: Locator, expression: string): Promise<R> {
  const key = `__aulaDiagramOracle_${randomUUID()}`
  // Una callback real entrega el elemento; evaluate(string) no invoca por sí mismo una arrow function.
  await target.evaluate((element, key) => { (globalThis as unknown as Record<string, unknown>)[key] = element }, key)
  try { return await target.page().evaluate<R>(`(${expression})(globalThis[${JSON.stringify(key)}])`) }
  finally { await target.page().evaluate(key => { delete (globalThis as unknown as Record<string, unknown>)[key] }, key) }
}
export async function liveGeometry(figure: Locator, expectedEmpty = false): Promise<LiveDiagramGeometry> {
  const geometry = await evaluateLiveElement<LiveDiagramGeometry>(figure.locator('.viz-dots'), `viewport => {
    const box = viewport.getBoundingClientRect(), canvas = viewport.querySelector('[data-diagram-canvas]');
    if (!canvas) throw new Error('The live Diagram canvas is unavailable');
    const canvasBox = canvas.getBoundingClientRect(), canvasStyle = getComputedStyle(canvas);
    const naturalWidth = parseFloat(canvasStyle.width), naturalHeight = parseFloat(canvasStyle.height);
    const scale = canvasBox.width / naturalWidth;
    if (!Number.isFinite(scale) || scale <= 0 || Math.abs(canvasBox.height / naturalHeight - scale) > 0.001) throw new Error('The live canvas does not have one uniform scale');
    const visible = element => {
      for (let parent = element; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0 || parent.classList.contains('katex-mathml')) return false;
      }
      return true;
    };
    const clipped = (element, raw) => {
      if (!visible(element)) return undefined;
      let left = Math.max(box.left, raw.left), top = Math.max(box.top, raw.top), right = Math.min(box.right, raw.right), bottom = Math.min(box.bottom, raw.bottom);
      for (let parent = element; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
      }
      return right > left && bottom > top ? { x: left - box.left, y: top - box.top, width: right - left, height: bottom - top } : undefined;
    };
    const labels = [];
    for (const element of canvas.querySelectorAll('.aula-rich-inline, .katex-html')) {
      if (!visible(element)) continue;
      const kind = element.classList.contains('katex-html') ? 'math' : 'text', text = (element.textContent || '').trim().slice(0, 400);
      if (!text) continue;
      const rects = Array.from(element.getClientRects()).map(raw => clipped(element, raw)).filter(Boolean);
      if (kind === 'math') {
        // Cada fórmula conserva su ROI propio, separado del párrafo que la contiene.
        for (const rect of rects) labels.push({ ...rect, text, kind });
      } else if (rects.length) {
        // Un mismo span puede emitir fragmentos por línea, negrita o el punto final. Su texto
        // visible es una sola etiqueta: unir tras recortar conserva wrap/clamp sin exigir tinta
        // suficiente a un fragmento arbitrario. No se agrupan elementos aunque repitan el texto.
        const left = Math.min(...rects.map(rect => rect.x)), top = Math.min(...rects.map(rect => rect.y));
        const right = Math.max(...rects.map(rect => rect.x + rect.width)), bottom = Math.max(...rects.map(rect => rect.y + rect.height));
        labels.push({ x: left, y: top, width: right - left, height: bottom - top, text, kind });
      }
    }
    const exclusions = [];
    for (const button of document.querySelectorAll('button, [role="button"]')) {
      const rect = clipped(button, button.getBoundingClientRect());
      if (rect) exclusions.push({ ...rect, kind: 'button', label: button.getAttribute('aria-label') || button.textContent || button.className });
    }
    // El aviso de pan es UI real del viewport, hermano del lienzo; nunca excluye contenido del lienzo.
    for (const child of viewport.children) {
      if (child === canvas || child.contains(canvas) || child.matches('button, [role="button"]') || child.querySelector('button, [role="button"]')) continue;
      if (!child.classList.contains('pointer-events-none') || !(child.textContent || '').trim()) continue;
      const rect = clipped(child, child.getBoundingClientRect());
      if (rect) exclusions.push({ ...rect, kind: 'hint', label: (child.textContent || '').trim() });
    }
    const probe = document.createElement('canvas'); probe.width = probe.height = 1;
    const context = probe.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!context) throw new Error('The live background probe is unavailable');
    context.fillStyle = getComputedStyle(viewport).backgroundColor; context.fillRect(0, 0, 1, 1);
    const rgba = Array.from(context.getImageData(0, 0, 1, 1).data); probe.width = probe.height = 0;
    if (rgba[3] !== 255) throw new Error('The live viewport background must be opaque');
    return { width: box.width, height: box.height, canvas: { x: canvasBox.x - box.x, y: canvasBox.y - box.y, width: canvasBox.width, height: canvasBox.height, naturalWidth, naturalHeight, scale }, background: rgba.slice(0, 3), exclusions, labels };
  }`)
  return { ...geometry, expectedEmpty }
}


interface SourceProtocol { session: CDPSession; baselineDpr: number; nativeDpr: number }
interface SourceSnapshot {
  dom: {
    dpr: number; viewport: { width: number; height: number }; absoluteViewport: unknown
    scrollAncestors: unknown; windowScroll: unknown; visualViewport: unknown
    bodyStyle: string | null; canvasTransform: string; fonts: unknown; ranges: unknown; fractions: unknown
  }
  geometry: LiveDiagramGeometry
}
const protocols = new WeakMap<Page, SourceProtocol>()

/** Una sesión por página: desconectarla entre capturas puede restablecer el DPR nativo de Electron. */
export async function initializeDiagramReference(page: Page, nativeDpr: number): Promise<void> {
  if (protocols.has(page)) throw new Error('Diagram reference protocol is already initialized')
  const baselineDpr = await page.evaluate<number>('devicePixelRatio')
  if (![baselineDpr, nativeDpr].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid Diagram reference DPR')
  protocols.set(page, { session: await page.context().newCDPSession(page), baselineDpr, nativeDpr })
  // La página/app cierran la sesión; no se hace detach mientras pueda haber otra captura.
}

async function sourceSnapshot(figure: Locator, expectedEmpty: boolean): Promise<SourceSnapshot> {
  const dom = await evaluateLiveElement<SourceSnapshot['dom']>(figure.locator('.viz-dots'), `viewport => {
    const origin=viewport.getBoundingClientRect(),canvas=viewport.querySelector('[data-diagram-canvas]');
    if(!canvas)throw new Error('The live Diagram canvas is unavailable');
    const relative=r=>({x:r.x-origin.x,y:r.y-origin.y,width:r.width,height:r.height});
    const fonts=[...canvas.querySelectorAll('.aula-rich-inline,.katex-html')].map(n=>{const c=getComputedStyle(n);return{text:n.textContent,rects:[...n.getClientRects()].map(relative),fontFamily:c.fontFamily,fontSize:c.fontSize,fontWeight:c.fontWeight,lineHeight:c.lineHeight,color:c.color}});
    const ranges=[],walker=document.createTreeWalker(canvas,NodeFilter.SHOW_TEXT),range=document.createRange();
    for(let n=walker.nextNode();n;n=walker.nextNode()){if(!n.textContent?.trim()||n.parentElement?.closest('.katex-mathml'))continue;range.selectNodeContents(n);ranges.push({text:n.textContent,rects:[...range.getClientRects()].map(relative)})}range.detach();
    const fractions=[...canvas.querySelectorAll('.katex .frac-line')].map(n=>{const c=getComputedStyle(n);return{rect:relative(n.getBoundingClientRect()),borderBottomWidth:c.borderBottomWidth,minHeight:c.minHeight,fontSize:c.fontSize}});
    const scrollAncestors=[];
    for(let node=viewport;node;node=node.parentElement){const css=getComputedStyle(node);scrollAncestors.push({tag:node.tagName,overflowX:css.overflowX,overflowY:css.overflowY,scrollLeft:node.scrollLeft,scrollTop:node.scrollTop,scrollWidth:node.scrollWidth,scrollHeight:node.scrollHeight,clientWidth:node.clientWidth,clientHeight:node.clientHeight})}
    return{dpr:devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},absoluteViewport:origin.toJSON(),scrollAncestors,windowScroll:{x:scrollX,y:scrollY},visualViewport:visualViewport?{width:visualViewport.width,height:visualViewport.height,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop,pageLeft:visualViewport.pageLeft,pageTop:visualViewport.pageTop,scale:visualViewport.scale}:null,bodyStyle:document.body.getAttribute('style'),canvasTransform:getComputedStyle(canvas).transform,fonts,ranges,fractions};
  }`)
  return { dom, geometry: await liveGeometry(figure, expectedEmpty) }
}

/** Mismo contrato numérico de V6; una comparación pura evita miles de pasos de Playwright por snapshot. */
export function diagramReferenceDifference(reference: unknown, candidate: unknown, path = 'independent'): string | undefined {
  if (typeof reference === 'number' && typeof candidate === 'number') {
    return Math.abs(reference - candidate) <= .001 ? undefined : `${path}: numeric difference`
  }
  if (Array.isArray(reference)) {
    if (!Array.isArray(candidate)) return `${path}: expected array`
    if (candidate.length !== reference.length) return `${path}.length`
    for (let index = 0; index < reference.length; index++) {
      const difference = diagramReferenceDifference(reference[index], candidate[index], `${path}[${index}]`)
      if (difference) return difference
    }
    return
  }
  if (reference && typeof reference === 'object') {
    if (candidate === null || typeof candidate !== 'object') return `${path}: expected object`
    const keys = Object.keys(reference), actualKeys = Object.keys(candidate)
    if (keys.length !== actualKeys.length || keys.some((key, index) => key !== actualKeys[index])) return `${path}.keys`
    for (const [key, value] of Object.entries(reference)) {
      const difference = diagramReferenceDifference(value, (candidate as Record<string, unknown>)[key], `${path}.${key}`)
      if (difference) return difference
    }
    return
  }
  return Object.is(candidate, reference) ? undefined : `${path}: literal difference`
}
export function invariantFields(snapshot: SourceSnapshot, includeDpr = true): unknown {
  const { dpr, viewport, absoluteViewport, scrollAncestors, windowScroll, visualViewport, canvasTransform, fonts, ranges, fractions } = snapshot.dom
  return { ...(includeDpr ? { dpr } : {}), viewport, absoluteViewport, scrollAncestors, windowScroll, visualViewport, canvasTransform, fonts, ranges, fractions, geometry: snapshot.geometry }
}

/** El clip original debe caber en el viewport real; no se desplaza ni se recorta para capturarlo. */
export function requireContainedDiagramClip(clip: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): void {
  if (![clip.x, clip.y, clip.width, clip.height, viewport.width, viewport.height].every(Number.isFinite)
    || clip.x < 0 || clip.y < 0 || clip.width <= 0 || clip.height <= 0 || viewport.width <= 0 || viewport.height <= 0
    || clip.x + clip.width > viewport.width || clip.y + clip.height > viewport.height) {
    throw new Error('The original Diagram clip must fit entirely inside the actual viewport')
  }
}

/** Calibra la densidad con píxeles devueltos por CDP, sin inferirla del DPR declarado. */
export async function captureDiagramReference(page: Page, figure: Locator, info: TestInfo, name: string, options: { expectedEmpty?: boolean; phases?: unknown } = {}): Promise<{ png: Buffer; geometry: LiveDiagramGeometry }> {
  const protocol = protocols.get(page)
  if (!protocol) throw new Error('Initialize the Diagram reference protocol before capturing')
  const { session, baselineDpr, nativeDpr } = protocol, expectedEmpty = options.expectedEmpty ?? false
  const initial = await sourceSnapshot(figure, expectedEmpty)
  // El viewport real puede ser estrecho (800) o ancho (1440); nunca se impone el del diagnóstico V6.
  const metrics = { ...initial.dom.viewport, deviceScaleFactor: baselineDpr, mobile: false }
  const restoreMetrics = async (): Promise<void> => {
    await session.send('Emulation.setDeviceMetricsOverride', metrics)
    await page.evaluate('document.fonts.ready')
    await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  }
  await restoreMetrics()
  const settled = await sourceSnapshot(figure, expectedEmpty)
  expect(diagramReferenceDifference(invariantFields(initial), invariantFields(settled)), `${name}: initial device protocol`).toBeUndefined()
  const { geometry } = settled, clip = await figure.locator('.viz-dots').boundingBox()
  if (!clip) throw new Error('Source Diagram viewport is unavailable')
  const records: unknown[] = []
  const metadataPath = info.outputPath(`${name}-live-dom.json`)
  const metadata = (): void => writeFileSync(metadataPath, JSON.stringify({ geometry, phases: options.phases, metrics, nativeDpr, initial, settled, clip, captures: records }, null, 2))
  const capture = async (scale: number, label: string): Promise<Buffer> => {
    const before = await sourceSnapshot(figure, expectedEmpty)
    let bytes: Buffer | undefined, afterCapture: SourceSnapshot | undefined, failure: unknown
    try {
      requireContainedDiagramClip(clip, before.dom.viewport)
      // Evita el viewport temporal 1×1 de captureBeyondViewport, que puede activar reflow y ResizeObserver.
      const response = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { ...clip, scale } })
      bytes = Buffer.from(response.data, 'base64')
      writeFileSync(info.outputPath(`${name}-${label}.png`), bytes)
      afterCapture = await sourceSnapshot(figure, expectedEmpty)
    } catch (error) { failure = error }
    finally { await restoreMetrics() }
    const restored = await sourceSnapshot(figure, expectedEmpty)
    records.push({ label, scale, before, afterCapture, restored, image: bytes ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null, failure: failure === undefined ? null : String(failure) })
    metadata()
    const differences = [
      diagramReferenceDifference(invariantFields(settled), invariantFields(before), 'before'),
      afterCapture && diagramReferenceDifference(invariantFields(before, false), invariantFields(afterCapture, false), 'captured-content'),
      afterCapture && ![baselineDpr, nativeDpr].includes(afterCapture.dom.dpr) ? 'Unexpected captured DPR' : undefined,
      diagramReferenceDifference(invariantFields(before), invariantFields(restored), 'restored')
    ].filter(Boolean)
    expect(differences, `${name}.${label}: source remains unchanged`).toEqual([])
    if (failure !== undefined) throw failure
    if (!bytes) throw new Error('Diagram screenshot returned no pixels')
    await info.attach(`${name}-${label}.png`, { path: info.outputPath(`${name}-${label}.png`), contentType: 'image/png' })
    return bytes
  }
  try {
    const calibration = await capture(1, 'live-calibration')
    const observedPixelsPerCss = { x: calibration.readUInt32BE(16) / clip.width, y: calibration.readUInt32BE(20) / clip.height }
    if (![observedPixelsPerCss.x, observedPixelsPerCss.y].every(n => Number.isFinite(n) && n > 0) || Math.abs(observedPixelsPerCss.x - observedPixelsPerCss.y) > 1 / clip.width + 1 / clip.height) throw new Error('Diagram density calibration is not uniform')
    const desiredPixelsPerCss = 2 / geometry.canvas.scale, requestedScale = desiredPixelsPerCss / observedPixelsPerCss.x
    const png = await capture(requestedScale, 'live')
    const actual = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
    records.push({ calibration: { observedPixelsPerCss, desiredPixelsPerCss, requestedScale, actual } }); metadata()
    // CDP puede cuantizar el clip antes de escalarlo. El oráculo reduce estos píxeles
    // a round(geometry.width/height), como V6, sin desplazar ni corregir la geometría.
    return { png, geometry }
  } finally {
    metadata()
    await info.attach(`${name}-live-dom.json`, { path: metadataPath, contentType: 'application/json' })
  }
}

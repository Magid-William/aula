// Entrada dedicada sin App, puente IPC, almacenes ni proveedores que lean preferencias.
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { FigureRenderApi, FigureRenderBounds, FigureRenderInput } from '@shared/figuresRender'
import { validateFigureRenderInput, figureRenderLayout } from '@engine/figures/render'
import { diagramGeometryNodes, diagramTexts } from '@engine/figures/diagram'
import { FIGURE_LIMITS } from '@shared/figures'
import { DrawingExportScene } from '@renderer/blocks/visual/shared/DrawingExportScene'
import { DiagramExportScene, diagramBackgroundStyle } from '@renderer/blocks/visual/shared/DiagramExportScene'
import { assertDrawingFontsReady } from '@renderer/lib/figureExport/drawingFonts'
import { preflightDrawingTexts } from '@renderer/lib/figureExport/StaticDrawingText'
import { drawingExportBounds } from '@renderer/lib/figureExport/drawingBounds'
import { diagramExportBounds } from '@renderer/lib/figureExport/diagramBounds'
import './figure-render.css'

declare global { interface Window { aulaFigureRender: FigureRenderApi } }

const host = document.getElementById('root')!
let renderError: unknown
const root = createRoot(host, { onUncaughtError: (error) => { renderError = error } })
const controller = new AbortController()
let mounted: { input: FigureRenderInput; bounds: FigureRenderBounds } | undefined
let resourceError = false
window.addEventListener('error', (event) => { if (event.target !== window) resourceError = true }, true)
document.fonts.addEventListener('loadingerror', () => { resourceError = true })

function active(): void {
  if (controller.signal.aborted) throw new DOMException('Drawing render cancelled', 'AbortError')
  if (resourceError) throw new Error('Drawing resource failed')
  if (renderError) throw renderError
}
function deadline<T>(promise: PromiseLike<T>): Promise<T> {
  active()
  const signal = controller.signal
  return new Promise<T>((resolve, reject) => {
    const end = (error: unknown, value?: T): void => { clearTimeout(timer); signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(value as T) }
    const cancel = (): void => end(new DOMException('Drawing render cancelled', 'AbortError'))
    const timer = setTimeout(() => end(new Error('Drawing render timed out')), 15_000)
    signal.addEventListener('abort', cancel, { once: true })
    void Promise.resolve(promise).then((value) => end(null, value), (error: unknown) => end(error))
  })
}
async function nextFrame(): Promise<void> {
  let id = 0
  try { await deadline(new Promise<void>((resolve) => { id = requestAnimationFrame(() => resolve()) })) }
  finally { cancelAnimationFrame(id) }
  active()
}
async function fontsReady(scene: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    // Layout solicita sólo las caras que Chromium va a pintar, también las de fórmulas recién montadas.
    scene.getBoundingClientRect()
    await deadline(document.fonts.ready)
    await nextFrame()
    scene.getBoundingClientRect()
    if (document.fonts.status === 'loaded') { assertDrawingFontsReady(scene); return }
  }
  throw new Error('Drawing fonts did not settle')
}
const sameBounds = (a: FigureRenderBounds, b: FigureRenderBounds): boolean => (['x', 'y', 'width', 'height'] as const).every((key) => Math.abs(a[key] - b[key]) < 0.01)
async function stableBounds(scene: HTMLElement, width: number, height: number, measure: typeof drawingExportBounds): Promise<FigureRenderBounds> {
  let previous = measure(scene, { width, height })
  for (let attempt = 0, stable = 0; attempt < 12; attempt++) {
    await nextFrame()
    const current = measure(scene, { width, height })
    stable = sameBounds(previous, current) ? stable + 1 : 0
    if (stable >= 2 && document.fonts.status === 'loaded') return current
    previous = current
  }
  throw new Error('Drawing layout did not settle')
}
function dimensions(width: number, height: number): void {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= FIGURE_LIMITS.maxDimension) || width * height > FIGURE_LIMITS.maxPixels) throw new Error('Drawing surface exceeds limits')
}
function encode(bytes: Uint8Array): string {
  let result = ''
  for (let start = 0; start < bytes.length; start += 0x8000) result += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(result)
}

window.aulaFigureRender = {
  async render(value) {
    active()
    const input = validateFigureRenderInput(value)
    const { scene } = input
    if (mounted) throw new Error('Drawing scene is already mounted')
    // El CSS inicial puede fallar antes de que el módulo instale su listener de recursos.
    if (![...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].every((link) => link.sheet !== null)) throw new Error('Drawing stylesheet failed')
    if (input.kind === 'drawing') {
      const { scene } = input
      preflightDrawingTexts(scene.items.flatMap((item) => item.labels.map((label) => label.text)), 2 + (scene.metrics.cssZoom === 1 ? 0 : 1) + scene.items.reduce((total, item) => total + 1 + item.paths.length * 5 + item.labels.length * 2 + item.rings.reduce((sum, ring) => sum + 2 + ring.strokes.length * 4, 0), 0))
    } else preflightDrawingTexts(diagramTexts(input.scene), diagramGeometryNodes(input.scene))
    const { palette, theme, language } = scene.appearance
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.lang = language
    document.documentElement.style.fontSize = `${scene.metrics.rootFontPx}px`
    for (const [name, value] of Object.entries({ paper: palette.paper, text: palette.text, text2: palette.text2, text3: palette.text3, 'accent-text': palette.link, accent: palette.accent, 'pigment-brick': palette.brick })) document.documentElement.style.setProperty(`--${name}`, value)
    document.body.style.fontSize = 'inherit'
    document.body.style.backgroundColor = palette.paper
    host.style.backgroundColor = palette.paper
    if (input.kind === 'diagram') Object.assign(host.style, diagramBackgroundStyle(input.scene))
    flushSync(() => root.render(input.kind === 'drawing' ? <DrawingExportScene scene={input.scene} /> : <DiagramExportScene scene={input.scene} />))
    active()
    const element = host.querySelector<HTMLElement>('[data-drawing-scene], [data-diagram-scene]')
    if (!element) throw new Error('Drawing scene is unavailable')
    await fontsReady(element)
    const { width: layoutWidth, height: layoutHeight } = figureRenderLayout(input)
    const bounds = await stableBounds(element, layoutWidth, layoutHeight, input.kind === 'drawing' ? drawingExportBounds : diagramExportBounds)
    mounted = { input, bounds }
    return { bounds, layoutWidth, layoutHeight }
  },
  async resize({ width, height, scale, offsetX, offsetY }) {
    active()
    dimensions(width, height)
    if (!mounted || !Number.isFinite(scale) || scale <= 0 || scale > 16 || ![offsetX, offsetY].every(Number.isFinite)) throw new Error('Invalid drawing viewport')
    const element = host.querySelector<HTMLElement>('[data-drawing-scene], [data-diagram-scene]')!
    element.style.transformOrigin = '0 0'
    element.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`
    if (mounted.input.kind === 'diagram') Object.assign(host.style, diagramBackgroundStyle(mounted.input.scene, scale, offsetX, offsetY))
    await nextFrame(); await nextFrame()
    if (window.innerWidth !== width || window.innerHeight !== height) throw new Error('Drawing viewport was constrained')
    const bounds = mounted.bounds
    const measured = mounted.input.kind === 'drawing'
      ? drawingExportBounds(element, figureRenderLayout(mounted.input), scale)
      : diagramExportBounds(element, figureRenderLayout(mounted.input))
    const frame = element.getBoundingClientRect()
    if ((['x', 'y', 'width', 'height'] as const).some((key) => Math.abs(bounds[key] - measured[key]) > 1)) {
      // Diagnóstico privado sólo numérico; el proceso principal conserva el error público genérico.
      const detail = mounted.input.kind === 'diagram' ? `: ${JSON.stringify({ expected: bounds, measured, scale, frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height } })}` : ''
      throw new Error(`Drawing bounds changed while framing${detail}`)
    }
    if (Math.abs(frame.x + bounds.x * scale) > 1 || Math.abs(frame.y + bounds.y * scale) > 1 || bounds.width * scale > width + 1 || bounds.height * scale > height + 1) throw new Error('Drawing framing is inconsistent')
    return { width: window.innerWidth, height: window.innerHeight }
  },
  async normalize({ data, width, height }) {
    active()
    dimensions(width, height)
    if (data.length > Math.ceil(FIGURE_LIMITS.maxPngBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid private PNG')
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
    let bitmap: ImageBitmap | undefined
    const canvas = document.createElement('canvas')
    try {
      bitmap = await deadline(createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'default' }))
      dimensions(bitmap.width, bitmap.height)
      canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { colorSpace: 'srgb', alpha: false })
      if (!context) throw new Error('Drawing canvas is unavailable')
      context.drawImage(bitmap, 0, 0, width, height)
      bitmap.close(); bitmap = undefined
      const blob = await deadline(new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Drawing PNG encoding failed')), 'image/png')))
      if (blob.size > FIGURE_LIMITS.maxPngBytes) throw new Error('Drawing PNG exceeds limits')
      const result = new Uint8Array(await deadline(blob.arrayBuffer()))
      active()
      return { data: encode(result), width, height }
    } finally { bitmap?.close(); canvas.width = canvas.height = 0 }
  },
  cancel() {
    controller.abort()
    mounted = undefined
    root.unmount()
    host.replaceChildren()
  }
}

// Cajas reales en CSS: no dependen del viewport ni de su recorte provisional.
import type { FigureRenderBounds } from '@shared/figuresRender'
import { unionDrawingBounds } from './drawingBounds'

export function diagramExportBounds(scene: HTMLElement, nominal: { width: number; height: number }): FigureRenderBounds {
  // Chromium redondea los rectángulos transformados a Float32: invertir una escala fraccionaria
  // puede mover ambos bordes enteros de una sombra al otro lado de floor/ceil. Medimos el layout
  // natural de la escena privada sin esa transformación externa, sin ceder un frame ni ocultar
  // cambios reales de fuentes, wrapping o viewport. Las transformaciones interiores se conservan.
  const transform = scene.style.getPropertyValue('transform'), priority = scene.style.getPropertyPriority('transform')
  try {
    scene.style.setProperty('transform', 'none', 'important')
    return naturalBounds(scene, nominal)
  } finally {
    if (transform) scene.style.setProperty('transform', transform, priority)
    else scene.style.removeProperty('transform')
  }
}

function naturalBounds(scene: HTMLElement, nominal: { width: number; height: number }): FigureRenderBounds {
  const origin = scene.getBoundingClientRect()
  const boxes: FigureRenderBounds[] = [{ x: 0, y: 0, ...nominal }]
  const addRect = (rect: DOMRect): void => {
    if (rect.width > 0 && rect.height > 0) boxes.push({ x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height })
  }
  const nodes = scene.querySelectorAll('*')
  if (nodes.length > 10_000) throw new Error('Diagram DOM exceeds limits')
  for (const path of scene.querySelectorAll<SVGGraphicsElement>('[data-diagram-geometry]')) {
    const css = getComputedStyle(path)
    if (css.stroke === 'none' && css.fill === 'none') continue
    const box = path.getBBox(), matrix = path.getScreenCTM()
    if (!matrix) throw new Error('Diagram transform is unavailable')
    const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix))
    // getBBox no incluye el trazo. Con el límite SVG 4 fijado por la escena, un miter puede
    // sobresalir cuatro semigrosores; round y las elipses sólo necesitan uno.
    const reach = path.localName === 'path' && css.strokeLinejoin === 'miter' ? 4 : 1
    const stroke = css.stroke === 'none' ? 0 : parseFloat(css.strokeWidth) * Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) / 2 * reach
    const x = Math.min(...points.map((point) => point.x)) - stroke - origin.x, y = Math.min(...points.map((point) => point.y)) - stroke - origin.y
    boxes.push({ x, y, width: Math.max(...points.map((point) => point.x)) + stroke - origin.x - x, height: Math.max(...points.map((point) => point.y)) + stroke - origin.y - y })
  }
  for (const label of scene.querySelectorAll<HTMLElement>('[data-diagram-label]')) {
    const labelRect = label.getBoundingClientRect()
    addRect(labelRect)
    // Extensión conservadora del kernel de sombra Chromium (3σ), incluida su traslación.
    const shadow = label.dataset.diagramShadow
    const margin = shadow === 'e2' ? { x: 40, top: 18, bottom: 62 } : shadow === 'e1' ? { x: 23, top: 9, bottom: 37 } : undefined
    if (margin) boxes.push({ x: labelRect.x - origin.x - margin.x, y: labelRect.y - origin.y - margin.top, width: labelRect.width + 2 * margin.x, height: labelRect.height + margin.top + margin.bottom })
    const visibleRect = (element: Element, rect: DOMRect): DOMRect | undefined => {
      let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom
      for (let ancestor: Element | null = element; ancestor && ancestor !== scene; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor)
        if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || ancestor.classList.contains('katex-mathml')) return undefined
        // KaTeX dibuja raíces con SVG de 400em y recorta la cola; esa superficie no es tinta visible.
        if (ancestor === element) continue
        const bounds = ancestor.getBoundingClientRect()
        if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
      }
      return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : undefined
    }
    for (const child of label.querySelectorAll<Element>('*')) {
      const rect = visibleRect(child, child.getBoundingClientRect())
      if (rect) addRect(rect)
    }
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || !node.parentElement) continue
      range.selectNodeContents(node)
      for (const raw of range.getClientRects()) {
        const rect = visibleRect(node.parentElement, raw)
        if (rect) addRect(rect)
      }
    }
    range.detach()
  }
  return unionDrawingBounds(boxes)
}

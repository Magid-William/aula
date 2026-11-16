// Proyección síncrona del layout y del paso comprometidos. Nunca recalcula la disposición tras una espera.
import type { DiagramBlock } from '@shared/schema/blocks'
import type { FigureTypography } from '@shared/figuresTypography'
import type { DiagramCircle, DiagramEllipse, DiagramInk, DiagramLabel, DiagramLeaf, DiagramPath, DiagramPrimitive, DiagramRenderSceneV1, DiagramTextLine } from '@shared/figuresDiagram'
import type { InkDrawing } from '@renderer/design/paint/drawings'
import { circleLoopInk, circleLoopPad, edgeInk, encircleInk, encirclePad, outlineInk, ovalInk } from '@renderer/design/paint/penInk'
import type { DiagramLayout, StepLight } from '@renderer/blocks/visual/lib/diagramLayout'
import type { Box, FormLayout, MindmapLayout, PyramidLayout, VennLayout } from '@renderer/blocks/visual/lib/diagramForms'
import { DIAGRAM_DIM, MAX_INK_EDGES, VENN_COLORS, diagramCurvePath, diagramNodePresentation, pyramidFill } from '@renderer/blocks/visual/diagram/presentation'
import { INK, vizColor, wash } from '@renderer/blocks/visual/shared/colors'
import { assertDrawingFontsReady } from './drawingFonts'
import { diagramTypography } from './diagramTypography'

export interface DiagramCommittedState {
  b: DiagramBlock
  blockId: string
  layout: DiagramLayout | undefined
  form: FormLayout | undefined
  hl: StepLight | undefined
  revealed: ReadonlySet<string> | undefined
  step: number | null
  hover: string | null
  dark: boolean
  outsideText: string
  ofStepsText: string
}
export interface DiagramCaptureHandle { freeze(language: string, direction: 'ltr' | 'rtl'): DiagramRenderSceneV1 }

/** Sólo tipos de presentación; IDs y el bloque fuente no sobreviven esta función. */
export function projectDiagramScene(state: DiagramCommittedState, appearance: DiagramRenderSceneV1['appearance'], rootFontPx: number, resolve: (css: string) => string, flowPhases: ReadonlyMap<string, number> = new Map(), typography: FigureTypography = { bodyFont: 'sans', bodyItalic: false, cssZoom: 1 }): DiagramRenderSceneV1 {
  const { b, blockId, hl, step, hover, form, layout } = state
  const source = form ?? layout
  if (!source) throw new Error('Diagram layout is unavailable')
  const primitives: DiagramPrimitive[] = []
  const shown = (id: string): boolean => !state.revealed || state.revealed.has(id)
  const lit = (id: string): boolean => hl?.nodes.has(id) ?? false
  const opacity = (id: string): number => hl && !lit(id) ? DIAGRAM_DIM : 1
  const color = (css: string): string => resolve(css)
  // SVG usa miter por defecto; sólo polígonos, rombos y el icono declaran round en el lienzo vivo.
  const path = (d: string, fields: Partial<Omit<DiagramPath, 'kind' | 'd'>> = {}): DiagramPath => ({ kind: 'path', d, fill: 'none', stroke: 'none', strokeWidth: 0, strokeLinejoin: 'miter', opacity: 1, dash: [], dashOffset: 0, ...fields })
  const ellipse = (cx: number, cy: number, rx: number, ry: number, fields: Partial<Omit<DiagramEllipse, 'kind' | 'cx' | 'cy' | 'rx' | 'ry'>> = {}): DiagramEllipse => ({ kind: 'ellipse', cx, cy, rx, ry, fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1, dash: [], ...fields })
  const ink = (drawing: InkDrawing, x: number, y: number, css: string, alpha = 1): DiagramInk => ({
    kind: 'ink', box: { x, y, width: drawing.w, height: drawing.h }, viewWidth: drawing.w, viewHeight: drawing.h, color: color(css), opacity: alpha,
    strokes: drawing.strokes.map((s) => ({ d: s.d, spine: s.spine, reach: s.reach, ...(s.dry ? { dry: s.dry, dryWidth: s.dryWidth } : {}) }))
  })
  const line = (text: string, fields: Partial<Omit<DiagramTextLine, 'text'>> = {}): DiagramTextLine => ({ text, content: 'rich', color: color('var(--text)'), font: 'inherit', size: 14, lineHeight: 19, weight: 400, tabular: false, clamp: 0, breakWords: false, fullWidth: false, height: null, marginTop: 0, ...fields })
  // `t-caption` del lienzo vivo (12 px con la raíz de 15, en rem: crece con el tamaño del texto)
  const caption = { size: rootFontPx * 12 / 15, lineHeight: rootFontPx, weight: 500 as const }
  // leading-4 del lienzo vivo es 1rem: también sigue el tamaño de texto elegido por el estudiante.
  const detail = (text: string, fields: Partial<Omit<DiagramTextLine, 'text'>> = {}): DiagramTextLine => line(text, { size: 12, lineHeight: rootFontPx, color: color('var(--text2)'), ...fields })
  const label = (box: Box, lines: DiagramTextLine[], fields: Partial<Omit<DiagramLabel, 'kind' | 'lines'>> = {}): DiagramLabel => ({
    kind: 'label', x: box.x, y: box.y, width: box.w, height: box.h, maxWidth: null, anchor: 'top-left', layout: 'block', align: 'left', vertical: 'top', paddingX: 0, paddingY: 0, wrap: 'normal', truncate: false,
    shape: 'none', background: 'none', tint: 'none', border: 'none', borderWidth: 0, shadow: 'none', opacity: 1, lines, ...fields
  })
  const ring = (box: Box, id: string): DiagramInk => {
    const drawing = encircleInk(box.w, box.h, `${blockId}:${id}`), pad = encirclePad()
    return ink(drawing, box.x - pad, box.y - pad, 'var(--pigment-brick)')
  }
  const rings = (boxes: Array<{ id: string; box: Box }>): void => {
    if (!hl || step === null) return
    for (const item of boxes.filter((x) => shown(x.id) && hl.focus.has(x.id)).slice(0, 4)) primitives.push(ring(item.box, item.id))
  }

  function graph(l: DiagramLayout): void {
    const edges = l.edges.filter((e) => shown(e.from) && shown(e.to))
    // El umbral depende del layout comprometido completo, igual que en el lienzo vivo.
    const inked = l.edges.length <= MAX_INK_EDGES
    const edgeLit = (key: string): boolean => hl?.edges.has(key) ?? false
    const near = (from: string, to: string): boolean => hover !== null && (from === hover || to === hover)
    if (l.cycle) primitives.push(ellipse(l.cycle.cx, l.cycle.cy, l.cycle.rx, l.cycle.ry, { stroke: color('var(--line)'), strokeWidth: 1.2, dash: [2, 7] }))
    for (const e of edges) {
      if (inked && !e.dashed) continue
      const on = edgeLit(e.key), incident = near(e.from, e.to)
      const c = color(on ? 'var(--accent)' : incident ? 'var(--text2)' : 'var(--text3)')
      const children: DiagramLeaf[] = [path(e.d, { stroke: c, strokeWidth: on ? 2.4 : incident ? 1.9 : 1.4, dash: e.dashed ? [5, 4] : [] })]
      if (on) children.push(path(e.d, { stroke: color('var(--surface)'), strokeWidth: 1.4, dash: [2, 12], dashOffset: flowPhases.get(e.key) ?? 0, opacity: 0.9 }))
      if (e.head) children.push(path(e.head, { fill: c }))
      primitives.push({ kind: 'group', opacity: hl && !on ? 0.2 : on || incident ? 1 : 0.8, children })
    }
    if (inked) for (const e of edges) {
      if (e.dashed) continue
      const on = edgeLit(e.key)
      const placed = edgeInk(e.pts.map(([x, y]) => ({ x, y })), e.barbs?.map(([x, y]) => ({ x, y })) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] | undefined, `diag:${blockId}:${e.key}`, on ? 1.9 : 1.6)
      if (placed) primitives.push(ink(placed.drawing, placed.x, placed.y, on ? 'var(--accent)' : near(e.from, e.to) ? 'var(--text2)' : 'var(--text3)', hl && !on ? 0.2 : 1))
    }
    if (inked && hl) for (const e of edges) if (edgeLit(e.key) && !e.dashed) primitives.push(path(e.d, { stroke: color('var(--surface)'), strokeWidth: 1.2, dash: [2, 12], dashOffset: flowPhases.get(e.key) ?? 0, opacity: 0.85 }))
    if (l.cycle) {
      const { cx, cy } = l.cycle
      if (step !== null && b.steps.length) primitives.push(label({ x: cx - 60, y: cy - 40, w: 120, h: 80 }, [line(String(step + 1), { content: 'plain', font: 'serif', size: 34, lineHeight: 38, tabular: true }), line(state.ofStepsText, { content: 'plain', ...caption, color: color('var(--text3)') })], { layout: 'column', align: 'center', vertical: 'center' }))
      else {
        // Icono repeat de Aula (rejilla 24) resuelto a coordenadas naturales de 26px.
        const k = 26 / 24, x = cx - 13, y = cy - 13, p = (a: number, v: number): number => a + v * k
        const ds = [`M${p(x, 4.5)} ${p(y, 11)}V${p(y, 9.5)}A${3 * k} ${3 * k} 0 0 1 ${p(x, 7.5)} ${p(y, 6.5)}h${11 * k}`, `M${p(x, 16)} ${p(y, 4)}l${2.5 * k} ${2.5 * k}L${p(x, 16)} ${p(y, 9)}`, `M${p(x, 19.5)} ${p(y, 13)}v${1.5 * k}a${3 * k} ${3 * k} 0 0 1 ${-3 * k} ${3 * k}h${-11 * k}`, `M${p(x, 8)} ${p(y, 20)}l${-2.5 * k} ${-2.5 * k}L${p(x, 8)} ${p(y, 15)}`]
        primitives.push({ kind: 'group', opacity: 0.6, children: ds.map((d) => path(d, { stroke: color('var(--text3)'), strokeWidth: 1.4 * k, strokeLinejoin: 'round' })) })
      }
    }
    for (const e of edges) if (e.label && e.labelAt) {
      const on = edgeLit(e.key)
      primitives.push(label({ x: e.labelAt[0], y: e.labelAt[1], w: 0, h: 0 }, [line(e.label, { ...caption, color: color(on ? 'var(--accent-text)' : 'var(--text2)') })], { width: null, height: null, maxWidth: 200, anchor: 'center', paddingX: rootFontPx * 0.5, paddingY: 1, wrap: 'nowrap', truncate: true, shape: 'round', background: color(on ? 'var(--accent-wash)' : 'var(--surface)'), border: color(on ? 'var(--accent-line)' : 'var(--line)'), borderWidth: 0.5, opacity: hl && !on ? 0.3 : 1 }))
    }
    for (const n of l.nodes.filter((node) => shown(node.id))) {
      const on = lit(n.id), p = diagramNodePresentation(n.node, on)
      const box = { x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h }
      const lines = [line(n.node.label, { weight: 600, clamp: 6, breakWords: true })]
      if (p.detail) lines.push(detail(p.detail, { clamp: 3, marginTop: rootFontPx * 0.25 }))
      const text = label(box, lines, { layout: 'column', align: 'center', vertical: 'center', paddingX: p.diamond ? n.w * 0.18 : rootFontPx * 0.875, paddingY: p.diamond ? 0 : rootFontPx * 0.5 })
      if (p.diamond) {
        const d = `M${n.x} ${box.y + 1}L${box.x + n.w - 1} ${n.y}L${n.x} ${box.y + n.h - 1}L${box.x + 1} ${n.y}Z`
        primitives.push({ kind: 'group', opacity: opacity(n.id), children: [path(d, { fill: color('var(--surface)') }), path(d, { fill: color(p.background), stroke: color(p.ring), strokeWidth: 1, strokeLinejoin: 'round' }), text] })
      } else primitives.push({ ...text, opacity: opacity(n.id), shape: n.node.shape === 'round' || n.node.shape === 'circle' || n.node.shape === 'note' ? n.node.shape : 'box', background: color('var(--surface)'), tint: p.background === 'var(--surface)' ? 'none' : color(p.background), border: color(p.ring), borderWidth: 0.75, shadow: on || hover === n.id ? 'e2' : 'e1' })
    }
    rings(l.nodes.map((n) => ({ id: n.id, box: { x: n.x - n.w / 2 - 3, y: n.y - n.h / 2 - 3, w: n.w + 6, h: n.h + 6 } })))
  }

  function pyramid(l: PyramidLayout): void {
    const rows = l.rows.filter((r) => shown(r.id))
    for (const r of rows) primitives.push(path(`${r.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')}Z`, { fill: color(pyramidFill(r.index, l.rows.length, r.node.color)), stroke: color('var(--line-strong)'), strokeWidth: 0.75, strokeLinejoin: 'round', opacity: opacity(r.id) }))
    for (const r of rows) if (r.leader) primitives.push(path(`M${r.leader[0].join(' ')}L${r.leader[1].join(' ')}`, { stroke: color('var(--text3)'), strokeWidth: 1, dash: [1.5, 4], opacity: opacity(r.id) }))
    const outline = outlineInk(l.outline.map(([x, y]) => ({ x, y })), l.width, l.height, `${blockId}:silueta`)
    primitives.push(ink(outline, 0, 0, 'var(--text2)', 0.55))
    for (const r of rows) {
      const lines = [line(r.node.label, { weight: 600, breakWords: true, fullWidth: true, height: r.labelH })]
      if (r.inlineDetail && r.node.detail) lines.push(detail(r.node.detail, { fullWidth: true, marginTop: 3 }))
      primitives.push(label(r.label, lines, { layout: 'column', align: 'center', vertical: 'center', opacity: opacity(r.id) }))
    }
    for (const r of rows) if (r.detail && r.node.detail) primitives.push(label(r.detail, [detail(r.node.detail)], { opacity: opacity(r.id) }))
    rings(l.rows.map((r) => ({ id: r.id, box: grow(r.label, 6) })))
  }

  function venn(l: VennLayout): void {
    const circles = l.circles.filter((c) => shown(c.id))
    for (const c of circles) primitives.push(ellipse(c.cx, c.cy, c.r, c.r, { fill: color(wash(c.node.color ? vizColor(c.node.color) : VENN_COLORS[c.index % 3], (lit(c.id) ? 24 : 15) + (state.dark ? 6 : 0))) }))
    const hovered = hover?.startsWith('set:') ? { members: [hover.slice(4)], whole: true } : hover !== null ? { members: hover.split('&').filter(Boolean), whole: false } : undefined
    if (hovered && hovered.members.length && hovered.members.every(shown)) {
      const circle = (c: { cx: number; cy: number; r: number }): DiagramCircle => ({ cx: c.cx, cy: c.cy, r: c.r })
      const include = circles.filter((c) => hovered.members.includes(c.id)).map(circle)
      if (include.length) primitives.push({ kind: 'venn-region', include, exclude: hovered.whole ? [] : circles.filter((c) => !hovered.members.includes(c.id)).map(circle), fill: color(wash('var(--text)', 9)) })
    }
    for (const c of circles) {
      const loop = circleLoopInk(c.r, `${blockId}:conjunto:${c.id}`), pad = circleLoopPad()
      primitives.push(ink(loop, c.cx - c.r - pad, c.cy - c.r - pad, 'var(--text2)', 0.8))
    }
    for (const c of circles) primitives.push(label(c.title, [line(c.node.label, { font: 'serif', size: 16, lineHeight: 21, weight: 600 })], { layout: c.below ? 'block' : 'bottom', align: 'center', vertical: c.below ? 'top' : 'bottom', opacity: opacity(c.id) }))
    for (const item of l.items.filter((it) => shown(it.id))) primitives.push(label(item.box, [line(item.node.label, { size: 13, lineHeight: 17, breakWords: true, weight: lit(item.id) ? 600 : 400, color: color(lit(item.id) ? 'var(--accent-text)' : 'var(--text)') })], { layout: 'grid', align: 'center', vertical: 'center', opacity: opacity(item.id) }))
    if (l.outside) {
      const items = l.outside.items.filter((it) => shown(it.id))
      if (items.length) primitives.push(label(l.outside.label, [line(state.outsideText, { content: 'plain', size: 12, lineHeight: 16, color: color('var(--text3)') })]))
      for (const item of items) primitives.push(label(item.box, [line(item.node.label, { size: 13, lineHeight: 17, weight: lit(item.id) ? 600 : 400, color: color(lit(item.id) ? 'var(--accent-text)' : 'var(--text)') })], { layout: 'grid', align: 'center', vertical: 'center', opacity: opacity(item.id), shape: 'round', background: color('var(--surface)'), border: color('var(--line)'), borderWidth: 0.5, paddingX: rootFontPx * 0.625 }))
    }
    if (hl && step !== null) for (const c of circles.filter((it) => hl.focus.has(it.id)).slice(0, 3)) {
      const drawing = circleLoopInk(c.r + 9, `${blockId}:rodeo:${c.id}`, 2.2, 1.1), pad = circleLoopPad(2.2)
      primitives.push(ink(drawing, c.cx - c.r - 9 - pad, c.cy - c.r - 9 - pad, 'var(--pigment-brick)'))
    }
    rings([...l.items, ...(l.outside?.items ?? [])].map((it) => ({ id: it.id, box: grow(it.box, 2) })))
  }

  function mindmap(l: MindmapLayout): void {
    const root = l.root, branches = l.branches.filter((x) => shown(x.id))
    for (const x of branches) {
      const stroke = color(x.color ? vizColor(x.color) : INK), strokeWidth = x.depth === 1 ? 3 : 2
      primitives.push({ kind: 'group', opacity: opacity(x.id), children: [path(diagramCurvePath(x.curve), { stroke, strokeWidth }), path(diagramCurvePath(x.underline), { stroke, strokeWidth })] })
    }
    if (shown(root.id)) {
      primitives.push({ kind: 'group', opacity: opacity(root.id), children: [ellipse(root.cx, root.cy, root.rx, root.ry, { fill: color('var(--surface)') }), ellipse(root.cx, root.cy, root.rx, root.ry, { fill: color(wash(INK, 16)) })] })
      const loop = ovalInk(root.rx, root.ry, `${blockId}:centro`), pad = circleLoopPad(1.8)
      primitives.push(ink(loop, root.cx - root.rx - pad, root.cy - root.ry - pad, 'var(--text)', 0.75 * opacity(root.id)))
      primitives.push(label(root.label, [line(root.node.label, { font: 'serif', size: 17, lineHeight: 22, weight: 600 })], { layout: 'grid', align: 'center', vertical: 'center', opacity: opacity(root.id) }))
    }
    for (const x of branches) primitives.push(label(x.label, [line(x.node.label, { size: x.depth === 1 ? 15 : 14, lineHeight: x.depth === 1 ? 20 : 19, weight: x.depth === 1 ? 600 : 400, breakWords: true })], { align: x.side > 0 ? 'left' : 'right', opacity: opacity(x.id) }))
    for (const x of branches) if (x.detail && x.node.detail) primitives.push(label(x.detail, [detail(x.node.detail)], { align: x.side > 0 ? 'left' : 'right', opacity: opacity(x.id) }))
    rings([{ id: root.id, box: { x: root.cx - root.rx, y: root.cy - root.ry, w: root.rx * 2, h: root.ry * 2 } }, ...l.branches.map((x) => ({ id: x.id, box: grow(x.detail ? unite(x.label, x.detail) : x.label, 4) }))])
  }

  if (form?.form === 'pyramid' || form?.form === 'funnel') pyramid(form)
  else if (form?.form === 'venn') venn(form)
  else if (form?.form === 'mindmap') mindmap(form)
  else if (layout) graph(layout)
  return { version: 1, family: form?.form ?? b.kind, canvas: { width: source.width, height: source.height }, metrics: { rootFontPx, bodyFont: typography.bodyFont, bodyItalic: typography.bodyItalic, cssZoom: typography.cssZoom }, appearance: { ...appearance, palette: { ...appearance.palette }, background: { ...appearance.background } }, primitives, output: { scale: 2 } }
}

const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by })
const unite = (a: Box, b: Box): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) })

export function freezeDiagramExportState(state: DiagramCommittedState, element: HTMLElement, language: string, direction: 'ltr' | 'rtl'): DiagramRenderSceneV1 {
  assertDrawingFontsReady(element)
  const document = element.ownerDocument, probe = document.createElement('span'), canvas = document.createElement('canvas')
  probe.style.display = 'none'; element.appendChild(probe)
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!context) { probe.remove(); throw new Error('Diagram canvas is unavailable') }
  const cache = new Map<string, string>()
  const resolve = (value: string): string => {
    const cached = cache.get(value)
    if (cached) return cached
    probe.style.color = value
    const css = getComputedStyle(probe).color
    if (!css || !CSS.supports('color', css)) throw new Error('Unresolved diagram color')
    context.clearRect(0, 0, 1, 1); context.fillStyle = css; context.fillRect(0, 0, 1, 1)
    const rgba = [...context.getImageData(0, 0, 1, 1).data]
    const hex = `#${rgba.slice(0, rgba[3] === 255 ? 3 : 4).map((n) => n.toString(16).padStart(2, '0')).join('')}`
    cache.set(value, hex)
    return hex
  }
  try {
    const palette = { paper: resolve('var(--sunken)'), text: resolve('var(--text)'), text2: resolve('var(--text2)'), text3: resolve('var(--text3)'), link: resolve('var(--accent-text)'), accent: resolve('var(--accent)'), brick: resolve('var(--pigment-brick)') }
    const flowPhases = new Map<string, number>()
    for (const path of element.querySelectorAll<SVGPathElement>('[data-diagram-flow]')) {
      const phase = parseFloat(getComputedStyle(path).strokeDashoffset)
      if (!Number.isFinite(phase)) throw new Error('Diagram flow phase is unavailable')
      flowPhases.set(path.dataset.diagramFlow!, phase)
    }
    return projectDiagramScene(state, { theme: state.dark ? 'dark' : 'light', language, direction, palette, background: { kind: 'dots', color: resolve('var(--fill3)'), spacing: 18, radius: 1, fadeRadius: 1.2 } }, parseFloat(getComputedStyle(document.documentElement).fontSize), resolve, flowPhases, diagramTypography(element))
  } finally { probe.remove(); canvas.width = canvas.height = 0 }
}

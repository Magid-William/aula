import { describe, expect, it } from 'vitest'
import { decodeBlock, type BlockOf } from '@shared/schema/blocks'
import type { DiagramLeaf, DiagramRenderSceneV1 } from '@shared/figuresDiagram'
import { revealedAt } from '@engine/content/diagram-forms'
import { validateDiagramRenderScene } from '@engine/figures/diagram'
import { estimateMeasure, layoutDiagram, stepHighlight } from '@renderer/blocks/visual/lib/diagramLayout'
import { layoutForm } from '@renderer/blocks/visual/lib/diagramForms'
import { projectDiagramScene, type DiagramCommittedState } from './diagramState'

const palette = { paper: '#f6f3ed', text: '#201e1a', text2: '#585550', text3: '#65625e', link: '#9c4527', accent: '#b4502f', brick: '#b4502f' }
const appearance: DiagramRenderSceneV1['appearance'] = { theme: 'light', language: 'es', direction: 'ltr', palette, background: { kind: 'dots', color: '#201e1a1a', spacing: 18, radius: 1, fadeRadius: 1.2 } }
const resolve = (css: string): string => css.startsWith('#') ? css : css.startsWith('color-mix') ? '#12345644' : '#123456'
const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => decodeBlock({ type: 'diagram', id: 'PRIVATE_BLOCK_ID', kind: 'flow', ...raw }) as BlockOf<'diagram'>
function committed(raw: Record<string, unknown>, step: number | null = null, beside = true): DiagramCommittedState {
  const b = diagram(raw), form = layoutForm(b, estimateMeasure, { detailsBeside: beside })
  return { b, blockId: 'PRIVATE_BLOCK_ID', form, layout: form ? undefined : layoutDiagram(b, estimateMeasure), hl: stepHighlight(b, step), revealed: revealedAt(b, step), step, hover: null, dark: false, outsideText: 'Fuera de los conjuntos', ofStepsText: `de ${b.steps.length} pasos` }
}
const freeze = (state: DiagramCommittedState, phases?: ReadonlyMap<string, number>) => projectDiagramScene(state, appearance, 18, resolve, phases)
const leaves = (scene: DiagramRenderSceneV1): DiagramLeaf[] => scene.primitives.flatMap((p) => p.kind === 'group' ? p.children : [p])
const labels = (scene: DiagramRenderSceneV1) => leaves(scene).filter((p) => p.kind === 'label')
const nodes = [{ id: 'a', label: 'Alpha $x_1$', detail: 'detalle **A**' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }]
const edges = [{ from: 'a', to: 'b', label: 'transforma', arrow: true }, { from: 'b', to: 'c', dashed: true, arrow: true }]

describe('proyección completa Diagram desde el commit', () => {
  it.each([1.75, 1.8])('congela el contexto de zoom %s sin cambiar el layout ni la fase visible', cssZoom => {
    const state = committed({ nodes, edges, steps: [{ nodes: ['a', 'b'], edges: [['a', 'b']], md: 'Paso' }] }, 0)
    const phases = new Map((state.layout?.edges ?? []).map(edge => [edge.key, -19.5]))
    const normal = freeze(state, phases)
    const typography = { bodyFont: 'serif' as const, bodyItalic: true, cssZoom, extra: 'PRIVATE_CSS' }
    const scene = projectDiagramScene(state, appearance, 18, resolve, phases, typography)
    typography.cssZoom = 2; typography.bodyItalic = false
    expect(scene.metrics).toEqual({ rootFontPx: 18, bodyFont: 'serif', bodyItalic: true, cssZoom })
    expect(scene.canvas).toEqual(normal.canvas); expect(scene.primitives).toEqual(normal.primitives)
    expect(normal.metrics.cssZoom).toBe(1)
    expect(JSON.stringify(scene)).not.toContain('PRIVATE_CSS')
    expect(validateDiagramRenderScene(scene)).toEqual(scene)
  })
  it.each(['flow', 'concept', 'tree', 'cycle', 'layers'])('conserva %s sin transportar bloque, IDs ni controles', (kind) => {
    const state = committed({ kind, nodes, edges })
    const scene = freeze(state)
    expect(validateDiagramRenderScene(scene)).toEqual(scene)
    expect(scene.family).toBe(kind)
    expect(scene.canvas).toEqual({ width: state.layout!.width, height: state.layout!.height })
    expect(labels(scene).flatMap((l) => l.lines.map((v) => v.text))).toEqual(expect.arrayContaining(['Alpha $x_1$', 'Beta', 'Gamma', 'detalle **A**']))
    expect(JSON.stringify(scene)).not.toMatch(/PRIVATE_BLOCK_ID|data-ask|"steps"|"hover"|"playing"|"sourceIndex"/)
  })
  it.each(['pyramid', 'funnel', 'mindmap'])('proyecta la forma %s completa', (form) => {
    const state = committed({ form, nodes, edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] })
    const scene = freeze(state)
    expect(validateDiagramRenderScene(scene)).toEqual(scene)
    expect(scene.family).toBe(form)
    expect(labels(scene).flatMap((l) => l.lines.map((v) => v.text))).toEqual(expect.arrayContaining(['Alpha $x_1$', 'Beta', 'Gamma', ...(form === 'mindmap' ? [] : ['detalle **A**'])]))
    expect(leaves(scene).some((p) => p.kind === 'ink')).toBe(true)
  })
  it.each([2, 3])('Venn de %i conjuntos conserva alpha, región, exclusión, chips y rótulo', (count) => {
    const sets = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: `Conjunto ${i}`, shape: 'circle' }))
    const state = committed({ form: 'venn', nodes: [...sets, { id: 'inside', label: 'Dentro' }, { id: 'outside', label: 'Fuera' }], edges: [{ from: 'inside', to: 's0' }] })
    state.hover = 's0'
    const scene = freeze(state)
    expect(validateDiagramRenderScene(scene)).toEqual(scene)
    expect(scene.family).toBe('venn')
    const region = leaves(scene).find((p) => p.kind === 'venn-region')!
    expect(region.include).toHaveLength(1)
    expect(region.exclude).toHaveLength(count - 1)
    expect(region.fill).toBe('#12345644')
    expect(labels(scene).flatMap((l) => l.lines.map((v) => v.text))).toContain('Fuera de los conjuntos')
    expect(labels(scene).find((l) => l.lines.some((v) => v.text === 'Fuera'))).toMatchObject({ shape: 'round', borderWidth: 0.5 })
  })
  it('forma inválida conserva el fallback legítimo de su kind', () => {
    const state = committed({ kind: 'tree', form: 'venn', nodes, edges })
    expect(state.form).toBeUndefined()
    expect(freeze(state).family).toBe(state.b.kind)
  })
  it('detalle de pirámide usa el layout beside o inline ya comprometido', () => {
    const raw = { form: 'pyramid', nodes, edges }
    const beside = freeze(committed(raw, null, true)), inline = freeze(committed(raw, null, false))
    const inLabel = labels(inline).find((p) => p.lines.some((l) => l.text === 'Alpha $x_1$'))!
    expect(inLabel.lines.map((l) => l.text)).toEqual(['Alpha $x_1$', 'detalle **A**'])
    expect(inLabel.lines[1].marginTop).toBe(3)
    expect(labels(beside).find((p) => p.lines.some((l) => l.text === 'Alpha $x_1$'))!.lines).toHaveLength(1)
    expect(labels(beside).find((p) => p.lines[0].text === 'detalle **A**')).toBeDefined()
    expect(beside.canvas.width).toBeGreaterThan(inline.canvas.width)
  })
  it.each([15, 21])('conserva leading-4 de los detalles con raíz de %ipx', (rootFontPx) => {
    for (const form of [undefined, 'pyramid', 'funnel', 'mindmap']) for (const beside of [false, true]) {
      const state = committed({ form, nodes: [{ id: 'a', label: 'Root' }, { id: 'b', label: 'Child', detail: 'Detalle que ocupa varias líneas' }], edges: [{ from: 'a', to: 'b' }] }, null, beside)
      const scene = projectDiagramScene(state, appearance, rootFontPx, resolve)
      const lines = labels(scene).flatMap(label => label.lines).filter(line => line.text === 'Detalle que ocupa varias líneas')
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({ size: 12, lineHeight: rootFontPx })
      expect(validateDiagramRenderScene(scene)).toEqual(scene)
    }
  })
  it.each([15, 19.5])('la etiqueta de una flecha y el «de N pasos» del ciclo siguen a t-caption (12 px con raíz de 15) con raíz de %spx', (rootFontPx) => {
    const flow = projectDiagramScene(committed({ nodes, edges }), appearance, rootFontPx, resolve)
    const edgeLabel = labels(flow).flatMap((label) => label.lines).find((line) => line.text === 'transforma')!
    expect(edgeLabel).toMatchObject({ size: rootFontPx * 12 / 15, lineHeight: rootFontPx, weight: 500 })
    const cycle = projectDiagramScene(committed({ kind: 'cycle', nodes, edges: [], steps: [{ nodes: ['a'], md: 'Paso' }] }, 0), appearance, rootFontPx, resolve)
    const ofSteps = labels(cycle).flatMap((label) => label.lines).find((line) => line.text === 'de 1 pasos')!
    expect(ofSteps).toMatchObject({ size: rootFontPx * 12 / 15, lineHeight: rootFontPx, weight: 500 })
  })
  it.each([undefined, 'pyramid', 'funnel', 'mindmap'])('build %s elimina texto/flechas/anillos futuros antes de IPC y congela copias', (form) => {
    const state = committed({ form, build: true, title: 'PRIVATE_TITLE', caption: 'PRIVATE_CAPTION', nodes: [{ id: 'a', label: 'Visible' }, { id: 'PRIVATE_NODE', label: 'HIDDEN_LABEL', detail: 'HIDDEN_DETAIL' }], edges: [{ from: 'a', to: 'PRIVATE_NODE', label: 'HIDDEN_EDGE' }], steps: [{ nodes: ['a'], md: 'PRIVATE_STEP' }, { nodes: ['PRIVATE_NODE'], title: 'HIDDEN_STEP', md: 'HIDDEN_ANSWER' }] }, 0)
    state.hl!.focus.add('PRIVATE_NODE')
    const scene = freeze(state), json = JSON.stringify(scene)
    expect(json).not.toMatch(/HIDDEN|PRIVATE/)
    state.b.nodes[0].label = 'MUTATED'
    state.revealed = new Set(state.b.nodes.map((n) => n.id))
    if (state.layout) state.layout.nodes[0].x += 20
    if (state.form?.form === 'pyramid') state.form.rows[0].label.x += 20
    expect(JSON.stringify(scene)).toBe(json)
    expect(validateDiagramRenderScene(scene)).toEqual(scene)
  })
  it('Venn no transmite círculo oculto ni su corte ni su anillo de foco', () => {
    const state = committed({ form: 'venn', build: true, nodes: [{ id: 'a', label: 'A', shape: 'circle' }, { id: 'secret', label: 'HIDDEN_SET', shape: 'circle' }, { id: 'x', label: 'Visible' }], edges: [{ from: 'x', to: 'a' }], steps: [{ nodes: ['x'], md: 'primero' }, { nodes: ['secret'], md: 'HIDDEN_STEP' }] }, 0)
    state.hover = 'a'; state.hl!.focus.add('secret')
    const scene = freeze(state)
    expect(JSON.stringify(scene)).not.toContain('HIDDEN')
    expect(leaves(scene).filter((p) => p.kind === 'ellipse')).toHaveLength(1)
    expect(leaves(scene).find((p) => p.kind === 'venn-region')).toMatchObject({ exclude: [] })
    const onlyVisible = freeze({ ...state, hl: { ...state.hl!, focus: new Set(['x']) } })
    expect(scene).toEqual(onlyVisible)
  })
  it('cinco shapes, clips, sombras hover y opacidad compuesta del rombo', () => {
    const shapes = ['box', 'round', 'circle', 'diamond', 'note']
    const state = committed({ nodes: shapes.map((shape, i) => ({ id: String(i), shape, label: shape, detail: 'Detalle' })), steps: [{ nodes: ['0'], md: 'un foco' }] }, 0)
    state.hover = '1'
    const scene = freeze(state), ls = labels(scene)
    expect(ls.map((l) => l.shape)).toEqual(['box', 'round', 'circle', 'none', 'note'])
    expect(ls[0].shadow).toBe('e2')
    expect(ls[1].shadow).toBe('e2')
    expect(ls[2].shadow).toBe('e1')
    expect(ls.every((l) => l.lines[0].clamp === 6 && l.lines[1].clamp === 3)).toBe(true)
    const diamond = scene.primitives.find((p) => p.kind === 'group' && p.children.some((c) => c.kind === 'label' && c.lines[0].text === 'diamond'))!
    expect(diamond).toMatchObject({ opacity: 0.24, children: [{ opacity: 1 }, { opacity: 1 }, { opacity: 1 }] })
    expect(ls[3].paddingX).toBeCloseTo(ls[3].width! * 0.18)
  })
  it.each([40, 41])('respeta el umbral comprometido de %i aristas y las discontinuas', (count) => {
    const state = committed({ nodes: Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, label: `N${i}` })), edges: Array.from({ length: count }, (_, i) => ({ from: `n${Math.floor(i / 9)}`, to: `n${(Math.floor(i / 9) + i % 9 + 1) % 10}`, arrow: true, dashed: i === 0 })) })
    const scene = freeze(state)
    expect(state.layout!.edges).toHaveLength(count)
    expect(leaves(scene).some((p) => p.kind === 'ink')).toBe(count === 40)
    expect(leaves(scene).some((p) => p.kind === 'path' && p.dash.join(' ') === '5 4')).toBe(true)
    expect(validateDiagramRenderScene(scene)).toEqual(scene)
  })
  it('conserva miter en las polilíneas y los subrayados del mapa mental', () => {
    const state = committed({ form: 'mindmap', nodes, edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] })
    const paths = leaves(freeze(state)).filter((p) => p.kind === 'path')
    expect(paths).toHaveLength(4)
    expect(paths.some((p) => (p.d.match(/L/g) ?? []).length === 18)).toBe(true)
    expect(paths.every((p) => p.strokeLinejoin === 'miter')).toBe(true)
  })
  it.each(['pyramid', 'funnel'])('conserva round en polígonos y miter en guías de %s', form => {
    const paths = leaves(freeze(committed({ form, nodes, edges }))).filter((p) => p.kind === 'path')
    const polygons = paths.filter((p) => p.fill !== 'none'), leaders = paths.filter((p) => p.dash.length > 0)
    expect(polygons).toHaveLength(nodes.length)
    expect(polygons.every((p) => p.strokeLinejoin === 'round')).toBe(true)
    expect(leaders).toHaveLength(1)
    expect(leaders[0]).toMatchObject({ strokeLinejoin: 'miter', dash: [1.5, 4] })
  })
  it('distingue vectores y flujo miter del contorno round del rombo', () => {
    const state = committed({ nodes: [{ id: 'a', label: 'Rombo', shape: 'diamond' }, { id: 'b', label: 'Destino' }], edges: [{ from: 'a', to: 'b', dashed: true, arrow: true }], steps: [{ nodes: ['a', 'b'], edges: [['a', 'b']] }] }, 0)
    const paths = leaves(freeze(state)).filter((p) => p.kind === 'path'), route = state.layout!.edges[0]
    const edgePaths = paths.filter((p) => p.d === route.d || p.d === route.head)
    expect(edgePaths).toHaveLength(3)
    expect(edgePaths.every((p) => p.strokeLinejoin === 'miter')).toBe(true)
    expect(edgePaths.some((p) => p.dash.join(' ') === '2 12')).toBe(true)
    expect(paths.filter((p) => p.strokeLinejoin === 'round')).toHaveLength(1)
    expect(paths.find((p) => p.strokeLinejoin === 'round')).toMatchObject({ strokeWidth: 1 })
  })
  it('conserva las cuatro uniones round del icono repeat del ciclo', () => {
    const state = committed({ kind: 'cycle', nodes, edges })
    const scene = freeze(state), icon = scene.primitives.find((p) => p.kind === 'group' && p.opacity === 0.6)
    if (!icon || icon.kind !== 'group') throw new Error('icono ausente')
    expect(icon.children).toHaveLength(4)
    expect(icon.children.every((p) => p.kind === 'path' && p.strokeLinejoin === 'round')).toBe(true)
  })
  it('congela fase viz-flow y contador localizado/tabular sin texto de pasos', () => {
    const state = committed({ kind: 'cycle', nodes, edges, steps: [{ nodes: ['a', 'b'], md: 'PRIVATE_PROCESS' }, { nodes: ['c'], md: 'HIDDEN_STEP' }] }, 0)
    const scene = freeze(state, new Map([[state.layout!.edges[0].key, -17.625]]))
    expect(leaves(scene).find((p) => p.kind === 'path' && p.dash.join(' ') === '2 12')).toMatchObject({ dashOffset: -17.625 })
    expect(labels(scene).flatMap((l) => l.lines).find((l) => l.text === '1')).toMatchObject({ tabular: true, size: 34 })
    expect(labels(scene).flatMap((l) => l.lines).some((l) => l.text === 'de 2 pasos')).toBe(true)
    expect(JSON.stringify(scene)).not.toMatch(/PRIVATE_PROCESS|HIDDEN_STEP/)
  })
})

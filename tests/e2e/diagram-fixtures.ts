// Casos de producto independientes del DTO de exportación: ejercitan las ramas reales del diagrama vivo.
import type { BlockOf, DiagramEdge, DiagramNode, DiagramShape } from '../../src/shared/schema/blocks'

export interface DiagramFixture { key: string; block: BlockOf<'diagram'>; family: string; narrow?: boolean }
const node = (id: string, label: string, shape: DiagramShape = 'box', extra: Partial<DiagramNode> = {}): DiagramNode => ({ id: `PRIVATE_ID_${id}`, label, shape, ...extra })
const edge = (from: string, to: string, label?: string, dashed = false): DiagramEdge => ({ from: `PRIVATE_ID_${from}`, to: `PRIVATE_ID_${to}`, label, dashed, arrow: true })
function block(key: string, values: Partial<BlockOf<'diagram'>>): BlockOf<'diagram'> {
  return { id: `PRIVATE_BLOCK_${key}`, type: 'diagram', kind: 'flow', direction: 'lr', nodes: [], edges: [], steps: [], title: `PRIVATE_TITLE_${key}`, ...values }
}
function steps(b: BlockOf<'diagram'>, first: string[]): BlockOf<'diagram'> {
  return { ...b, build: true, steps: [
    { title: 'First view', md: 'Visible instructions outside the canvas.', nodes: first, edges: [] },
    { title: 'PRIVATE_FUTURE_STEP_TITLE', md: 'PRIVATE_FUTURE_STEP_EXPLANATION', nodes: b.nodes.map(n => n.id), edges: [] }
  ] }
}
function graph(kind: BlockOf<'diagram'>['kind']): DiagramFixture {
  const b = block(kind, {
    kind, direction: kind === 'tree' || kind === 'layers' ? 'tb' : 'lr',
    nodes: [
      node('a', 'Start $\\frac{a+b}{\\sqrt{c}}$', 'box', { detail: 'First line and **important detail**.', color: 'blue' }),
      node('b', 'مرحلة $x_1^2$ · 数学', 'round', { detail: '[Reference](https://example.invalid/reference)', color: 'green' }),
      node('c', 'Is $x<y$?', 'diamond', { color: 'amber' }),
      node('d', 'Loop', 'circle', { color: 'teal' }),
      node('e', 'A long note label that reaches the six-line clamp. '.repeat(8), 'note', { detail: 'A long detail that reaches the three-line clamp. '.repeat(8), color: 'terracotta' })
    ],
    edges: [edge('a', 'b', '$v=\\frac{d}{t}$'), edge('b', 'c', 'A long edge label whose overflow is intentionally truncated at the badge boundary'), edge('c', 'd', 'yes'), edge('c', 'e', 'no', true), ...(kind === 'cycle' ? [edge('e', 'a')] : [])]
  })
  return { key: kind, family: kind, block: steps(b, [b.nodes[0].id, b.nodes[1].id]) }
}
function pyramid(form: 'pyramid' | 'funnel', narrow = false): DiagramFixture {
  const key = `${form}${narrow ? '-narrow' : ''}`
  const b = block(key, {
    kind: 'layers', form, direction: 'tb',
    nodes: [
      node('top', 'Energy $E=mc^2$', 'box', { color: 'accent', detail: 'A complete explanation with $\\frac{1}{2}mv^2$ and enough text to wrap naturally.' }),
      node('middle', 'مرحلة · $\\sqrt{x_1}$', 'box', { color: 'green', detail: 'The second explanation changes between the side column and the interior of its row.' }),
      node('bottom', 'Foundation', 'box', { color: 'blue', detail: 'A third **detail** with [an inert link](https://example.invalid/detail).' })
    ]
  })
  return { key, family: form, narrow, block: steps(b, [b.nodes[0].id]) }
}
function venn(count: 2 | 3): DiagramFixture {
  const key = `venn${count}`
  const nodes = [node('A', 'Set A', 'circle', { color: 'blue' }), node('B', 'Set B', 'circle', { color: 'amber' })]
  if (count === 3) nodes.push(node('C', 'Set C', 'circle', { color: 'teal' }))
  nodes.push(node('a', '$x\\in A$'), node('ab', '$A\\cap B$'), node('outside', 'Outside $\\mathbb{R}$'))
  const edges = [edge('a', 'A'), edge('ab', 'A'), edge('ab', 'B')]
  if (count === 3) {
    nodes.push(node('abc', '$A\\cap B\\cap C$'), node('c', 'مرحلة C'))
    edges.push(edge('abc', 'A'), edge('abc', 'B'), edge('abc', 'C'), edge('c', 'C'))
  }
  const b = block(key, { kind: 'concept', form: 'venn', nodes, edges })
  return { key, family: 'venn', block: steps(b, ['PRIVATE_ID_a']) }
}
function mindmap(): DiagramFixture {
  const b = block('mindmap', { kind: 'tree', form: 'mindmap', nodes: [
    node('root', 'Central $\\alpha$'),
    node('a', 'Left branch', 'box', { color: 'blue', detail: 'First branch detail with $\\frac{a}{b}$.' }),
    node('b', 'Right branch', 'box', { color: 'green', detail: 'A second detail that wraps.' }),
    node('aa', 'Depth two · 数学'), node('bb', 'مرحلة $x_2$'), node('c', 'Another idea', 'box', { color: 'amber' })
  ], edges: [edge('root', 'a'), edge('root', 'b'), edge('a', 'aa'), edge('b', 'bb'), edge('root', 'c')] })
  return { key: 'mindmap', family: 'mindmap', block: steps(b, ['PRIVATE_ID_a', 'PRIVATE_ID_aa']) }
}
function dense(count: 40 | 41): DiagramFixture {
  // Ocho nodos bastan para forzar el umbral de tinta sin crear un lienzo desmesurado.
  const nodes = Array.from({ length: 8 }, (_, i) => node(`n${i}`, `Node ${i} $x_${i}$`, i % 2 ? 'round' : 'box', { color: i === 0 ? 'green' : 'blue' }))
  const edges: DiagramEdge[] = []
  for (let from = 0; from < 8; from++) for (let to = 0; to < 8; to++) if (from !== to && edges.length < count) edges.push(edge(`n${from}`, `n${to}`, edges.length === 0 ? '$\\Delta t$' : undefined, edges.length === 1))
  return { key: `edges-${count}`, family: 'concept', block: block(`edges-${count}`, { kind: 'concept', nodes, edges }) }
}

export const DIAGRAM_FIXTURES: DiagramFixture[] = [
  ...(['flow', 'concept', 'tree', 'cycle', 'layers'] as const).map(graph),
  pyramid('pyramid'), pyramid('funnel'), venn(2), venn(3), mindmap(),
  dense(40), dense(41), pyramid('pyramid', true), pyramid('funnel', true),
  { key: 'fallback', family: 'concept', block: block('fallback', { kind: 'flow', form: 'venn', nodes: [node('a', 'One set', 'circle'), node('b', 'No second set')], edges: [edge('a', 'b')] }) }
]

export const EMPTY_DIAGRAM = block('empty-narrative', { build: true, nodes: [node('future', 'HIDDEN_FUTURE_LABEL')], steps: [
  { title: 'Narrative', md: 'First read the explanation.', nodes: [], edges: [] },
  { title: 'PRIVATE_FUTURE_STEP_TITLE', md: 'PRIVATE_FUTURE_STEP_EXPLANATION', nodes: ['PRIVATE_ID_future'], edges: [] }
] })

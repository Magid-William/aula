import type { DiagramRenderSceneV1, DiagramLabel } from '@shared/figuresDiagram'

export function diagramLabelFixture(): DiagramLabel {
  return {
    kind: 'label', x: 5, y: 6, width: 80, height: 40, maxWidth: null, anchor: 'top-left', layout: 'column', align: 'center', vertical: 'center',
    paddingX: 4, paddingY: 3, wrap: 'normal', truncate: false, shape: 'round', background: '#ffffff', tint: '#ff000014', border: '#112233', borderWidth: 1,
    shadow: 'e1', opacity: 1,
    lines: [{ text: '$x<y$ [visible](https://example.invalid)', content: 'rich', color: '#112233', font: 'inherit', size: 14, lineHeight: 19, weight: 500, clamp: 3, breakWords: true, fullWidth: false, height: null, marginTop: 0, tabular: false }]
  }
}
export function diagramSceneFixture(): DiagramRenderSceneV1 {
  return {
    version: 1, family: 'flow', canvas: { width: 100, height: 80 }, metrics: { rootFontPx: 16, bodyFont: 'sans', bodyItalic: false, cssZoom: 1 },
    appearance: {
      theme: 'light', language: 'es', direction: 'ltr',
      palette: { paper: '#ffffff', text: '#000000', text2: '#111111', text3: '#222222', brick: '#aa2211', accent: '#aa2211', link: '#aa2211' },
      background: { kind: 'dots', color: '#11223318', spacing: 18, radius: 1, fadeRadius: 1.2 }
    },
    primitives: [
      { kind: 'path', d: 'M0 0 L20 20', fill: 'none', stroke: '#112233', strokeWidth: 1.5, strokeLinejoin: 'miter', opacity: .8, dash: [5, 4], dashOffset: -2 },
      { kind: 'ellipse', cx: 40, cy: 40, rx: 30, ry: 20, fill: '#11223328', stroke: 'none', strokeWidth: 0, opacity: 1, dash: [] },
      { kind: 'ink', box: { x: 0, y: 0, width: 100, height: 80 }, viewWidth: 100, viewHeight: 80, color: '#112233', opacity: .9, strokes: [{ d: 'M0 0 L50 50', spine: 'M0 0 L50 50', reach: 2, dry: 'M1 1 L2 2', dryWidth: .4 }] },
      diagramLabelFixture(),
      { kind: 'venn-region', include: [{ cx: 30, cy: 30, r: 20 }], exclude: [{ cx: 50, cy: 30, r: 20 }], fill: '#12345644' },
      { kind: 'group', opacity: .24, children: [{ kind: 'path', d: 'M0 0 L8 0 L4 8 Z', fill: '#ffffff', stroke: '#112233', strokeWidth: 1, strokeLinejoin: 'round', opacity: 1, dash: [], dashOffset: 0 }, diagramLabelFixture()] }
    ], output: { scale: 2 }
  }
}

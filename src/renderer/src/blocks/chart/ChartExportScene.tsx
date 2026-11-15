// Pintor pasivo de la presentación comprometida: sin stores, interacción ni decisiones de layout.
import type { CSSProperties } from 'react'
import type { ChartBox, ChartLayer, ChartPaint, ChartRenderSceneV1, ChartSvgPrimitive } from '@shared/figuresChart'
import { FIGURE_FONTS } from '@renderer/lib/figureExport/figureTypography'

const boxStyle = (box: ChartBox): CSSProperties => ({ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height })
const paintProps = (item: ChartPaint) => ({
  fill: item.fill, stroke: item.stroke, fillOpacity: item.fillOpacity, strokeOpacity: item.strokeOpacity, strokeWidth: item.strokeWidth,
  strokeLinecap: item.strokeLinecap, strokeLinejoin: item.strokeLinejoin, strokeMiterlimit: 4,
  opacity: item.opacity, strokeDasharray: item.dash.length ? item.dash.join(' ') : undefined
})

function Primitive({ item }: { item: ChartSvgPrimitive }) {
  switch (item.kind) {
    case 'path': return <path data-chart-geometry d={item.d} {...paintProps(item)} />
    case 'rect': return <rect data-chart-geometry x={item.x} y={item.y} width={item.width} height={item.height} rx={item.rx} {...paintProps(item)} />
    case 'ellipse': return <ellipse data-chart-geometry cx={item.cx} cy={item.cy} rx={item.rx} ry={item.ry} {...paintProps(item)} />
    case 'line': return <line data-chart-geometry x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} {...paintProps(item)} />
    case 'text': return <text data-chart-geometry x={item.x} y={item.y} fill={item.color} fontSize={item.size} fontWeight={item.weight} textAnchor={item.anchor} style={{ fontVariantNumeric: item.tabular ? 'tabular-nums' : 'normal' }}>
      {item.lines.map((line, i) => <tspan key={i} x={line.x} dy={line.dy}>{line.text}</tspan>)}
    </text>
    default: { const exhaustive: never = item; return exhaustive }
  }
}

function Layer({ item }: { item: ChartLayer }) {
  switch (item.kind) {
    case 'svg': return <svg data-chart-svg width={item.box.width} height={item.box.height} aria-hidden style={{ ...boxStyle(item.box), overflow: item.overflow }}>
      {item.primitives.map((primitive, i) => <Primitive key={i} item={primitive} />)}
    </svg>
    case 'panel': return <div data-chart-panel data-chart-shadow={item.shadow} style={{
      ...boxStyle(item.box), boxSizing: 'border-box', background: item.background === 'none' ? 'transparent' : item.background,
      border: item.borderWidth ? `${item.borderWidth}px solid ${item.border === 'none' ? 'transparent' : item.border}` : undefined,
      borderRadius: item.radius, boxShadow: item.shadow === 'e2' ? 'var(--e2)' : undefined, opacity: item.opacity
    }} />
    case 'html-text': return <div data-chart-text dir={item.direction} style={{
      ...boxStyle(item.box), boxSizing: 'content-box', padding: 0, border: 0, margin: 0,
      color: item.color, fontFamily: FIGURE_FONTS[item.font], fontStyle: item.italic ? 'italic' : 'normal', fontSize: item.size,
      lineHeight: `${item.lineHeight}px`, fontWeight: item.weight, letterSpacing: item.letterSpacing, fontVariantNumeric: item.tabular ? 'tabular-nums' : 'normal',
      direction: item.direction, textAlign: item.align, whiteSpace: item.whiteSpace, overflow: item.overflow, textOverflow: item.truncate ? 'ellipsis' : 'clip', opacity: item.opacity
    }}>{item.text}</div>
    default: { const exhaustive: never = item; return exhaustive }
  }
}

export function ChartExportScene({ scene }: { scene: ChartRenderSceneV1 }) {
  const content = scene.layers.map((item, i) => <Layer key={i} item={item} />)
  return <div data-chart-scene lang={scene.appearance.language} dir={scene.appearance.direction} style={{ position: 'relative', width: scene.canvas.width, height: scene.canvas.height, color: scene.appearance.palette.text, fontFamily: FIGURE_FONTS[scene.metrics.bodyFont], fontStyle: scene.metrics.bodyItalic ? 'italic' : 'normal' }}>
    {scene.metrics.cssZoom === 1 ? content : <div data-figure-css-zoom style={{ position: 'absolute', left: 0, top: 0, width: scene.canvas.width, height: scene.canvas.height, zoom: scene.metrics.cssZoom, transformOrigin: '0 0', transform: `scale(${1 / scene.metrics.cssZoom})` }}>
      {content}
    </div>}
  </div>
}

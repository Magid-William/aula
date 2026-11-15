// Pintura estática del contrato cerrado: texto HTML inerte, geometría SVG e Ink con máscaras reales.
import type { CSSProperties, ReactNode } from 'react'
import type { DiagramInk, DiagramLabel, DiagramLeaf, DiagramRenderSceneV1 } from '@shared/figuresDiagram'
import { StaticDrawingText } from '@renderer/lib/figureExport/StaticDrawingText'
import { DIAGRAM_FONTS } from '@renderer/lib/figureExport/diagramTypography'

export function diagramBackgroundStyle(scene: DiagramRenderSceneV1, scale = 1, offsetX = 0, offsetY = 0): CSSProperties {
  const b = scene.appearance.background
  return { backgroundColor: scene.appearance.palette.paper, backgroundImage: `radial-gradient(circle, ${b.color} ${b.radius * scale}px, transparent ${b.fadeRadius * scale}px)`, backgroundSize: `${b.spacing * scale}px ${b.spacing * scale}px`, backgroundPosition: `${offsetX}px ${offsetY}px` }
}

function Ink({ item, id }: { item: DiagramInk; id: string }) {
  return <svg viewBox={`0 0 ${item.viewWidth} ${item.viewHeight}`} preserveAspectRatio="none" aria-hidden
    style={{ position: 'absolute', left: item.box.x, top: item.box.y, width: item.box.width, height: item.box.height, overflow: 'visible', opacity: item.opacity }}>
    <defs>{item.strokes.map((s, i) => <mask key={i} id={`${id}-${i}`} maskUnits="userSpaceOnUse" x={-20} y={-20} width={item.viewWidth + 40} height={item.viewHeight + 40}>
      <path d={s.spine} fill="none" stroke="#fff" strokeWidth={s.reach} strokeLinecap="round" strokeLinejoin="round" />
      {s.dry && <path d={s.dry} fill="none" stroke="#000" strokeWidth={s.dryWidth} strokeLinecap="round" />}
    </mask>)}</defs>
    {item.strokes.map((s, i) => <path data-diagram-geometry key={i} d={s.d} fill={item.color} mask={`url(#${id}-${i})`} />)}
  </svg>
}

function Label({ item, scene }: { item: DiagramLabel; scene: DiagramRenderSceneV1 }) {
  const radius = item.shape === 'round' ? 999 : item.shape === 'circle' ? '50%' : item.shape === 'note' ? '4px 14px 4px 4px' : item.shape === 'box' ? 12 : 0
  const shadows = [item.tint !== 'none' ? `inset 0 0 0 ${Math.ceil(Math.max(item.width ?? 0, item.height ?? 0))}px ${item.tint}` : '', item.shadow !== 'none' ? `var(--${item.shadow})` : ''].filter(Boolean).join(', ')
  const single = item.layout !== 'column' ? item.lines[0] : undefined
  const typography = (line: DiagramLabel['lines'][number]): CSSProperties => ({ color: line.color, fontSize: line.size, lineHeight: `${line.lineHeight}px`, fontWeight: line.weight, fontVariantNumeric: line.tabular ? 'tabular-nums' : undefined, fontFamily: line.font === 'serif' ? 'var(--font-serif)' : undefined, overflowWrap: line.breakWords ? 'break-word' : undefined })
  const content = (line: DiagramLabel['lines'][number]): ReactNode => line.content === 'rich' ? <StaticDrawingText text={line.text} language={scene.appearance.language} direction={scene.appearance.direction} /> : line.text
  return <div data-diagram-label data-diagram-shadow={item.shadow} className="viz-label" style={{
    position: 'absolute', left: item.x, top: item.y, width: item.width ?? undefined, height: item.height ?? undefined, maxWidth: item.maxWidth ?? undefined,
    transform: item.anchor === 'center' ? 'translate(-50%, -50%)' : undefined,
    ...(item.layout === 'column' ? { display: 'flex', flexDirection: 'column', justifyContent: item.vertical === 'center' ? 'center' : item.vertical === 'bottom' ? 'flex-end' : 'flex-start', alignItems: item.align === 'center' ? 'center' : item.align === 'right' ? 'flex-end' : 'flex-start' } as CSSProperties : item.layout === 'grid' ? { display: 'grid', placeItems: 'center' } : item.layout === 'bottom' ? { display: 'flex', alignItems: 'flex-end', justifyContent: 'center' } : { display: 'block' }), textAlign: item.align,
    padding: `${item.paddingY}px ${item.paddingX}px`, whiteSpace: item.wrap, overflow: item.truncate ? 'hidden' : undefined,
    textOverflow: item.truncate ? 'ellipsis' : undefined, background: item.background, border: item.borderWidth ? `${item.borderWidth}px solid ${item.border}` : undefined, borderRadius: radius, boxShadow: shadows || undefined, opacity: item.opacity, ...(single ? typography(single) : {})
  }}>
    {single ? content(single) : item.lines.map((line, i) => <div key={i} style={{
      ...typography(line), width: line.fullWidth ? '100%' : undefined, height: line.height ?? undefined, marginTop: line.marginTop,
      ...(line.clamp ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: line.clamp, overflow: 'hidden' } : {}),
      ...(item.truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {})
    }}>
      {content(line)}
    </div>)}
  </div>
}

function Leaf({ item, scene, id }: { item: DiagramLeaf; scene: DiagramRenderSceneV1; id: string }) {
  if (item.kind === 'label') return <Label item={item} scene={scene} />
  if (item.kind === 'ink') return <Ink item={item} id={id} />
  let content: ReactNode
  if (item.kind === 'path') content = <path data-diagram-geometry d={item.d} fill={item.fill} stroke={item.stroke} strokeWidth={item.strokeWidth} strokeLinecap="round" strokeLinejoin={item.strokeLinejoin} strokeMiterlimit={4} strokeDasharray={item.dash.length ? item.dash.join(' ') : undefined} strokeDashoffset={item.dashOffset} opacity={item.opacity} />
  else if (item.kind === 'ellipse') content = <ellipse data-diagram-geometry cx={item.cx} cy={item.cy} rx={item.rx} ry={item.ry} fill={item.fill} stroke={item.stroke} strokeWidth={item.strokeWidth} strokeLinecap="round" strokeDasharray={item.dash.length ? item.dash.join(' ') : undefined} opacity={item.opacity} />
  else {
    let region: ReactNode = <rect width={scene.canvas.width} height={scene.canvas.height} fill={item.fill} />
    for (let i = item.include.length - 1; i >= 0; i--) region = <g clipPath={`url(#${id}-c${i})`}>{region}</g>
    content = <>
      <defs>
        {item.include.map((c, i) => <clipPath key={i} id={`${id}-c${i}`}><circle cx={c.cx} cy={c.cy} r={c.r} /></clipPath>)}
        {item.exclude.length > 0 && <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={scene.canvas.width} height={scene.canvas.height}>
          <rect width={scene.canvas.width} height={scene.canvas.height} fill="#fff" />
          {item.exclude.map((c, i) => <circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill="#000" />)}
        </mask>}
      </defs>
      <g mask={item.exclude.length ? `url(#${id}-m)` : undefined}>{region}</g>
    </>
  }
  return <svg width={scene.canvas.width} height={scene.canvas.height} aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>{content}</svg>
}

export function DiagramExportScene({ scene }: { scene: DiagramRenderSceneV1 }) {
  const content = scene.primitives.map((item, i) => item.kind === 'group'
    ? <div key={i} style={{ position: 'absolute', inset: 0, opacity: item.opacity }}>{item.children.map((child, j) => <Leaf key={j} item={child} scene={scene} id={`d-${i}-${j}`} />)}</div>
    : <Leaf key={i} item={item} scene={scene} id={`d-${i}`} />)
  return <div data-diagram-scene style={{ position: 'relative', width: scene.canvas.width, height: scene.canvas.height, color: scene.appearance.palette.text, fontFamily: DIAGRAM_FONTS[scene.metrics.bodyFont], fontStyle: scene.metrics.bodyItalic ? 'italic' : 'normal' }}>
    {scene.metrics.cssZoom === 1 ? content : <div data-figure-css-zoom style={{ position: 'absolute', left: 0, top: 0, width: scene.canvas.width, height: scene.canvas.height, zoom: scene.metrics.cssZoom, transformOrigin: '0 0', transform: `scale(${1 / scene.metrics.cssZoom})` }}>
      {content}
    </div>}
  </div>
}

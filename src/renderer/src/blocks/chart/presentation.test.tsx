import { describe, expect, it } from 'vitest'
import { motion } from 'motion/react'
import { projectChartSvg } from './presentation'

const resolve = (value: string): string => ({ 'var(--text2)': '#334455', 'var(--surface)': '#fffdf9' }[value] ?? value)

describe('presentación SVG comprometida de Chart', () => {
  it('comparte geometría final y herencia aunque la entrada todavía no haya sido vista', () => {
    const tree = <g fill="var(--text2)" stroke="var(--surface)" strokeWidth={2}>
      <motion.g initial={{ scaleY: 0 }} animate={undefined} style={{ transformBox: 'fill-box', originY: 0.4 }}>
        <path d="M0 0L10 0L10 8Z" data-ask-label="NO_TRANSPORTAR" data-ask-part="bar:0:0" />
      </motion.g>
      <motion.circle cx={9} cy={12} r={6.5} fillOpacity={0.5} initial={{ scale: 0 }} animate={undefined} style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }} />
    </g>
    const output = projectChartSvg(tree, resolve)
    expect(output).toMatchObject([
      { kind: 'path', d: 'M0 0L10 0L10 8Z', fill: '#334455', stroke: '#fffdf9', strokeWidth: 2, opacity: 1 },
      { kind: 'ellipse', cx: 9, cy: 12, rx: 6.5, ry: 6.5, fillOpacity: 0.5 }
    ])
    expect(JSON.stringify(output)).not.toMatch(/NO_TRANSPORTAR|bar:0:0|initial|animate|transformBox/)
  })
  it('preserva texto plano y posiciones tspan, sin source labels ni interpretación Markdown', () => {
    const output = projectChartSvg(<g fontSize={11.5} fill="var(--text2)" fontWeight={500} textAnchor="middle" className="tabular">
      <text x={50} y={25}><tspan x={50} dy={0}>{'**texto** $x$ <img>'}</tspan><tspan x={50} dy={13}>segunda</tspan></text>
    </g>, resolve)
    expect(output).toEqual([{ kind: 'text', x: 50, y: 25, color: '#334455', size: 11.5, weight: 500, anchor: 'middle', tabular: true, lines: [{ text: '**texto** $x$ <img>', x: 50, dy: 0 }, { text: 'segunda', x: 50, dy: 13 }] }])
  })
  it('conserva hover Pie opacity y destino del path sin capturar transition', () => {
    expect(projectChartSvg(<path d="M0 0L10 5Z" fill="#aabbcc" stroke="var(--surface)" strokeWidth={2} strokeLinejoin="round" style={{ transition: 'd 0.18s', opacity: 0.55 }} />, resolve)[0]).toMatchObject({ kind: 'path', opacity: 0.55, strokeLinejoin: 'round', strokeLinecap: 'butt' })
  })
  it('respeta la precedencia CSS de opacity y rechaza atributos que otro tag no modela', () => {
    expect(projectChartSvg(<path d="M0 0L10 5Z" opacity={0.8} style={{ opacity: 0.55 }} />, resolve)[0]).toMatchObject({ opacity: 0.55 })
    expect(() => projectChartSvg(<g strokeDasharray="3 3"><line x1={0} x2={5} y1={0} y2={5} stroke="#123456" /></g>, resolve)).toThrow()
    expect(() => projectChartSvg(<rect width={20} height={10} rx={6} ry={2} />, resolve)).toThrow()
  })
  it('omite áreas de interacción transparentes y paths vacíos', () => {
    expect(projectChartSvg(<><rect width={400} height={100} fill="transparent" onPointerEnter={() => undefined} /><path d="" fill="#123456" /></>, resolve)).toEqual([])
  })
  it('deja a SVG limitar rx y su ry implícito por eje en bandas estrechas', () => {
    expect(projectChartSvg(<rect width={4} height={200} rx={6} fill="#123456" />, resolve)[0]).toMatchObject({ kind: 'rect', width: 4, height: 200, rx: 6 })
  })
  it('mantiene dash de lectura y no confunde pathLength animado con un dash final', () => {
    const output = projectChartSvg(<><line x1={4} x2={4} y1={0} y2={100} stroke="#123456" strokeOpacity={0.6} strokeDasharray="3 3" /><motion.path d="M0 0L20 5" fill="none" stroke="#123456" initial={{ pathLength: 0 }} animate={undefined} /></>, resolve)
    expect(output).toMatchObject([{ kind: 'line', dash: [3, 3], strokeOpacity: 0.6 }, { kind: 'path', dash: [] }])
  })
  it('falla ante composición o atributos visuales que no puede representar', () => {
    for (const tree of [<g opacity={0.5}><rect width={10} height={10} /></g>, <path d="M0 0L1 1" filter="blur(2px)" />, <g transform="translate(10 0)"><circle r={2} /></g>, <text x={1} y={2} className="font-serif">texto</text>, <motion.circle r={2} animate={{ scale: 2 }} />, <motion.path d="M0 0L1 1" style={{ rotate: 40 }} />, <svg><circle r={2} /></svg>]) expect(() => projectChartSvg(tree, resolve)).toThrow()
  })
  it('no ejecuta componentes desconocidos ni desciende árboles profundos', () => {
    let called = false
    const Unknown = () => { called = true; return <path d="M0 0L1 1" /> }
    expect(() => projectChartSvg(<Unknown />, resolve)).toThrow()
    expect(called).toBe(false)
    let tree = <circle r={3} />
    for (let i = 0; i < 20; i++) tree = <g>{tree}</g>
    expect(() => projectChartSvg(tree, resolve)).toThrow()
  })
})

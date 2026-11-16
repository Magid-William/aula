// Datos de producto independientes de la escena exportada: ramas, leyendas y lectura del Chart vivo.
import type { BlockOf, ChartSeries } from '../../src/shared/schema/blocks'

export interface ChartFixture {
  key: string
  block: BlockOf<'chart'>
  branch: 'empty' | 'vertical-bars' | 'horizontal-bars' | 'cartesian' | 'donut'
  bodyWidth?: number
}
function chart(key: string, fields: Partial<BlockOf<'chart'>>): BlockOf<'chart'> {
  return { id: `PRIVATE_CHART_${key}`, type: 'chart', kind: 'bar', title: `PRIVATE_TITLE_${key}`, caption: 'PRIVATE_CAPTION outside the exported chart body.', series: [], stacked: false, showValues: false, ...fields }
}
const series = (name: string, values: number[], labels?: string[]): ChartSeries => ({ name, points: values.map((y, i) => ({ y, ...(labels ? { label: labels[i] } : { x: i }), ...(i === 1 ? { highlight: true } : {}) })) })
const short = ['First term', 'Literal $x^2$ & <tag>', 'مرحلة · 数学', 'Final term']
const long = ['Cardiovascular disease and associated conditions', 'Long-term respiratory complications in the population', 'Chronic kidney disease and related disorders', 'A mixed category مرحبا 123 with a long explanation']
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const grouped = [series('Series one with a long legend name', [12, -7, 0, 18], short), series('Second series · بيانات', [8, -4, 6, 13], short), series('Third series', [-3, 2, 9, -5], short)]

export const CHART_FIXTURES: ChartFixture[] = [
  { key: 'bar-grouped', branch: 'vertical-bars', bodyWidth: 620, block: chart('bar-grouped', { horizontal: false, series: grouped, showValues: true, xLabel: 'Category', yLabel: 'Amount', unit: 'kg' }) },
  { key: 'bar-stacked', branch: 'vertical-bars', bodyWidth: 620, block: chart('bar-stacked', { horizontal: false, series: grouped, stacked: true, xLabel: 'Category', yLabel: 'Signed stacks' }) },
  { key: 'bar-auto-horizontal', branch: 'horizontal-bars', bodyWidth: 620, block: chart('bar-auto-horizontal', { series: [series('Count', [9, -14, 21, 6], long)], showValues: true, xLabel: 'Long category names', yLabel: 'Frequency', unit: '%' }) },
  { key: 'bar-horizontal-stacked', branch: 'horizontal-bars', bodyWidth: 620, block: chart('bar-horizontal-stacked', { horizontal: true, series: [series('First', [12, -7, 0, 18], long), series('Second', [8, -4, 6, 13], long), series('Third', [-3, 2, 9, -5], long)], stacked: true, xLabel: 'Signed categories', yLabel: 'Amount' }) },
  { key: 'histogram', branch: 'vertical-bars', bodyWidth: 620, block: chart('histogram', { kind: 'histogram', series: [series('Frequency', [1, 4, 9, 13, 8, 0, 2])], showValues: true, xLabel: 'Bin', yLabel: 'Frequency' }) },
  { key: 'line-categorical', branch: 'cartesian', bodyWidth: 460, block: chart('line-categorical', { kind: 'line', series: [series('Long legend for the first monthly series', [2, 6, 5, 9, 12, 8, 15, 13, 17, 11, 18, 21], months), series('A second legend wraps onto another row', [1, 3, 8, 5, 10, 11, 12, 15, 13, 17, 19, 16], months)], showValues: true, xLabel: 'Month', yLabel: 'Value' }) },
  ...([40, 41] as const).map(count => ({ key: `line-${count}`, branch: 'cartesian' as const, bodyWidth: 620, block: chart(`line-${count}`, { kind: 'line', series: [{ name: 'Numeric curve', points: Array.from({ length: count }, (_, i) => ({ x: i * .25 - 3, y: Math.sin(i * .3) * 7 + i * .12, highlight: i === count - 3 })) }], showValues: true, xLabel: 'Time', yLabel: 'Signal' }) })),
  { key: 'area-stacked', branch: 'cartesian', bodyWidth: 620, block: chart('area-stacked', { kind: 'area', series: [series('Lower area', [3, 5, -2, 7, 4]), series('Upper area', [2, -1, 4, 3, 5])], stacked: true, showValues: true, xLabel: 'Time', yLabel: 'Stacked value' }) },
  { key: 'area-categorical', branch: 'cartesian', bodyWidth: 460, block: chart('area-categorical', { kind: 'area', series: [series('Area', [4, 11, 7, 14], short)], showValues: true, xLabel: 'Category', yLabel: 'Value' }) },
  { key: 'scatter', branch: 'cartesian', bodyWidth: 620, block: chart('scatter', { kind: 'scatter', series: [{ name: 'Measurements', points: [
    { x: -3, y: 2, label: 'Alpha' }, { x: -1.5, y: 7, label: 'مرحلة ١', highlight: true }, { x: .1, y: 4, label: 'Point C' }, { x: .2, y: 4.1, label: 'Nearby point' }, { x: 2, y: -2, label: 'Literal $x_1$' }, { x: 4, y: 9, label: '数学' }
  ] }, { name: 'Comparison', points: [{ x: -2, y: -1, label: 'Second A' }, { x: 1.2, y: 8, label: 'Second B' }, { x: 3, y: 3, label: 'Second C' }] }], xLabel: 'Independent variable', yLabel: 'Observed value' }) },
  { key: 'pie-side', branch: 'donut', bodyWidth: 620, block: chart('pie-side', { kind: 'pie', series: [{ name: 'Composition', points: Array.from({ length: 11 }, (_, i) => ({ y: [36, 25, 18, 12, 8, 6, 4, 3, 2, 1, .4][i], label: i === 0 ? 'A long category with clipped content مرحبا 123 and more words' : i >= 7 ? `FOLDED_AWAY_${i}` : `Category ${i + 1}`, highlight: i === 0 || i === 10 })) }], showValues: true, unit: 'kg' }) },
  { key: 'pie-below', branch: 'donut', bodyWidth: 360, block: chart('pie-below', { kind: 'pie', series: [{ name: 'Shares', points: [{ y: 62, label: 'A lengthy share label with literal **text** and emoji 👩‍🔬', highlight: true }, { y: 24, label: 'مرحبا 123 mixed direction' }, { y: 13.6, label: 'Café é and 数学' }, { y: .4, label: 'Small share' }] }], showValues: true, unit: '%' }) },
  { key: 'pie-no-positive', branch: 'donut', bodyWidth: 620, block: chart('pie-no-positive', { kind: 'pie', series: [series('No positive slices', [0, -4], ['UNPAINTED_ZERO', 'UNPAINTED_NEGATIVE'])], showValues: true }) },
  { key: 'empty-with-legend', branch: 'empty', bodyWidth: 460, block: chart('empty-with-legend', { kind: 'line', series: [{ name: 'Empty first series', points: [] }, { name: 'Empty second series', points: [] }] }) },
  { key: 'empty', branch: 'empty', bodyWidth: 460, block: chart('empty', { series: [] }) },
  { key: 'legend-empty-name', branch: 'cartesian', bodyWidth: 460, block: chart('legend-empty-name', { kind: 'line', series: [series('', [1, 3, 2]), series('Named', [2, 1, 4])], showValues: true }) },
  { key: 'bar-narrow', branch: 'vertical-bars', bodyWidth: 180, block: chart('bar-narrow', { horizontal: false, series: [series('Narrow categories', Array.from({ length: 24 }, (_, i) => 2 + i % 7))] }) }
]

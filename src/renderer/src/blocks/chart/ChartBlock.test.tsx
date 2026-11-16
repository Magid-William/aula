import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChartSvgPrimitive } from '@shared/figuresChart'
import { CHART_FIXTURES } from '../../../../../tests/e2e/chart-fixtures'
import { makeBlockContext } from '../types'
import type { ChartSvg } from './presentation'
import { ChartBlockView } from './ChartBlock'
import '@renderer/i18n'

const captured = vi.hoisted(() => ({ scenes: [] as Array<{ branch: string; primitives: ChartSvgPrimitive[] }> }))
vi.mock('./presentation', async importOriginal => {
  const actual = await importOriginal<typeof import('./presentation')>()
  return { ...actual, ChartSvg: ({ branch, settled, layoutWidth: _layoutWidth, children, ...props }: ComponentProps<typeof ChartSvg>) => {
    captured.scenes.push({ branch, primitives: actual.projectChartSvg(settled ?? children, value => value === 'none' ? value : '#123456') })
    return createElement('svg', props, children)
  } }
})
beforeEach(() => { captured.scenes = [] })

describe('proyección de la presentación real de Chart', () => {
  it.each(CHART_FIXTURES)('$key sólo proyecta geometría y textos de su rama real', ({ block, branch }) => {
    renderToStaticMarkup(<ChartBlockView block={block} ctx={makeBlockContext(null, 'en', { mode: 'print' })} />)
    if (branch === 'empty') expect(captured.scenes).toEqual([])
    else {
      expect(captured.scenes).toHaveLength(1)
      expect(captured.scenes[0].branch).toBe(branch)
      expect(JSON.stringify(captured.scenes)).not.toMatch(/PRIVATE_|FOLDED_AWAY_|UNPAINTED_|data-ask|series|highlight/)
    }
  })
  it('Pie de entrada sin slices visibles ya prepara la corona completa mediante el mismo helper', () => {
    const block = CHART_FIXTURES.find(fixture => fixture.key === 'pie-side')!.block
    const html = renderToStaticMarkup(<ChartBlockView block={block} ctx={makeBlockContext(null, 'en', { mode: 'lesson' })} />)
    expect(html).not.toContain('data-ask-part="slice:')
    expect(captured.scenes[0].primitives.filter(primitive => primitive.kind === 'path')).toHaveLength(8)
    expect(html).toContain('truncate')
    expect(html).toContain('A long category with clipped content')
  })
})

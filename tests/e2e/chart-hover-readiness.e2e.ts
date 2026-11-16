// Controles puros del estado que falló en CI; no abren Electron.
import { test, expect } from 'playwright/test'
import { runInNewContext } from 'node:vm'
import { isPieHoverSettled, pieHoverReadyExpression, type PieHoverState } from './chart-hover-readiness'

const ready = (): PieHoverState => ({
  target: 'var(--fill1)', label: 'Alpha', center: ['Alpha', '42', '42%'],
  background: 'rgba(32, 30, 26, 0.04)', expectedBackground: 'rgba(32, 30, 26, 0.04)', animations: []
})

test('hover Pie: exige el color final y una transición terminada, incluso si ya muestra el destino', () => {
  const state = ready()
  expect(isPieHoverSettled(state)).toBe(true)
  state.animations = [{ pending: false, playState: 'finished' }]
  expect(isPieHoverSettled(state)).toBe(true)
  for (const animation of [
    { pending: true, playState: 'running' }, { pending: true, playState: 'finished' },
    { pending: false, playState: 'running' }, { pending: false, playState: 'paused' }, { pending: false, playState: 'idle' }
  ]) expect(isPieHoverSettled({ ...state, animations: [animation] })).toBe(false)
  expect(isPieHoverSettled({ ...ready(), background: 'rgba(0, 0, 0, 0)' })).toBe(false)
  expect(isPieHoverSettled({ ...ready(), background: 'rgba(32, 30, 26, 0.039)' })).toBe(false)
})

test('hover Pie: rechaza otro sector, centro sin selección y destino sin resolver', () => {
  for (const change of [
    { target: null }, { target: 'transparent' }, { label: '' }, { center: ['Total', '100'] },
    { center: ['Beta', '42', '42%'] }, { expectedBackground: '' }
  ]) expect(isPieHoverSettled({ ...ready(), ...change })).toBe(false)
})

test('hover Pie: ni una RAF ni una lectura tardía aceptan el destino fuera del límite aunque el timer se retrase', async () => {
  for (const delayed of ['frame', 'read']) {
    let now = 0, reads = 0, callback: (() => void) | undefined
    const cleared: number[] = [], canceled: number[] = []
    const row = { isConnected: true, getAttribute: () => 'var(--fill1)', getAnimations: () => [] }
    const path = { getAttribute: () => 'Alpha' }
    const root = {
      isConnected: true,
      querySelector: (selector: string) => selector === 'svg path' ? path : row,
      querySelectorAll: () => ['Alpha', '42', '42%'].map(textContent => ({ textContent }))
    }
    const promise = runInNewContext(`(${pieHoverReadyExpression})(root, settled)`, {
      root, settled: isPieHoverSettled,
      document: { createElement: () => ({ style: {} }) },
      getComputedStyle: () => {
        if (++reads === 3 && delayed === 'read') now = 5001
        return { getPropertyValue: () => ready().background, backgroundColor: ready().background }
      },
      performance: { now: () => now },
      setTimeout: () => 11, clearTimeout: (id: number) => { cleared.push(id) },
      requestAnimationFrame: (next: () => void) => { callback = next; return 17 },
      cancelAnimationFrame: (id: number) => { canceled.push(id) }
    }) as Promise<unknown>
    if (delayed === 'frame') now = 5001
    expect(callback).toBeDefined(); callback!()
    const outcome = await Promise.resolve(promise).then(() => ({ ok: true, error: '' }), error => ({ ok: false, error: String(error) }))
    expect(outcome.ok).toBe(false); expect(outcome.error).toContain('5000 ms deadline')
    expect(cleared).toEqual([11]); expect(canceled).toEqual([17])
  }
})

// Espera sólo la transición real del sector ya seleccionado; no altera el hover ni el CSS.
import type { Locator } from 'playwright/test'
import { randomUUID } from 'node:crypto'

export interface PieHoverState {
  target: string | null
  label: string
  center: string[]
  background: string
  expectedBackground: string
  animations: Array<{ pending: boolean; playState: string }>
}

export function isPieHoverSettled(state: PieHoverState): boolean {
  return state.target === 'var(--fill1)' && state.label.length > 0 && state.center.length === 3 &&
    state.center[0] === state.label && state.expectedBackground.length > 0 &&
    state.background === state.expectedBackground &&
    state.animations.every(animation => !animation.pending && animation.playState === 'finished')
}

interface PieHoverReadyReport { initial: PieHoverState; final: PieHoverState; frames: number; elapsedMs: number }

export const pieHoverReadyExpression = `(root, settled) => {
  const row = root.querySelector('li[data-chart-panel]')
  const path = root.querySelector('svg path'), label = path?.getAttribute('data-ask-label')
  if (!row || !path || !label) throw new Error('The selected Pie fixture is unavailable')
  const expectedStyle = document.createElement('span').style
  const color = getComputedStyle(row).getPropertyValue('--fill1').trim()
  if (!color || color.toLowerCase().includes('var(')) throw new Error('Pie hover target color is unresolved')
  expectedStyle.backgroundColor = color
  if (!expectedStyle.backgroundColor) throw new Error('Pie hover target color is invalid')
  const read = () => ({
    target: row.getAttribute('data-chart-background'), label,
    center: [...root.querySelectorAll('.pointer-events-none [data-chart-text]')].map(element => element.textContent ?? ''),
    background: getComputedStyle(row).backgroundColor, expectedBackground: expectedStyle.backgroundColor,
    animations: row.getAnimations().map(animation => ({ pending: animation.pending, playState: animation.playState }))
  })
  const initial = read(), center = JSON.stringify(initial.center)
  const committed = state => root.isConnected && row.isConnected &&
    root.querySelector('svg path') === path && path.getAttribute('data-ask-label') === label &&
    root.querySelector('li[data-chart-panel]') === row && state.target === 'var(--fill1)' &&
    state.center.length === 3 && state.center[0] === label && JSON.stringify(state.center) === center
  if (!committed(initial)) throw new Error('Pie hover was not committed before readiness')
  const started = performance.now()
  return new Promise((resolve, reject) => {
    let frame = 0, frames = 0, last = initial
    const clean = () => { clearTimeout(timer); cancelAnimationFrame(frame) }
    const timer = setTimeout(() => {
      clean(); reject(new Error('Pie hover did not settle within 5000 ms: ' + JSON.stringify(last)))
    }, 5000)
    const tick = () => {
      try {
        if (performance.now() - started >= 5000) throw new Error('Pie hover readiness exceeded its 5000 ms deadline')
        frames++; last = read()
        if (!committed(last)) throw new Error('Pie hover changed while waiting for its transition')
        if (settled(last)) {
          const elapsedMs = performance.now() - started
          if (elapsedMs >= 5000) throw new Error('Pie hover readiness exceeded its 5000 ms deadline')
          clean(); resolve({ initial, final: last, frames, elapsedMs }); return
        }
        frame = requestAnimationFrame(tick)
      } catch (error) { clean(); reject(error) }
    }
    frame = requestAnimationFrame(tick)
  })
}`

export async function waitForPieHover(body: Locator): Promise<PieHoverReadyReport> {
  const key = `__aulaPieHoverReady_${randomUUID()}`, page = body.page()
  await body.evaluate((element, name) => { (globalThis as unknown as Record<string, unknown>)[name] = element }, key)
  try { return await page.evaluate<PieHoverReadyReport>(`(${pieHoverReadyExpression})(globalThis[${JSON.stringify(key)}],(${isPieHoverSettled.toString()}))`) }
  finally { await page.evaluate(name => { delete (globalThis as unknown as Record<string, unknown>)[name] }, key) }
}

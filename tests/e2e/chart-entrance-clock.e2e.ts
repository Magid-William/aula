// Controles del protocolo serializado: scheduler/DOM sintéticos, sin React, Electron ni navegador.
import { test, expect } from 'playwright/test'
import { runInNewContext } from 'node:vm'
import { installPieEntranceClock, type PieEntranceCommit, type PieEntranceHost } from './chart-entrance-clock'

function fixture(inherited = false) {
  let now = 0, nextId = 0, nextTimer = 0, disconnected = 0
  let notify: (() => void) | undefined, current: PieEntranceCommit | null = null, onRead: (() => void) | undefined
  const callbacks = new Map<number, (timestamp: number) => void>(), timers = new Map<number, () => void>()
  const canceled: number[] = []
  const native = {
    requestAnimationFrame(callback: (timestamp: number) => void): number { callbacks.set(++nextId, callback); return nextId },
    cancelAnimationFrame(id: number): void { canceled.push(id); callbacks.delete(id) }
  }
  const host: PieEntranceHost = Object.assign(inherited ? Object.create(native) : { ...native }, {
    performance: inherited ? Object.create({ now: () => now }) : { now: () => now },
    setTimeout(callback: () => void): number { timers.set(++nextTimer, callback); return nextTimer },
    clearTimeout(id: number): void { timers.delete(id) }
  })
  const before = {
    raf: Object.getOwnPropertyDescriptor(host, 'requestAnimationFrame'),
    now: Object.getOwnPropertyDescriptor(host.performance, 'now'),
    cancel: host.cancelAnimationFrame
  }
  const observe = (changed: () => void): (() => void) => {
    notify = changed
    return () => { disconnected++; notify = undefined }
  }
  const read = (): PieEntranceCommit | null => { onRead?.(); return current }
  // Se usa la misma serialización que evalúa la página; ninguna dependencia léxica externa.
  const clock = runInNewContext(`(${installPieEntranceClock.toString()})(host, observe, read, 1000)`, { host, observe, read }) as ReturnType<typeof installPieEntranceClock>
  const body = {}
  return {
    host, clock, before, callbacks, timers, canceled, body,
    get disconnected() { return disconnected },
    setTime(value: number) { now = value },
    setRead(effect: () => void) { onRead = effect },
    commit(paths: string[], identity = body) { current = { body: identity, paths }; notify?.() },
    setPaths(paths: string[]) { current = { body, paths } },
    notify() { notify?.() },
    frame(timestamp: number) {
      now = timestamp
      // Un frame nativo sólo entrega las solicitudes existentes al empezar; cancelar sigue funcionando.
      for (const id of [...callbacks.keys()]) {
        const callback = callbacks.get(id); callbacks.delete(id)
        callback?.call(host, timestamp)
      }
      notify?.() // checkpoint de MutationObserver después de las mutaciones del frame
    },
    fireTimer() { const callback = timers.values().next().value; if (!callback) throw new Error('No pending timer'); callback() }
  }
}

const outcome = async (promise: Promise<unknown>): Promise<{ ok: boolean; error: string }> =>
  Promise.resolve(promise).then(() => ({ ok: true, error: '' }), error => ({ ok: false, error: String(error) }))

test('entrada Pie: el registro tardío arranca de verdad; el primer parcial se congela sin avanzar hasta encontrarlo', async () => {
  const f = fixture(), delivered: number[] = []
  f.frame(100); f.frame(200) // La navegación no queda retenida por una cola de RAF del test.
  expect(f.host.performance.now()).toBe(200)
  const animate = (time: number): void => {
    delivered.push(time)
    f.setPaths(time < 650 ? [`partial-${time}`] : Array.from({ length: 8 }, (_, i) => `final-${i}`))
    if (time < 650) f.host.requestAnimationFrame(animate)
  }
  const firstId = f.host.requestAnimationFrame(animate)
  expect(firstId).toBe(1); expect(f.callbacks.has(firstId)).toBe(true)
  f.frame(300)
  expect(f.clock.report()).toMatchObject({ phase: 'frozen', frozenTimestamp: 300, firstPaths: ['partial-300'] })
  expect(f.disconnected).toBe(1)
  f.frame(400); f.frame(500)
  const checkpoint = await f.clock.checkpoint()
  expect(checkpoint.coherentPaths).toEqual(['partial-300'])
  expect(delivered).toEqual([300, 300, 300]); expect(f.host.performance.now()).toBe(300)
  const continued = f.clock.step(250)
  f.frame(600); f.frame(700); await continued
  expect(f.clock.report().steps[0]).toEqual({ milliseconds: 250, paths: ['partial-550'] })
  const final = f.clock.step(2000)
  f.frame(800); f.frame(900); await final
  expect(f.clock.report().steps[1].paths).toHaveLength(8)
  expect(delivered.at(-1)).toBe(2550)
  f.clock.restore(); expect(f.timers.size).toBe(0); expect(f.callbacks.size).toBe(0)
})

test('entrada Pie: conserva IDs/cancel nativos y restaura descriptores propios o heredados sin vaciar callbacks', async () => {
  for (const inherited of [false, true]) {
    const f = fixture(inherited), delivered: number[] = []
    const canceled = f.host.requestAnimationFrame(() => { throw new Error('Canceled native callback ran') })
    f.host.cancelAnimationFrame(canceled)
    const pending = f.host.requestAnimationFrame(time => delivered.push(time))
    expect([canceled, pending]).toEqual([1, 2]); expect(f.canceled).toEqual([1])
    expect(f.host.cancelAnimationFrame).toBe(f.before.cancel)
    f.clock.restore()
    expect(Object.getOwnPropertyDescriptor(f.host, 'requestAnimationFrame')).toEqual(f.before.raf)
    expect(Object.getOwnPropertyDescriptor(f.host.performance, 'now')).toEqual(f.before.now)
    expect(f.callbacks.has(pending)).toBe(true); expect(f.timers.size).toBe(0); expect(f.disconnected).toBe(1)
    f.frame(432); expect(delivered).toEqual([432]); expect(f.host.performance.now()).toBe(432)
    expect((await outcome(f.clock.checkpoint())).ok).toBe(false)
    f.clock.restore(); expect(f.disconnected).toBe(1)
  }
})

test('entrada Pie: primer commit completo o sin una RAF precedente falla; no busca otro parcial', async () => {
  for (const full of [false, true]) {
    const f = fixture()
    if (full) f.host.requestAnimationFrame(() => f.setPaths(Array.from({ length: 8 }, (_, i) => String(i))))
    if (full) f.frame(100); else f.commit(['partial-without-raf'])
    const result = await outcome(f.clock.checkpoint())
    expect(result.ok).toBe(false); expect(result.error).toContain(full ? 'already complete' : 'no preceding native RAF')
    expect(f.clock.report().steps).toEqual([])
    expect(f.timers.size).toBe(0); expect(f.disconnected).toBe(1)
    expect(Object.getOwnPropertyDescriptor(f.host, 'requestAnimationFrame')).toEqual(f.before.raf)
  }
})

test('entrada Pie: rechaza un timestamp incoherente o un cuerpo sustituido después del primer commit', async () => {
  for (const replacement of [false, true]) {
    const f = fixture()
    f.host.requestAnimationFrame(() => { f.setPaths(['first']); f.host.requestAnimationFrame(() => f.commit(['changed'], replacement ? {} : f.body)) })
    f.frame(100); f.frame(200); f.frame(300)
    const result = await outcome(f.clock.checkpoint())
    expect(result.ok).toBe(false); expect(result.error).toContain(replacement ? 'body changed' : 'does not match its frozen RAF timestamp')
    expect(f.timers.size).toBe(0); expect(f.callbacks.size).toBe(0)
  }
})

test('entrada Pie: deadline real estricto aunque se retrase el timer, la entrega o la lectura', async () => {
  for (const late of ['timer', 'commit', 'read', 'coherence']) {
    const f = fixture()
    if (late === 'timer') { f.setTime(1000); f.fireTimer() }
    if (late === 'commit') { f.host.requestAnimationFrame(() => f.setPaths(['partial'])); f.frame(1000) }
    if (late === 'read') {
      f.host.requestAnimationFrame(() => f.setPaths(['partial']))
      f.setRead(() => f.setTime(1000)); f.frame(100)
    }
    if (late === 'coherence') {
      f.host.requestAnimationFrame(() => { f.setPaths(['partial']); f.host.requestAnimationFrame(() => undefined) })
      f.frame(100); f.frame(200); f.frame(1000)
    }
    const result = await outcome(f.clock.checkpoint())
    expect(result.ok).toBe(false); expect(result.error).toContain('1000 ms wall-clock deadline')
    expect(f.timers.size).toBe(0); expect(f.disconnected).toBe(1)
  }
})

test('entrada Pie: restore durante un avance rechaza la espera y deja entregar las RAF nativas pendientes', async () => {
  const f = fixture(), delivered: number[] = []
  const animate = (time: number): void => { delivered.push(time); f.setPaths(['partial']); f.host.requestAnimationFrame(animate) }
  f.host.requestAnimationFrame(animate); f.frame(100); f.frame(200); f.frame(300)
  await f.clock.checkpoint()
  const pending = f.clock.step(250)
  f.clock.restore(); f.frame(900)
  expect((await outcome(pending)).ok).toBe(false); expect(delivered.at(-1)).toBe(900)
  expect(f.timers.size).toBe(0); expect(f.callbacks.size).toBe(1)
})

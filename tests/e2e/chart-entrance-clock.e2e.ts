// Controles del protocolo serializado: scheduler/DOM sintéticos, sin React, Electron ni navegador.
import { test, expect } from 'playwright/test'
import { runInNewContext } from 'node:vm'
import { installPieEntranceClock, type PieEntranceCommit, type PieEntranceHost } from './chart-entrance-clock'

function fixture(inherited = false, options: { initialNow?: number; deadlineMs?: number } = {}) {
  let now = options.initialNow ?? 0, nextId = 0, nextTimer = 0, disconnected = 0
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
  const clock = runInNewContext(`(${installPieEntranceClock.toString()})(host, observe, read, deadlineMs)`, { host, observe, read, deadlineMs: options.deadlineMs ?? 1000 }) as ReturnType<typeof installPieEntranceClock>
  const body = {}
  return {
    host, clock, before, callbacks, timers, canceled, body,
    get disconnected() { return disconnected },
    setTime(value: number) { now = value },
    setRead(effect: () => void) { onRead = effect },
    commit(paths: string[], identity = body) { current = { body: identity, paths }; notify?.() },
    setPaths(paths: string[]) { current = { body, paths } },
    notify() { notify?.() },
    frame(timestamp: number, wallTime = timestamp) {
      now = wallTime
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

test('entrada Pie: ancla lógica, primer RAF tardío y callbacks del mismo frame sin avance por tiempo real', async () => {
  const f = fixture(false, { initialNow: 37.5, deadlineMs: 3000 }), delivered: number[] = [], observed: number[][] = []
  const anchor = f.host.performance.now()
  f.frame(100); f.frame(200)
  expect(f.host.performance.now()).toBe(anchor); expect(anchor).toBe(37.5)
  const animate = (time: number): void => {
    delivered.push(time)
    const elapsed = time - anchor
    f.setPaths(elapsed === 0 ? [] : elapsed < 650 ? ['partial-' + time] : Array.from({ length: 8 }, (_, i) => 'final-' + i))
    if (elapsed < 650) f.host.requestAnimationFrame(animate)
  }
  const firstId = f.host.requestAnimationFrame(animate)
  f.host.requestAnimationFrame(time => observed.push([time, f.host.performance.now()]))
  expect(firstId).toBe(1); expect(f.callbacks.has(firstId)).toBe(true)
  f.frame(1500) // El primer frame nativo tarda >1s; el tiempo lógico conserva el ancla.
  expect(delivered).toEqual([37.5]); expect(observed).toEqual([[37.5, 37.5]])
  expect(f.clock.report()).toMatchObject({ phase: 'advancing', frozenTimestamp: null, entranceFrameCount: 1 })
  f.frame(1500) // Un timestamp repetido no añade un paso lógico.
  expect(delivered).toEqual([37.5, 37.5]); expect(f.host.performance.now()).toBe(37.5)
  f.setTime(1800); f.notify()
  expect(f.host.performance.now()).toBe(37.5); expect(delivered).toEqual([37.5, 37.5])
  f.host.requestAnimationFrame(time => observed.push([time, f.host.performance.now()]))
  f.frame(1900)
  expect(observed).toEqual([[37.5, 37.5], [137.5, 137.5]])
  expect(f.clock.report()).toMatchObject({ phase: 'frozen', firstPaths: ['partial-137.5'], firstCommitNativeTimestamp: 1900, firstCommitLogicalTimestamp: 137.5, frozenTimestamp: 137.5, elapsedToCommit: 1862.5, entranceFrameCount: 2 })
  expect(f.clock.report().entranceFrames).toEqual([{ native: 1500, logical: 37.5, elapsed: 1462.5 }, { native: 1900, logical: 137.5, elapsed: 1862.5 }])
  expect(f.disconnected).toBe(1)
  f.frame(2000); f.frame(2100)
  const checkpoint = await f.clock.checkpoint()
  expect(checkpoint.coherentPaths).toEqual(['partial-137.5'])
  expect(delivered).toEqual([37.5, 37.5, 137.5, 137.5, 137.5]); expect(f.host.performance.now()).toBe(137.5)
  const continued = f.clock.step(250)
  expect(f.host.performance.now()).toBe(387.5); expect(delivered.at(-1)).toBe(137.5)
  f.frame(2200); f.frame(2300); await continued
  expect(f.clock.report().steps[0]).toEqual({ milliseconds: 250, paths: ['partial-387.5'] })
  const final = f.clock.step(2000)
  f.frame(2400); f.frame(2500); await final
  expect(f.clock.report().steps[1]).toEqual({ milliseconds: 2000, paths: Array.from({ length: 8 }, (_, i) => 'final-' + i) })
  expect(delivered.at(-1)).toBe(2387.5); expect(f.clock.report().entranceFrameCount).toBe(2)
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

test('entrada Pie: primer commit con ocho sectores o sin RAF precedente falla y conserva su evidencia', async () => {
  for (const full of [false, true]) {
    const f = fixture()
    if (full) f.host.requestAnimationFrame(() => f.setPaths(Array.from({ length: 8 }, (_, i) => String(i))))
    if (full) f.frame(100); else f.commit(['partial-without-raf'])
    const result = await outcome(f.clock.checkpoint())
    expect(result.ok).toBe(false); expect(result.error).toContain(full ? 'already contains all sectors' : 'no preceding native RAF')
    expect(f.clock.report().firstPaths).toEqual(full ? Array.from({ length: 8 }, (_, i) => String(i)) : ['partial-without-raf'])
    expect(f.clock.report().firstCommitNativeTimestamp).toBe(full ? 100 : null)
    expect(f.clock.report().firstCommitLogicalTimestamp).toBe(full ? 0 : null)
    expect(f.clock.report().entranceFrameCount).toBe(full ? 1 : 0)
    expect(f.clock.report().elapsedToCommit).toBe(full ? 100 : 0)
    expect(f.clock.report().frozenTimestamp).toBe(null)
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
  expect(delivered).toEqual([0, 0, 0]); expect(f.host.performance.now()).toBe(0)
  const pending = f.clock.step(250)
  expect(f.host.performance.now()).toBe(250)
  f.clock.restore(); f.frame(900)
  expect((await outcome(pending)).ok).toBe(false); expect(delivered.at(-1)).toBe(900)
  expect(f.timers.size).toBe(0); expect(f.callbacks.size).toBe(1)
})

test('entrada Pie: timestamps inválidos restauran sin tragarse callbacks; traza acotada con contador total', async () => {
  for (const timestamp of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 99]) {
    const f = fixture(), delivered: number[] = []
    let receiver: unknown
    if (timestamp === 99) { f.host.requestAnimationFrame(() => undefined); f.frame(100) }
    f.host.requestAnimationFrame(function(this: PieEntranceHost, time: number) { receiver = this; delivered.push(time) })
    f.frame(timestamp, 200) // El reloj real permanece finito y monótono.
    const result = await outcome(f.clock.checkpoint())
    expect(result.ok).toBe(false); expect(result.error).toContain('finite, nondecreasing native RAF timestamps')
    expect(delivered).toHaveLength(1); expect(Object.is(delivered[0], timestamp)).toBe(true); expect(receiver).toBe(f.host)
    expect(Object.getOwnPropertyDescriptor(f.host, 'requestAnimationFrame')).toEqual(f.before.raf)
    expect(Object.getOwnPropertyDescriptor(f.host.performance, 'now')).toEqual(f.before.now)
    expect(f.host.performance.now()).toBe(200); expect(f.host.cancelAnimationFrame).toBe(f.before.cancel)
    expect(f.clock.report().entranceFrameCount).toBe(timestamp === 99 ? 1 : 0)
    expect(f.timers.size).toBe(0); expect(f.callbacks.size).toBe(0); expect(f.disconnected).toBe(1)
  }
  const f = fixture(false, { initialNow: 25, deadlineMs: 5000 }), delivered: number[] = []
  const record = (time: number): void => { delivered.push(time); f.host.requestAnimationFrame(record) }
  f.host.requestAnimationFrame(record)
  for (let frame = 1; frame <= 40; frame++) f.frame(1000 + frame)
  const report = f.clock.report()
  expect(report).toMatchObject({ phase: 'advancing', entranceFrameCount: 40, frozenTimestamp: null, firstPaths: [] })
  expect(report.entranceFrames).toHaveLength(32); expect(delivered).toHaveLength(40)
  expect(report.entranceFrames[0]).toEqual({ native: 1001, logical: 25, elapsed: 976 })
  expect(report.entranceFrames[31]).toEqual({ native: 1032, logical: 3125, elapsed: 1007 })
  expect(delivered.at(-1)).toBe(3925)
  f.setTime(2000); expect(f.host.performance.now()).toBe(3925)
  f.clock.restore(); expect(f.timers.size).toBe(0); expect(f.callbacks.size).toBe(1)
})

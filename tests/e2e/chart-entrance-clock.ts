// Reloj sólo de la fuente. Las RAF mantienen su entrega, identidad y cancelación nativas.
type Frame = (timestamp: number) => void
export interface PieEntranceHost {
  performance: { now(): number }
  requestAnimationFrame(callback: Frame): number
  cancelAnimationFrame(id: number): void
  setTimeout(callback: () => void, milliseconds: number): number
  clearTimeout(id: number): void
}
export interface PieEntranceCommit { body: object; paths: string[] }
export interface PieEntranceReport {
  phase: string
  firstPaths: string[]
  frozenTimestamp: number | null
  elapsedToCommit: number | null
  coherentPaths: string[]
  deliveriesAfterFreeze: number
  steps: Array<{ milliseconds: number; paths: string[] }>
  error?: string
}

/** Autocontenida para serializarla sin importar código de la app ni reconocer callbacks. */
export function installPieEntranceClock(
  host: PieEntranceHost,
  observe: (changed: () => void) => () => void,
  read: () => PieEntranceCommit | null,
  deadlineMs = 10_000
): { checkpoint(): Promise<PieEntranceReport>; step(milliseconds: number): Promise<void>; restore(): void; report(): PieEntranceReport } {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error('Invalid Pie entrance deadline')
  const raf = host.requestAnimationFrame.bind(host), cancel = host.cancelAnimationFrame.bind(host)
  const realNow = host.performance.now.bind(host.performance)
  const setTimer = host.setTimeout.bind(host), clearTimer = host.clearTimeout.bind(host)
  const rafDescriptor = Object.getOwnPropertyDescriptor(host, 'requestAnimationFrame')
  const nowDescriptor = Object.getOwnPropertyDescriptor(host.performance, 'now')
  const started = realNow()
  const state: PieEntranceReport = { phase: 'native', firstPaths: [], frozenTimestamp: null, elapsedToCommit: null, coherentPaths: [], deliveriesAfterFreeze: 0, steps: [] }
  let disposed = false, frozen = false, lastTimestamp: number | null = null, logicalTime = 0
  let first: PieEntranceCommit | null = null, disconnect: (() => void) | undefined
  let timer: number | undefined, frame: number | undefined, deadline = started + deadlineMs
  let readySettled = false, resolveReady!: (value: PieEntranceReport) => void, rejectReady!: (error: Error) => void
  let barrier: { kind: 'checkpoint' | 'step'; milliseconds: number; resolve(): void; reject(error: Error): void } | undefined
  const ready = new Promise<PieEntranceReport>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // El fallo puede ocurrir durante go(), antes de que el test espere el checkpoint.
  void ready.catch(() => undefined)
  const report = (): PieEntranceReport => ({ ...state, firstPaths: [...state.firstPaths], coherentPaths: [...state.coherentPaths], steps: state.steps.map(step => ({ ...step, paths: [...step.paths] })) })
  const clearWait = (): void => {
    if (timer !== undefined) { clearTimer(timer); timer = undefined }
    if (frame !== undefined) { cancel(frame); frame = undefined }
  }
  const restoreGlobals = (): void => {
    if (disposed) return
    disposed = true
    clearWait(); disconnect?.(); disconnect = undefined
    if (rafDescriptor) Object.defineProperty(host, 'requestAnimationFrame', rafDescriptor)
    else Reflect.deleteProperty(host, 'requestAnimationFrame')
    if (nowDescriptor) Object.defineProperty(host.performance, 'now', nowDescriptor)
    else Reflect.deleteProperty(host.performance, 'now')
    // Los callbacks pendientes siguen registrados con el navegador y pasan a tiempo real.
  }
  const fail = (error: Error): void => {
    state.phase = 'failed'; state.error = error.message
    const pending = barrier; barrier = undefined
    restoreGlobals()
    if (!readySettled) { readySettled = true; rejectReady(error) }
    pending?.reject(error)
  }
  const withinDeadline = (): void => {
    if (realNow() >= deadline) throw new Error(`Pie entrance exceeded its ${deadlineMs} ms wall-clock deadline`)
  }
  const armDeadline = (): void => {
    timer = setTimer(() => fail(new Error(`Pie entrance exceeded its ${deadlineMs} ms wall-clock deadline`)), deadlineMs)
  }
  const finishAfterDelivery = (): void => {
    if (!barrier || frame !== undefined || disposed) return
    // La entrega anterior usa ya el tiempo congelado; este frame observa su commit React.
    frame = raf(() => {
      frame = undefined
      try {
        withinDeadline()
        const current = read(), pending = barrier
        withinDeadline()
        if (!pending || !current || current.body !== first?.body) throw new Error('Pie entrance body changed after its first commit')
        if (pending.kind === 'checkpoint') {
          if (JSON.stringify(current.paths) !== JSON.stringify(state.firstPaths)) throw new Error('Pie first commit does not match its frozen RAF timestamp')
          state.coherentPaths = [...current.paths]; state.phase = 'ready'
          readySettled = true; clearWait(); barrier = undefined; resolveReady(report())
        } else {
          state.steps.push({ milliseconds: pending.milliseconds, paths: [...current.paths] })
          clearWait(); barrier = undefined; pending.resolve()
        }
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  const changed = (): void => {
    if (disposed || frozen) return
    try {
      withinDeadline()
      const current = read()
      withinDeadline()
      if (!current || current.paths.length === 0) return
      if (current.paths.length >= 8) throw new Error('Pie first nonempty commit is already complete; no partial entrance was captured')
      if (lastTimestamp === null) throw new Error('Pie partial commit has no preceding native RAF delivery')
      first = { body: current.body, paths: [...current.paths] }
      state.firstPaths = [...current.paths]; state.frozenTimestamp = lastTimestamp
      state.elapsedToCommit = realNow() - started; state.phase = 'frozen'
      frozen = true; logicalTime = lastTimestamp
      disconnect?.(); disconnect = undefined
      barrier = { kind: 'checkpoint', milliseconds: 0, resolve: () => undefined, reject: () => undefined }
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
  }
  try {
    Object.defineProperty(host.performance, 'now', { configurable: true, enumerable: nowDescriptor?.enumerable ?? false, writable: true, value: () => disposed || !frozen ? realNow() : logicalTime })
    Object.defineProperty(host, 'requestAnimationFrame', { configurable: true, enumerable: rafDescriptor?.enumerable ?? true, writable: true, value: (callback: Frame): number => raf(timestamp => {
      if (disposed) { callback.call(host, timestamp); return }
      lastTimestamp = timestamp
      if (frozen) state.deliveriesAfterFreeze++
      callback.call(host, frozen ? logicalTime : timestamp)
      finishAfterDelivery()
    }) })
    disconnect = observe(changed)
    armDeadline(); changed()
  } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
  return {
    checkpoint: () => ready,
    async step(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new Error('Pie clock step must be finite and positive')
      if (disposed || state.phase !== 'ready' || barrier) throw new Error('Pie clock is not ready for a step')
      logicalTime += milliseconds; deadline = realNow() + deadlineMs
      await new Promise<void>((resolve, reject) => { barrier = { kind: 'step', milliseconds, resolve, reject }; armDeadline() })
    },
    restore() {
      if (disposed) return
      const error = new Error('Pie entrance clock restored before its pending checkpoint completed')
      const pending = barrier; barrier = undefined
      state.phase = 'restored'; restoreGlobals()
      if (!readySettled) { readySettled = true; rejectReady(error) }
      pending?.reject(error)
    },
    report
  }
}

export const pieEntranceClockExpression = `(() => {
  if (window.__chartEntranceClock) throw new Error('Pie entrance clock is already installed');
  const read = () => {
    const bodies = [...document.querySelectorAll('[data-chart-export-body]')];
    if (bodies.length > 1) throw new Error('Pie entrance requires one Chart fixture');
    const body = bodies[0]; if (!body) return null;
    const paths = [...body.querySelectorAll('svg path[d]')];
    if (paths.some(path => !path.getAttribute('data-ask-part')?.startsWith('slice:')))
      throw new Error('Pie entrance found a non-sector path');
    return { body, paths: paths.map(path => path.getAttribute('d')) };
  };
  const observe = changed => {
    const observer = new MutationObserver(changed);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['d'] });
    return () => observer.disconnect();
  };
  window.__chartEntranceClock = (${installPieEntranceClock.toString()})(window, observe, read);
})()`

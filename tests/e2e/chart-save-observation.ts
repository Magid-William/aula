// Observación acotada de un guardado real; no sustituye resultados, promesas ni plazos.
import type { ElectronApplication, Page } from 'playwright/test'
import { statSync, writeFileSync } from 'node:fs'

export interface ChartSaveObservation {
  destination(path: string | null): void
  finish(): { electron: string; sourceId: number; startedAt: number; events: unknown[]; dropped: number; observerErrors: number; pendingIds: number[]; destinations: string[]; restored: boolean }
}

export async function installChartSaveObservation(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, ipcMain, dialog }) => {
    type Handler = (...args: unknown[]) => unknown
    type InvokeMap = { _invokeHandlers: Map<string, Handler> }
    const global = globalThis as unknown as { chartSaveObservation?: ChartSaveObservation }
    if (global.chartSaveObservation) throw new Error('Chart save observation already installed')
    if (process.versions.electron !== '44.9.3') throw new Error('Chart save observation requires its reviewed Electron version')
    const windows = BrowserWindow.getAllWindows()
    if (windows.length !== 1) throw new Error('Chart save observation requires one source window')
    const source = windows[0].webContents, channel = 'aula:rpc'
    const map = (ipcMain as unknown as InvokeMap)._invokeHandlers
    const sourceMap = (source.ipc as unknown as InvokeMap)._invokeHandlers
    const frameMap = (source.mainFrame.ipc as unknown as InvokeMap)._invokeHandlers
    if (!(map instanceof Map) || !(sourceMap instanceof Map) || !(frameMap instanceof Map) || sourceMap.has(channel) || frameMap.has(channel)) throw new Error('Chart save RPC ownership is not observable')
    const original = map.get(channel)
    if (typeof original !== 'function') throw new Error('Chart save RPC handler is missing')
    const originalDialog = dialog.showSaveDialog, started = performance.now()
    const events: unknown[] = [], destinations: string[] = [], pending = new Set<number>()
    let dropped = 0, observerErrors = 0, sequence = 0, selected: string | null = null, finished = false
    const record = (event: Record<string, unknown>): void => {
      try { if (events.length < 128) events.push({ milliseconds: performance.now() - started, ...event }); else dropped++ } catch { observerErrors++ }
    }
    const message = (error: unknown): string => { try { return String(error) } catch { return 'Unserializable observed error' } }
    const summary = (method: string, value: unknown): unknown => {
      const envelope = value as { ok?: boolean; error?: { code?: string; message?: string }; value?: unknown } | null
      if (!envelope || typeof envelope.ok !== 'boolean') return { invalidEnvelope: true }
      if (!envelope.ok) return { ok: false, error: { code: envelope.error?.code, message: envelope.error?.message } }
      if (method === 'figures.renderChartPng') {
        const result = envelope.value as { width?: number; height?: number; data?: { byteLength?: number } } | null
        return { ok: true, width: result?.width, height: result?.height, bytes: result?.data?.byteLength }
      }
      return { ok: true, value: envelope.value }
    }
    const wrapper: Handler = function (this: unknown, ...args: unknown[]): unknown {
      const event = args[0] as { sender?: { id?: number } }, method = args[1]
      if (event.sender?.id !== source.id || typeof method !== 'string' || !['figures.renderChartPng', 'figures.save', 'figures.cancelRender'].includes(method)) return original.apply(this, args)
      const id = ++sequence, request = args[2] as { jobId?: unknown } | undefined
      pending.add(id)
      record({ phase: 'invoke', id, method, senderId: source.id, jobId: typeof request?.jobId === 'string' ? request.jobId : undefined })
      let result: unknown
      try { result = original.apply(this, args) } catch (error) { pending.delete(id); record({ phase: 'throw', id, message: message(error) }); throw error }
      const observe = (value: unknown): void => { pending.delete(id); try { record({ phase: 'result', id, method, envelope: summary(method, value) }) } catch { observerErrors++ } }
      if (result instanceof Promise) {
        // Se devuelve la promesa original; esta rama no interviene en su resolución.
        try {
          void result.then(observe, error => { pending.delete(id); record({ phase: 'rejection', id, message: message(error) }) }).catch(() => { observerErrors++ })
        } catch { observerErrors++ }
      } else observe(result)
      return result
    }
    const mockDialog = (async (...args: unknown[]) => {
      const path = selected
      record({ phase: 'dialog', parentId: (args[0] as { id?: number } | undefined)?.id, canceled: path === null, expectedDestination: path })
      const result = { canceled: path === null, filePath: path ?? undefined }
      record({ phase: 'dialog-result', canceled: result.canceled, expectedDestination: result.filePath })
      return result
    }) as typeof dialog.showSaveDialog
    map.set(channel, wrapper)
    global.chartSaveObservation = {
      destination(path) {
        if (finished) throw new Error('Chart save observation already finished')
        selected = path
        if (path !== null && !destinations.includes(path)) destinations.push(path)
        record({ phase: 'destination', expectedDestination: path })
        dialog.showSaveDialog = mockDialog
      },
      finish() {
        const handlerOwned = map.get(channel) === wrapper, dialogOwned = dialog.showSaveDialog === mockDialog || dialog.showSaveDialog === originalDialog
        if (handlerOwned) map.set(channel, original)
        if (dialog.showSaveDialog === mockDialog) dialog.showSaveDialog = originalDialog
        finished = true
        record({ phase: 'restore', handlerOwned, dialogOwned })
        const result = { electron: process.versions.electron!, sourceId: source.id, startedAt: started, events, dropped, observerErrors, pendingIds: [...pending], destinations, restored: handlerOwned && dialogOwned }
        delete global.chartSaveObservation
        return result
      }
    }
  })
}

export async function finishChartSaveObservation(app: ElectronApplication, page: Page, output: string, failed: boolean): Promise<void> {
  // El DOM y el disco se leen al terminar el caso, fuera de la operación que se observa.
  const tail = failed ? await page.evaluate(`(() => ({
    busy: document.querySelector('[data-block="chart"] [data-figure-export]')?.getAttribute('aria-busy') ?? null,
    notices: [...document.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.textContent?.slice(0, 500)).slice(0, 10)
  }))()`).catch(error => ({ unavailable: String(error) })) : null
  const audit = await app.evaluate(() => (globalThis as unknown as { chartSaveObservation?: ChartSaveObservation }).chartSaveObservation?.finish() ?? null)
  if (!audit) throw new Error('Chart save observation is missing at cleanup')
  const files = audit.destinations.map(path => {
    try { return { path, exists: true, bytes: statSync(path).size } }
    catch (error) { return { path, exists: (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : null, error: String(error) } }
  })
  writeFileSync(output, JSON.stringify({ failed, audit, files, tail }, null, 2))
  if (!audit.restored || audit.observerErrors || audit.dropped) throw new Error('Chart save observation was incomplete or not restored')
}

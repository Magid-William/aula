// Diagnóstico de una sola figura sintética. Nunca decide la política de pintura del producto.
import type { CDPSession, ElectronApplication, Page } from 'playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'

interface Box { x: number; y: number; width: number; height: number }
interface ProcessRecord { id: number; pid: number | null; url: string; destroyed: boolean; shown: number }
interface MainResult {
  source: { id: number; pid: number }
  processes: ProcessRecord[]
  expired: boolean
  errors: string[]
  dropped: number
  buffer: { value: number; percentage: number } | null
  tracePath: string | null
  elapsedMs: number
}
interface MainObserver { finish(): Promise<MainResult> }
interface DomOwner { backendNodeId: number; nodeName: string; attributes: string[] }
interface SourceDom { glyphAncestors: DomOwner[]; nodes: number }
interface LayerEvent { layers?: unknown[] }
type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

async function sourceDom(session: CDPSession): Promise<SourceDom> {
  const response: unknown = await session.send('DOM.getDocument', { depth: -1, pierce: false })
  const root = object(response)?.root
  const ancestors = new Map<JsonObject, JsonObject[]>(), descendants = new Map<JsonObject, JsonObject[]>()
  let nodes = 0
  const visit = (value: unknown, parents: JsonObject[]): JsonObject => {
    const node = object(value)
    if (!node || ++nodes > 4096 || parents.length > 128) throw new Error('Compositor DOM inventory exceeds its bound')
    ancestors.set(node, parents)
    const children = Array.isArray(node.children) ? node.children.map(child => visit(child, [...parents, node])) : []
    descendants.set(node, children)
    return node
  }
  visit(root, [])
  const attribute = (node: JsonObject, name: string): boolean => Array.isArray(node.attributes) && node.attributes.some((value, index) => index % 2 === 0 && value === name)
  const bodies = [...ancestors.keys()].filter(node => attribute(node, 'data-chart-export-body'))
  if (bodies.length !== 1) throw new Error('Compositor source Chart is not unique')
  const text = (node: JsonObject): string => String(node.nodeValue ?? '') + (descendants.get(node) ?? []).map(text).join('')
  const glyphs = [...ancestors.keys()].filter(node => String(node.nodeName).toLowerCase() === 'text' && ancestors.get(node)!.includes(bodies[0]) && text(node) === '−7')
  if (glyphs.length !== 1) throw new Error('Compositor source glyph is not unique')
  return {
    nodes,
    glyphAncestors: [...ancestors.get(glyphs[0])!, glyphs[0]].map(node => {
      if (!Number.isSafeInteger(node.backendNodeId) || (node.backendNodeId as number) <= 0) throw new Error('Compositor DOM owner is unavailable')
      return { backendNodeId: node.backendNodeId as number, nodeName: String(node.nodeName), attributes: Array.isArray(node.attributes) ? node.attributes.filter((v): v is string => typeof v === 'string').slice(0, 64) : [] }
    })
  }
}

/** PID y eventos nativos solamente: no añade ninguna lectura/RPC al renderer privado. */
async function startTrace(app: ElectronApplication, output: string): Promise<void> {
  await app.evaluate(async ({ app: main, BrowserWindow, contentTracing }, output) => {
    const global = globalThis as unknown as { chartCompositorObservation?: MainObserver }
    if (global.chartCompositorObservation) throw new Error('Compositor observation already exists')
    if (process.versions.electron !== '44.9.3') throw new Error('Compositor observation requires reviewed Electron44.9.3')
    const windows = BrowserWindow.getAllWindows()
    if (windows.length !== 1) throw new Error('Compositor observation requires one source window')
    const source = windows[0].webContents, sourceIdentity = { id: source.id, pid: source.getOSProcessId() }
    if (sourceIdentity.pid <= 0) throw new Error('Compositor source process is missing')
    const processes: ProcessRecord[] = [], errors: string[] = [], removers: Array<() => void> = []
    const startedAt = performance.now()
    let expired = false, dropped = 0, started = false, timer: ReturnType<typeof setTimeout> | undefined
    let stopped: Promise<{ buffer: MainResult['buffer']; tracePath: string | null }> | undefined
    const created = (_event: Electron.Event, window: Electron.BrowserWindow): void => {
      if (processes.length >= 4) { dropped++; return }
      const wc = window.webContents, record: ProcessRecord = { id: wc.id, pid: null, url: '', destroyed: false, shown: 0 }
      processes.push(record)
      const loaded = (): void => {
        try { record.pid = wc.getOSProcessId(); record.url = wc.getURL() } catch (error) { errors.push(String(error)) }
      }
      const destroyed = (): void => { record.destroyed = true }
      const shown = (): void => { record.shown++ }
      wc.once('did-finish-load', loaded); wc.once('destroyed', destroyed); window.on('show', shown)
      removers.push(() => { wc.removeListener('did-finish-load', loaded); wc.removeListener('destroyed', destroyed); window.removeListener('show', shown) })
    }
    const stop = (): Promise<{ buffer: MainResult['buffer']; tracePath: string | null }> => {
      if (performance.now() - startedAt >= 25_000) expired = true
      if (stopped) return stopped
      stopped = (async () => {
        if (timer) clearTimeout(timer)
        let buffer: MainResult['buffer'] = null, tracePath: string | null = null
        try { buffer = await contentTracing.getTraceBufferUsage() } catch (error) { errors.push('buffer: ' + String(error)) }
        try { if (started) tracePath = await contentTracing.stopRecording(output) } catch (error) { errors.push('stop: ' + String(error)) }
        return { buffer, tracePath }
      })()
      return stopped
    }
    main.on('browser-window-created', created)
    global.chartCompositorObservation = {
      async finish() {
        const result = await stop()
        const elapsedMs = performance.now() - startedAt
        if (elapsedMs >= 25_000) expired = true
        main.removeListener('browser-window-created', created)
        for (const remove of removers) { try { remove() } catch (error) { errors.push('listener: ' + String(error)) } }
        delete global.chartCompositorObservation
        return { source: sourceIdentity, processes, expired, elapsedMs, errors, dropped, ...result }
      }
    }
    try {
      // El plazo incluye el ACK de inicio, no sólo el tiempo posterior a él.
      started = true
      timer = setTimeout(() => { expired = true; void stop().catch(error => { errors.push('deadline: ' + String(error)) }) }, 25_000)
      await contentTracing.startRecording({ recording_mode: 'record-until-full', trace_buffer_size_in_kb: 65536, included_categories: ['disabled-by-default-devtools.timeline.layers'], excluded_categories: ['*'] })
    } catch (error) {
      errors.push('start: ' + String(error))
      // begin(...).finish() conserva el error y cierra también esta sesión parcial.
      throw error
    }
  }, output)
}

function includesBox(quad: unknown, box: Box): boolean | null {
  if (!Array.isArray(quad) || quad.length !== 8 || !quad.every(finite)) return null
  // Sólo el cuadrilátero rectangular y sin giro de este fixture; no se usa una caja envolvente permisiva.
  const [x1, y1, x2, y2, x3, y3, x4, y4] = quad
  if (x1 !== x4 || x2 !== x3 || y1 !== y2 || y3 !== y4 || x2 <= x1 || y3 <= y1) return null
  return x1 <= box.x && y1 <= box.y && x2 >= box.x + box.width && y3 >= box.y + box.height
}

function analyzeTrace(path: string, main: MainResult, dom: SourceDom, events: LayerEvent[], glyph: Box): unknown {
  if (!existsSync(path)) return { status: 'inconclusive', reason: 'trace-file-missing' }
  const bytes = statSync(path).size
  if (bytes > 128 * 1024 * 1024) return { status: 'inconclusive', reason: 'trace-file-over128MiB', bytes }
  const data = readFileSync(path), parsed: unknown = JSON.parse(data.toString('utf8')), entries = object(parsed)?.traceEvents
  if (!Array.isArray(entries) || entries.length > 200_000) return { status: 'inconclusive', reason: 'trace-event-shape-or-count', bytes, sha256: hash(data) }
  const owners = new Set(dom.glyphAncestors.map(node => node.backendNodeId))
  const ownerByLayer = new Map<number, Set<number>>()
  for (const event of events) for (const value of event.layers ?? []) {
    const layer = object(value), id = Number(layer?.layerId), owner = layer?.backendNodeId
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(owner)) continue
    const values = ownerByLayer.get(id) ?? new Set<number>(); values.add(owner as number); ownerByLayer.set(id, values)
  }
  const privatePids = new Set(main.processes.map(p => p.pid).filter((n): n is number => n !== null && n > 0))
  const snapshots: unknown[] = [], sourceCandidates: Array<{ layer: number; owner: number; reason: string } | null> = []
  let overflow = false
  for (const entry of entries) {
    const event = object(entry)
    if (!event || event.name !== 'LayerTreeHostImpl:snapshot' || !finite(event.pid) || event.pid !== main.source.pid && !privatePids.has(event.pid)) continue
    // Los marcadores de flujo comparten nombre, pero no contienen una instantánea de capas.
    if (event.ph === 's' || event.ph === 't' || event.ph === 'f') continue
    if (snapshots.length >= 512) { overflow = true; continue }
    const snapshot = object(object(event.args)?.snapshot), tree = object(snapshot?.active_tree), layers = tree?.layers
    if (!Array.isArray(layers) || layers.length > 256) { snapshots.push({ pid: event.pid, ts: event.ts, unavailable: 'layer-shape-or-bound' }); if (event.pid === main.source.pid) sourceCandidates.push(null); continue }
    const selected = layers.map(object).filter((layer): layer is JsonObject => !!layer && typeof layer.lcd_text_disallowed_reason === 'string' && (layer.draws_content === 1 || layer.draws_content === true))
    // La propiedad reason procede de PictureLayerImpl; draws_content es el real del trace,
    // no el root falsamente marcado drawsContent=true por el protocolo LayerTree.
    const candidates = selected.filter(layer => {
      if (!Number.isSafeInteger(layer.layer_id) || !Number.isSafeInteger(layer.owner_node) || !owners.has(layer.owner_node as number)) return false
      const observed = ownerByLayer.get(layer.layer_id as number)
      return observed?.size === 1 && observed.has(layer.owner_node as number) && includesBox(layer.layer_quad, glyph) === true
    })
    if (event.pid === main.source.pid) sourceCandidates.push(candidates.length === 1 ? { layer: candidates[0].layer_id as number, owner: candidates[0].owner_node as number, reason: candidates[0].lcd_text_disallowed_reason as string } : null)
    const fields = ['layer_id', 'owner_node', 'layer_name', 'draws_content', 'layer_quad', 'bounds', 'screen_space_transform', 'contents_opaque', 'opacity', 'transform_tree_index', 'effect_tree_index', 'scroll_tree_index', 'compositing_reasons', 'lcd_text_disallowed_reason', 'ideal_contents_scale', 'geometry_contents_scale', 'tilings']
    snapshots.push({ pid: event.pid, ts: event.ts, sourceFrameNumber: tree?.source_frame_number, role: event.pid === main.source.pid ? 'source' : 'private', candidateLayerIds: event.pid === main.source.pid ? candidates.map(layer => layer.layer_id) : null, pictureLayers: selected.map(layer => Object.fromEntries(fields.filter(key => key in layer).map(key => [key, layer[key]]))) })
  }
  const first = sourceCandidates[0], stable = !!first && sourceCandidates.every(candidate => JSON.stringify(candidate) === JSON.stringify(first))
  return {
    status: !overflow && stable && main.processes.length === 1 && privatePids.size === 1 && !privatePids.has(main.source.pid) ? 'stable-source-layer-observed' : 'inconclusive',
    bytes, sha256: hash(data), totalEvents: entries.length, snapshots, overflow, sourceCandidateSnapshots: sourceCandidates.length, stableSourceCandidate: stable ? first : null,
    capturedFrameCoverage: 'Not proven: no comparison of performance.now across processes with trace.ts. Every source snapshot in the complete retained trace must agree; absence or ambiguity stays explicit.',
    privateAttribution: 'All private picture layers retained; no per-glyph private attribution is inferred from position alone.',
    causalConclusion: 'Stored PictureLayer state is not a per-glyph guarantee or a causal intervention. Diagnostic collection cannot approve an AA override or fidelity.'
  }
}

export interface ChartCompositorObservation { finish(): Promise<unknown> }
export async function beginChartCompositorObservation(app: ElectronApplication, session: CDPSession, tracePath: string, glyph: Box): Promise<ChartCompositorObservation> {
  const dom = await sourceDom(session), events: LayerEvent[] = []
  let dropped = 0, finished: Promise<unknown> | undefined
  const changed = (event: LayerEvent): void => {
    if (events.length < 128 && (!event.layers || event.layers.length <= 256)) events.push(event)
    else dropped++
  }
  session.on('LayerTree.layerTreeDidChange', changed)
  let enabled = false
  const finish = (): Promise<unknown> => {
    if (finished) return finished
    finished = (async () => {
      const cleanupErrors: string[] = []
      let main: MainResult | null = null, analysis: unknown = null
      try { main = await app.evaluate(() => (globalThis as unknown as { chartCompositorObservation?: MainObserver }).chartCompositorObservation?.finish() ?? null) }
      catch (error) { cleanupErrors.push('main: ' + String(error)) }
      try { if (enabled) await session.send('LayerTree.disable') } catch (error) { cleanupErrors.push('LayerTree: ' + String(error)) }
      session.removeListener('LayerTree.layerTreeDidChange', changed)
      try { if (main) analysis = analyzeTrace(tracePath, main, dom, events, glyph) } catch (error) { analysis = { status: 'inconclusive', reason: 'trace-parse', error: String(error) } }
      const parsed = object(analysis)
      const traceCollected = finite(parsed?.totalEvents) && Array.isArray(parsed?.snapshots) && parsed.snapshots.length > 0 && parsed.overflow === false
      const privateClosed = !!main && main.processes.length === 1 && main.processes.every(p => p.pid !== null && p.pid > 0 && p.pid !== main.source.pid && p.destroyed && p.shown === 0)
      const complete = !!main && main.tracePath === tracePath && privateClosed && traceCollected && !main.expired && !main.errors.length && !main.dropped && !dropped && !cleanupErrors.length && main.buffer !== null && main.buffer.percentage < 1
      const result = { collectionComplete: complete, dom, layerEvents: events, droppedLayerEvents: dropped, main, analysis, cleanupErrors }
      writeFileSync(tracePath + '.observation.json', JSON.stringify(result, null, 2))
      return result
    })()
    return finished
  }
  try {
    // enable programa una animación; las capturas A/B/C comprueban su efecto visible.
    enabled = true
    await session.send('LayerTree.enable')
    await startTrace(app, tracePath)
    return { finish }
  } catch (error) { await finish(); throw error }
}

/** Comparación exacta acotada, sólo entre capturas fuente; no reemplaza el oráculo del producto. */
export async function compareCompositorSourcePixels(page: Page, first: Buffer, other: Buffer, chart: Box, glyph: Box): Promise<unknown> {
  const expression = `async ({ a, b, chart, glyph }) => {
    const load = async data => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0)), bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      try {
        const context = canvas.getContext('2d', { colorSpace: 'srgb' })
        if (!context) throw new Error('Diagnostic pixel canvas unavailable')
        context.drawImage(bitmap, 0, 0)
        return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data }
      } finally { bitmap.close(); canvas.width = canvas.height = 0 }
    }
    const x = await load(a), y = await load(b)
    if (x.width !== y.width || x.height !== y.height) throw new Error('Compositor comparison dimensions changed')
    const compare = box => {
      const left = Math.floor(box.x), top = Math.floor(box.y), right = Math.ceil(box.x + box.width), bottom = Math.ceil(box.y + box.height)
      if (left < 0 || top < 0 || right > x.width || bottom > x.height) throw new Error('Compositor comparison leaves its fixed viewport')
      let changedPixels = 0, maxChannelDelta = 0
      for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) {
        const at = (py * x.width + px) * 4
        let changed = false
        for (let c = 0; c < 4; c++) { const d = Math.abs(x.data[at + c] - y.data[at + c]); changed ||= d !== 0; maxChannelDelta = Math.max(maxChannelDelta, d) }
        if (changed) changedPixels++
      }
      return { changedPixels, maxChannelDelta, rgbaEqual: changedPixels === 0 }
    }
    return { whole: compare({ x: 0, y: 0, width: x.width, height: x.height }), chart: compare(chart), glyph: compare(glyph) }
  }`
  return page.evaluate(`(${expression})(${JSON.stringify({ a: first.toString('base64'), b: other.toString('base64'), chart, glyph })})`)
}

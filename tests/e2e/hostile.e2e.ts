// A2-P1-3 en la app de verdad: un curso «compartido» trae un PDF hostil (un flujo «q Q» enorme comprimido a casi nada y repetido
// en cada página, sin `pages.json`). Abrirlo en Documentos lo leía en el proceso principal: la app se quedaba sin responder
// mientras tanto (el juez A2 midió 23,6 s con 3 páginas). Ahora lo lee el lector aparte y el proceso principal sigue contestando.
import { test, expect } from 'playwright/test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { qqBombPDF } from '../../src/main/services/ingest/testing/hostilePdf'
import { _electron as electron } from 'playwright'

type Phase = 'startup' | 'open' | 'settle'
interface WorkerState { running: number; queued: number; spawned: number; alive: boolean; broken: boolean; recycled: number }
interface GapSample { atMs: number; phase: Phase; fromPhase: Phase; gapMs: number; wallGapMs: number; processCpuMs: number; worker: WorkerState | null }
interface TimingReport {
  elapsedMs: number
  ticks: number
  maxGapMs: number
  maxWallGapMs: number
  worst: GapSample[]
  phases: Array<{ phase: Phase; atMs: number; worker: WorkerState | null }>
  worker: WorkerState | null
}
interface Probe { phase(phase: Phase): void; finish(): TimingReport }
interface ProbeGlobal { __hostileProbe: Probe; __aulaIngest?: { client: { state: WorkerState } } }


function homeWithHostileCourse(): string {
  const home = mkdtempSync(join(tmpdir(), 'aula-e2e-hostile-'))
  const demo = resolve(__dirname, '../../resources/demo-course/Packs/exam-2-math112')
  const dir = join(home, 'Packs', 'shared-course')
  cpSync(demo, dir, { recursive: true })
  const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Record<string, unknown>
  pack.id = 'shared-course'
  pack.title = 'Curso compartido'
  pack.sources = [{ id: 'notes', title: 'Lecture notes', kind: 'pdf', filename: 'notes.pdf', addedAt: '2026-10-01T00:00:00.000Z', pages: 3, characters: 1000, status: 'ready', trust: 'official', warnings: [] }]
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack))
  mkdirSync(join(dir, 'sources', 'notes'), { recursive: true })
  writeFileSync(join(dir, 'sources', 'notes', 'notes.pdf'), qqBombPDF(3, 40))
  return home
}

test('un curso importado con un PDF hostil no congela el proceso principal (ni al arrancar ni al abrirlo)', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const home = homeWithHostileCourse()
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_DEV_INGEST: '1' }
  })
  // Solo esta app, con datos sintéticos. Conserva la cola de cada stream, acotada incluso si un lector imprime mucho.
  const logLimit = 64 * 1024
  const logs = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  const seen = { stdout: 0, stderr: 0 }
  const capture = (name: keyof typeof logs) => (chunk: Buffer): void => {
    seen[name] += chunk.length
    logs[name] = Buffer.concat([logs[name], chunk.subarray(-logLimit)]).subarray(-logLimit)
  }
  const child = app.process()
  const stdout = capture('stdout'), stderr = capture('stderr')
  child.stdout?.on('data', stdout)
  child.stderr?.on('data', stderr)
  let report: TimingReport | undefined
  let ipcMs: number | undefined
  let probeInstalled = false
  try {
    // Un solo reloj monotónico desde el arranque hasta terminar: cambiar de fase NUNCA reinicia el máximo.
    // Date.now queda como diagnóstico de saltos de reloj; CPU es de todo el proceso, no solo del hilo principal.
    await app.evaluate(() => {
      const g = globalThis as unknown as ProbeGlobal
      const started = performance.now()
      let last = started, wall = Date.now(), cpu = process.cpuUsage()
      let phase: Phase = 'startup', lastPhase: Phase = 'startup'
      let ticks = 0, maxGapMs = 0, maxWallGapMs = 0
      const worst: GapSample[] = []
      const worker = (): WorkerState | null => g.__aulaIngest ? { ...g.__aulaIngest.client.state } : null
      const phases: TimingReport['phases'] = [{ phase, atMs: 0, worker: worker() }]
      const sample = (): void => {
        const now = performance.now(), nowWall = Date.now(), nowCpu = process.cpuUsage()
        const gapMs = now - last, wallGapMs = nowWall - wall
        maxGapMs = Math.max(maxGapMs, gapMs)
        maxWallGapMs = Math.max(maxWallGapMs, wallGapMs)
        worst.push({ atMs: now - started, phase, fromPhase: lastPhase, gapMs, wallGapMs, processCpuMs: (nowCpu.user - cpu.user + nowCpu.system - cpu.system) / 1000, worker: worker() })
        worst.sort((a, b) => b.gapMs - a.gapMs)
        worst.length = Math.min(worst.length, 12)
        last = now; wall = nowWall; cpu = nowCpu; lastPhase = phase
        ticks++
      }
      const timer = setInterval(sample, 50)
      timer.unref()
      g.__hostileProbe = {
        phase(next) {
          // Conserva también el último latido: un intervalo que cruza fases se mide entero.
          phase = next
          phases.push({ phase, atMs: performance.now() - started, worker: worker() })
        },
        finish() {
          sample()
          clearInterval(timer)
          return { elapsedMs: performance.now() - started, ticks, maxGapMs, maxWallGapMs, worst, phases, worker: worker() }
        }
      }
    })
    probeInstalled = true
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('nav[aria-label="Aula"]')).toBeAttached()
    await app.evaluate(() => (globalThis as unknown as ProbeGlobal).__hostileProbe.phase('open'))
    const started = performance.now()
    const envelope = await page.evaluate(() => (globalThis as unknown as { aula: { invoke(m: string, a?: unknown): Promise<unknown> } }).aula
      .invoke('documents.open', { ref: { kind: 'source', packId: 'shared-course', sourceId: 'notes' } }))
    ipcMs = performance.now() - started
    const value = envelope as { ok?: boolean; value?: { pages?: unknown[] } } | undefined
    await app.evaluate(() => (globalThis as unknown as ProbeGlobal).__hostileProbe.phase('settle'))
    // La actividad de fondo puede seguir: estos 3 s siguen dentro del límite global, pero no del tiempo del IPC.
    await page.waitForTimeout(3000)
    report = await app.evaluate(() => (globalThis as unknown as ProbeGlobal).__hostileProbe.finish())
    console.log(`[A2-P1-3] ${JSON.stringify({ ok: value?.ok, ipcMs, ...report })}`)
    expect(value?.ok).toBe(true)
    // Un PDF vacío de emergencia también devuelve ok: exige sus 3 páginas y que se leyera en un proceso vivo, sin fallback.
    expect(value?.value?.pages).toHaveLength(3)
    expect(report.worker).toMatchObject({ alive: true, broken: false })
    expect(report.worker?.spawned ?? 0).toBeGreaterThan(0)
    // Antes: unos 10 s seguidos sin responder. Mismo tope, incluyendo arranque, lectura y espera final.
    expect(report.maxGapMs).toBeLessThan(1500)
  } finally {
    if (!report && probeInstalled) {
      report = await app.evaluate(() => (globalThis as unknown as ProbeGlobal).__hostileProbe.finish()).catch(() => undefined)
    }
    try { await app.close() } finally {
      child.stdout?.off('data', stdout)
      child.stderr?.off('data', stderr)
      // El reporter de CI es «list»: los adjuntos solo en memoria no llegan a actions/upload-artifact.
      const attach = async (name: string, body: Buffer, contentType: string): Promise<void> => {
        const path = testInfo.outputPath(name)
        writeFileSync(path, body)
        await testInfo.attach(name, { path, contentType })
      }
      await attach('hostile-timing.json', Buffer.from(JSON.stringify({ ipcMs, ...report, logBytesSeen: seen, logLimit }, null, 2)), 'application/json')
      for (const name of ['stdout', 'stderr'] as const) await attach(`hostile-app-${name}.txt`, logs[name], 'text/plain')
    }
  }
})

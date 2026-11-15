// Estado comprometido de la vista real: cambios de rama y de cursor mientras una captura está pendiente.
import { test, expect, type ElectronApplication, type Locator, type Page, type TestInfo } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BlockOf } from '../../src/shared/schema/blocks'
import type { ChartRenderSceneV1 } from '../../src/shared/figuresChart'
import { CHART_FIXTURES } from './chart-fixtures'
import { assertChartReferenceInvariant, snapshotChartReference } from './chart-reference'
import { go, homeWithDemoCourse } from './helpers'

const PACK = 'exam-2-math112', SKILL = 'reference-angles'
interface CaptureAudit { scene: ChartRenderSceneV1; destroyed: boolean; shown: number; error?: string; resource?: { events: number; status: string; rejected: boolean } }
interface StateAudit { captures: CaptureAudit[]; hold: boolean; release?: () => void; failResourceOnce?: boolean }
interface Started { app: ElectronApplication; page: Page; figure: Locator; body: Locator; home: string; skillPath: string; skillBytes: string; errors: string[] }

// Clock de Playwright abarca todo el BrowserContext. Este reloj de RAF se instala sólo en la fuente;
// el renderer privado sigue recibiendo frames reales y sus deadlines no cambian.
const installEntranceClock = `(() => {
  const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
  const ownNow = Object.getOwnPropertyDescriptor(performance, 'now');
  let now = performance.now(), id = 0;
  const pending = new Map();
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  window.requestAnimationFrame = callback => { const key = --id; pending.set(key, callback); return key; };
  window.cancelAnimationFrame = key => { if (key < 0) pending.delete(key); else cancel.call(window, key); };
  window.__chartEntranceClock = {
    async step(milliseconds) {
      now += milliseconds;
      const batch = [...pending.values()]; pending.clear();
      for (const callback of batch) callback.call(window, now);
      await new Promise(resolve => raf.call(window, resolve));
    },
    restore() {
      window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel;
      if (ownNow) Object.defineProperty(performance, 'now', ownNow); else delete performance.now;
      for (const callback of pending.values()) raf.call(window, callback);
      pending.clear(); delete window.__chartEntranceClock;
    }
  };
})()`

async function start(block: BlockOf<'chart'>, entrance = false): Promise<Started> {
  const home = homeWithDemoCourse(), skillPath = join(home, 'Packs', PACK, 'skills', `${SKILL}.json`)
  const skill = JSON.parse(readFileSync(skillPath, 'utf8')); skill.lesson = [block]
  const skillBytes = JSON.stringify(skill); writeFileSync(skillPath, skillBytes)
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', theme: 'light', motion: entrance ? 'full' : 'reduced', cursor: 'system' } }))
  const progressPath = join(home, 'Packs', PACK, 'progress.json'), progress = JSON.parse(readFileSync(progressPath, 'utf8'))
  progress.settings = { ...(progress.settings ?? {}), lessonMode: 'reading' }; writeFileSync(progressPath, JSON.stringify(progress))
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-mock-keychain', '--force-device-scale-factor=1'],
    env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_NO_UPDATES: '1', AULA_NO_LOGIN_ITEM: '1' }
  })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ app: main }) => {
      const state: StateAudit = { captures: [], hold: false }; (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit = state
      main.on('browser-window-created', (_event, win) => {
        const execute = win.webContents.executeJavaScript.bind(win.webContents)
        win.webContents.executeJavaScript = (async (code: string, gesture?: boolean) => {
          const match = /^window\.aulaFigureRender\.render\(([\s\S]*)\)$/.exec(code)
          if (!match) return execute(code, gesture)
          const input = JSON.parse(match[1]) as { kind: string; scene: ChartRenderSceneV1 }
          if (input.kind !== 'chart') throw new Error('Expected Chart render input')
          const capture: CaptureAudit = { scene: input.scene, destroyed: false, shown: 0 }; state.captures.push(capture)
          win.on('show', () => capture.shown++); win.once('closed', () => { capture.destroyed = true })
          try {
            if (state.failResourceOnce) {
              state.failResourceOnce = false
              // Recurso local inexistente: la lista de assets lo deniega y Chromium emite loadingerror de verdad.
              capture.resource = await execute(`(async () => {
                let events = 0, rejected = false;
                document.fonts.addEventListener('loadingerror', () => events++);
                const face = new FontFace('Chart fixture missing font', 'url("app://aula/assets/chart-test-missing.woff2")');
                document.fonts.add(face);
                try { await document.fonts.load('12px "Chart fixture missing font"', 'x'); } catch { rejected = true; }
                await document.fonts.ready;
                return { events, status: face.status, rejected };
              })()`)
            }
            const result = await execute(code, gesture)
            if (state.hold) await new Promise<void>((resolve, reject) => {
              state.release = resolve; win.once('closed', () => reject(new Error('Held capture closed')))
            })
            return result
          } catch (error) { capture.error = String(error); throw error }
        }) as typeof win.webContents.executeJavaScript
      })
    })
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula)
    if (entrance) await page.evaluate(installEntranceClock)
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="chart"]').first(), body = figure.locator('[data-chart-export-body]')
    await expect(body).toBeVisible(); await page.evaluate('document.fonts.ready'); await page.mouse.move(8, 8)
    return { app, page, figure, body, home, skillPath, skillBytes, errors }
  } catch (error) { await app.close(); throw error }
}

async function release(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => { const state = (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit; state.hold = false; state.release?.(); delete state.release })
}
async function close(source: Started, info: TestInfo): Promise<void> {
  try {
    await source.page.evaluate('window.__chartEntranceClock?.restore()')
    await release(source.app)
    const audit = await source.app.evaluate(() => (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit.captures)
    writeFileSync(info.outputPath('chart-state-audit.json'), JSON.stringify(audit, null, 2))
  } finally { await source.app.close() }
}
async function choose(source: Started, output: string): Promise<void> {
  await source.app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog }, output)
  const button = source.figure.getByRole('button', { name: /Export figure|Exportar figura/ })
  await button.focus(); await button.press('ArrowDown')
  await source.page.getByRole('menuitem', { name: /^(Save|Guardar) PNG/ }).press('Enter')
}
async function saved(source: Started, output: string): Promise<ChartRenderSceneV1> {
  await expect.poll(() => existsSync(output), { timeout: 30_000 }).toBe(true)
  await expect(source.figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
  const png = readFileSync(output)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(png.readUInt32BE(16)).toBeGreaterThan(0); expect(png.readUInt32BE(20)).toBeGreaterThan(0)
  const captures = await source.app.evaluate(() => (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit.captures)
  const latest = captures.at(-1)!
  expect(latest).toMatchObject({ destroyed: true, shown: 0 }); expect(latest.error).toBeUndefined()
  return latest.scene
}
async function setWidth(source: Started, width: number): Promise<void> {
  await source.figure.locator('figure').evaluate((element, width) => {
    const css = element.ownerDocument.defaultView!.getComputedStyle(element)
    element.style.width = (width + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth)) + 'px'
    element.style.maxWidth = 'none'
  }, width)
  await expect(source.body.locator('svg')).toHaveAttribute('width', String(width))
}

test('Chart PNG: cambiar ancho conmuta la rama comprometida y puede volver a la original', async ({}, info) => {
  const block: BlockOf<'chart'> = { ...CHART_FIXTURES[0].block, series: [{ name: 'Responsive data', points: [
    { label: 'Cardiovascular', y: 12 }, { label: 'Respiratory', y: 7 }, { label: 'Neurological', y: 18 }
  ] }] }
  delete block.horizontal
  const source = await start(block)
  try {
    let initial: ChartRenderSceneV1 | undefined
    for (const [index, width] of [620, 180, 620].entries()) {
      await setWidth(source, width)
      const hit = source.body.locator('svg rect[fill="transparent"]').first()
      const horizontal = width === 180
      await expect.poll(async () => Number(await hit.getAttribute('width')) > Number(await hit.getAttribute('height'))).toBe(horizontal)
      const before = await snapshotChartReference(source.body)
      const paths = await source.body.locator('svg path[d]').evaluateAll(elements => elements.map(element => element.getAttribute('d')).filter(Boolean))
      const height = Number(await source.body.locator('svg').getAttribute('height'))
      const output = join(source.home, `responsive-${index}.png`)
      await choose(source, output); const scene = await saved(source, output)
      expect(scene.branch).toBe(horizontal ? 'horizontal-bars' : 'vertical-bars')
      expect(scene.canvas.width).toBe(width)
      const svg = scene.layers.find(layer => layer.kind === 'svg')!
      expect(svg.box).toMatchObject({ width, height })
      expect(svg.primitives.filter(primitive => primitive.kind === 'path').map(primitive => primitive.d)).toEqual(paths)
      assertChartReferenceInvariant(before, await snapshotChartReference(source.body))
      if (index === 0) initial = scene
      if (index === 2) expect(scene).toEqual(initial)
      await info.attach(`responsive-${index}.png`, { path: output, contentType: 'image/png' })
    }
    expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(source.errors).toEqual([])
  } finally { await close(source, info) }
})

test('Chart PNG: el cursor sigue activo mientras la captura conserva su commit anterior', async ({}, info) => {
  const source = await start(CHART_FIXTURES.find(fixture => fixture.key === 'histogram')!.block)
  try {
    await setWidth(source, 620)
    const hit = source.body.locator('svg rect[fill="transparent"]'), tip = source.body.locator('.pointer-events-none.absolute.z-10')
    await hit.nth(0).hover(); await expect(tip).toBeVisible()
    const oldText = await tip.locator('[data-chart-text]').allTextContents()
    await source.app.evaluate(() => { (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit.hold = true })
    const first = join(source.home, 'hover-at-start.png'); await choose(source, first)
    await expect.poll(() => source.app.evaluate(() => typeof (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit.release)).toBe('function')
    await expect(source.figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'true')
    await hit.nth(1).hover(); await expect(tip.locator('[data-chart-text]').last()).toHaveText('4')
    const newText = await tip.locator('[data-chart-text]').allTextContents()
    expect(newText).not.toEqual(oldText)
    const changedLive = await snapshotChartReference(source.body)
    await release(source.app); const oldScene = await saved(source, first)
    expect(oldScene.layers.filter(layer => layer.kind === 'html-text').map(layer => layer.text)).toEqual(oldText)
    assertChartReferenceInvariant(changedLive, await snapshotChartReference(source.body))
    const second = join(source.home, 'hover-next-commit.png'); await choose(source, second)
    const newScene = await saved(source, second)
    expect(newScene.layers.filter(layer => layer.kind === 'html-text').map(layer => layer.text)).toEqual(newText)
    expect(newScene.layers).not.toEqual(oldScene.layers)
    assertChartReferenceInvariant(changedLive, await snapshotChartReference(source.body))
    expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(source.errors).toEqual([])
    await info.attach('hover-at-start.png', { path: first, contentType: 'image/png' })
    await info.attach('hover-next-commit.png', { path: second, contentType: 'image/png' })
  } finally { await close(source, info) }
})

test('Chart PNG: Pie exporta el destino final y su entrada viva sigue avanzando', async ({}, info) => {
  const source = await start(CHART_FIXTURES.find(fixture => fixture.key === 'pie-side')!.block, true)
  const paths = () => source.body.locator('svg path[d]').evaluateAll(elements => elements.map(element => element.getAttribute('d')))
  const step = (milliseconds: number) => source.page.evaluate(`window.__chartEntranceClock.step(${milliseconds})`)
  try {
    await step(300)
    const partial = await paths()
    expect(partial.length).toBeGreaterThan(0); expect(partial.length).toBeLessThan(8)
    await source.app.evaluate(() => { (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit.hold = true })
    const first = join(source.home, 'pie-during-entrance.png'); await choose(source, first)
    await expect.poll(() => source.app.evaluate(() => typeof (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit.release)).toBe('function')
    // El exportador no completa ni cancela la animación de la fuente al congelar su presentación.
    expect(await paths()).toEqual(partial)
    await step(250); const continuing = await paths()
    expect(continuing).not.toEqual(partial)
    await step(2000); const finalPaths = await paths()
    expect(finalPaths).toHaveLength(8); expect(finalPaths).not.toEqual(continuing)
    await release(source.app); const earlyScene = await saved(source, first)
    const exportedPaths = (scene: ChartRenderSceneV1) => scene.layers.flatMap(layer => layer.kind === 'svg' ? layer.primitives.filter(primitive => primitive.kind === 'path').map(primitive => primitive.d) : [])
    expect(exportedPaths(earlyScene)).toEqual(finalPaths)
    const second = join(source.home, 'pie-after-entrance.png'); await choose(source, second)
    const finalScene = await saved(source, second)
    expect(exportedPaths(finalScene)).toEqual(finalPaths)
    // También la leyenda HTML y el centro conservan su presentación final, no sólo los sectores SVG.
    expect(earlyScene).toEqual(finalScene)
    expect(await paths()).toEqual(finalPaths)
    expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(source.errors).toEqual([])
    writeFileSync(info.outputPath('pie-entrance-paths.json'), JSON.stringify({ partial, continuing, finalPaths }, null, 2))
    await info.attach('pie-during-entrance.png', { path: first, contentType: 'image/png' })
    await info.attach('pie-after-entrance.png', { path: second, contentType: 'image/png' })
  } finally { await close(source, info) }
})

test('Chart PNG: un recurso privado fallido se limpia y permite reintentar', async ({}, info) => {
  const source = await start(CHART_FIXTURES[0].block)
  try {
    const before = await snapshotChartReference(source.body), progressPath = join(source.home, 'Packs', PACK, 'progress.json'), progress = readFileSync(progressPath, 'utf8')
    await source.app.evaluate(() => { (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit.failResourceOnce = true })
    const failed = join(source.home, 'failed-resource.png'); await choose(source, failed)
    await expect.poll(() => source.app.evaluate(() => (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit.captures.length)).toBe(1)
    await expect(source.figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
    await expect(source.page.getByText(/^(Could not save the drawing|No se pudo guardar el dibujo)$/)).toBeVisible()
    expect(existsSync(failed)).toBe(false)
    const captures = await source.app.evaluate(() => (globalThis as unknown as { chartStateAudit: StateAudit }).chartStateAudit.captures)
    expect(captures[0]).toMatchObject({ destroyed: true, shown: 0, resource: { status: 'error', rejected: true } })
    expect(captures[0].resource!.events).toBeGreaterThan(0); expect(captures[0].error).toContain('Drawing resource failed')
    await expect(source.page.getByText('Chart fixture missing font')).toHaveCount(0)
    const output = join(source.home, 'resource-retry.png'); await choose(source, output)
    expect(await saved(source, output)).toEqual(captures[0].scene)
    assertChartReferenceInvariant(before, await snapshotChartReference(source.body))
    expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(readFileSync(progressPath, 'utf8')).toBe(progress)
    expect(source.errors).toEqual([])
    await info.attach('resource-retry.png', { path: output, contentType: 'image/png' })
  } finally { await close(source, info) }
})

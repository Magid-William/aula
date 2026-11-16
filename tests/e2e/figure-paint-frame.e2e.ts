// Regresión de orden: la medida natural modifica transform después del primer par de RAF.
// Esto no acredita una versión del compositor; los píxeles nativos de CI se verifican por separado.
import { test, expect } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DIAGRAM_FIXTURES } from './diagram-fixtures'
import { go, homeWithDemoCourse } from './helpers'

interface ResizeTrace {
  frames: number
  callbacks: number
  lastMutationFrame: number
  framesSinceMutation: number
  mutations: Array<{ target: 'root' | 'scene'; frame: number; oldStyle: string | null; currentStyle: string | null }>
}
interface ObservedResize { value?: { width: number; height: number }; error?: string; trace: ResizeTrace }
interface WindowAudit { id: number; shown: number; destroyed: boolean; resize?: ObservedResize }
interface MainAudit { figureFrameAudit: WindowAudit[] }

// Sólo se envuelve cada callback que el producto ya pidió: no se solicitan RAF ni se crean timers.
// El código DOM viaja como texto porque los E2E usan el tsconfig Node, sin lib.dom en main/engine.
const observeResize = `async view => {
  const host = document.getElementById('root'), scene = host?.querySelector('[data-diagram-scene]');
  if (!host || !scene) throw new Error('The private Diagram scene is unavailable');
  let frames = 0, callbacks = 0, lastTimestamp, lastMutationFrame = -1;
  const mutations = [], originalRaf = window.requestAnimationFrame;
  const record = records => {
    for (const mutation of records) {
      lastMutationFrame = frames;
      mutations.push({ target: mutation.target === host ? 'root' : 'scene', frame: frames, oldStyle: mutation.oldValue, currentStyle: mutation.target.getAttribute('style') });
    }
  };
  const observer = new MutationObserver(record);
  for (const element of [host, scene]) observer.observe(element, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
  window.requestAnimationFrame = callback => originalRaf.call(window, timestamp => {
    record(observer.takeRecords());
    if (timestamp !== lastTimestamp) { frames++; lastTimestamp = timestamp; }
    callbacks++;
    callback.call(window, timestamp);
  });
  const trace = () => {
    record(observer.takeRecords());
    return { frames, callbacks, lastMutationFrame, framesSinceMutation: frames - lastMutationFrame, mutations };
  };
  try {
    const value = await window.aulaFigureRender.resize(view);
    return { value, trace: trace() };
  } catch (error) {
    return { error: String(error), trace: trace() };
  } finally {
    observer.disconnect();
    window.requestAnimationFrame = originalRaf;
  }
}`

test('Figure PNG: la última mutación de framing precede dos RAF reales', async ({}, info) => {
  const home = homeWithDemoCourse(), pack = 'exam-2-math112', skillId = 'reference-angles'
  const skillPath = join(home, 'Packs', pack, 'skills', `${skillId}.json`), skill = JSON.parse(readFileSync(skillPath, 'utf8'))
  skill.lesson = [DIAGRAM_FIXTURES.find(fixture => fixture.key === 'flow')!.block]
  const skillBytes = JSON.stringify(skill); writeFileSync(skillPath, skillBytes)
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', theme: 'light', motion: 'reduced', cursor: 'system' } }))
  const progressPath = join(home, 'Packs', pack, 'progress.json'), progress = JSON.parse(readFileSync(progressPath, 'utf8'))
  progress.settings = { ...(progress.settings ?? {}), lessonMode: 'reading' }; writeFileSync(progressPath, JSON.stringify(progress))
  const output = join(home, 'figure-framing.png')
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-mock-keychain', '--force-device-scale-factor=1'],
    env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_NO_UPDATES: '1', AULA_NO_LOGIN_ITEM: '1' }
  })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ app: main, dialog }, { output, observeResize }) => {
      const state = globalThis as unknown as MainAudit; state.figureFrameAudit = []
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: output })) as typeof dialog.showSaveDialog
      main.on('browser-window-created', (_event, win) => {
        const audit: WindowAudit = { id: win.id, shown: 0, destroyed: false }; state.figureFrameAudit.push(audit)
        win.on('show', () => audit.shown++); win.once('closed', () => { audit.destroyed = true })
        const execute = win.webContents.executeJavaScript.bind(win.webContents)
        win.webContents.executeJavaScript = (async (code: string, gesture?: boolean) => {
          const match = /^window\.aulaFigureRender\.resize\(([\s\S]*)\)$/.exec(code)
          if (!match) return execute(code, gesture)
          // El argumento procede del protocolo privado validado; el wrapper devuelve el mismo valor al producto.
          const observed = await execute(`(${observeResize})(${match[1]})`, gesture) as ObservedResize
          audit.resize = observed
          if (observed.error) throw new Error(observed.error)
          return observed.value
        }) as typeof win.webContents.executeJavaScript
      })
    }, { output, observeResize })
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula)
    await go(page, { name: 'study', id: pack, mode: 'learn', skill: skillId })
    const figure = page.locator('[data-block="diagram"]').first()
    await expect(figure.locator('[data-diagram-canvas]')).toBeVisible(); await page.evaluate('document.fonts.ready')
    const beforeProgress = readFileSync(progressPath, 'utf8')
    const action = figure.getByRole('button', { name: /Export figure|Exportar figura/ })
    await action.focus(); await action.press('ArrowDown')
    await page.getByRole('menuitem', { name: /^(Save|Guardar) PNG/ }).press('Enter')
    await expect.poll(() => existsSync(output), { timeout: 30_000 }).toBe(true)
    await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
    const audits = await app.evaluate(() => (globalThis as unknown as MainAudit).figureFrameAudit)
    const captures = audits.filter(audit => audit.resize)
    expect(captures).toHaveLength(1)
    const capture = captures[0], trace = capture.resize!.trace
    expect(capture.resize!.error).toBeUndefined(); expect(capture.destroyed).toBe(true); expect(capture.shown).toBe(0)
    expect(trace.mutations.some(mutation => mutation.target === 'root')).toBe(true)
    // El oldStyle de la restauración prueba que se recorrió la medida natural, no sólo el primer resize.
    expect(trace.mutations.some(mutation => mutation.target === 'scene' && /transform:\s*none\s*!important/.test(mutation.oldStyle ?? ''))).toBe(true)
    expect(trace.lastMutationFrame).toBeGreaterThanOrEqual(0)
    expect(trace.framesSinceMutation, 'resize resolvió sin dos RAF posteriores a la última mutación visual').toBeGreaterThanOrEqual(2)
    expect(trace.callbacks).toBeGreaterThanOrEqual(trace.frames)
    expect(readFileSync(skillPath, 'utf8')).toBe(skillBytes); expect(readFileSync(progressPath, 'utf8')).toBe(beforeProgress)
    expect(errors).toEqual([])
    await info.attach('figure-framing.png', { path: output, contentType: 'image/png' })
  } finally {
    try {
      const audit = await app.evaluate(() => (globalThis as unknown as MainAudit).figureFrameAudit).catch(error => ({ unavailable: String(error) }))
      writeFileSync(info.outputPath('figure-framing-audit.json'), JSON.stringify(audit, null, 2))
    } finally { await app.close() }
  }
})

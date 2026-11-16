// Chart completo: referencia DOM/píxeles del producto vivo, independiente de la escena privada.
import { test, expect, type CDPSession, type ElectronApplication, type Locator, type Page, type TestInfo } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { ChartRenderSceneV1 } from '../../src/shared/figuresChart'
import type { FigureRenderInput } from '../../src/shared/figuresRender'
import { CHART_FIXTURES, type ChartFixture } from './chart-fixtures'
import { waitForPieHover } from './chart-hover-readiness'
import { compareDiagramPixels } from './diagram-pixels'
import { assertChartCaptureInvariant, assertChartReferenceInvariant, assertNativeChartContext, canonicalizeChartReference, captureChartReference, chartReferenceGeometryTolerance, initializeChartReference, requireContainedChartClip, setChartReferencePageZoom, snapshotChartReference } from './chart-reference'
import { assertChartRasterConsistency, compareChartRasterConsistency, type ChartRasterConsistency } from './chart-raster-consistency'
import { go, homeWithDemoCourse } from './helpers'

const PACK = 'exam-2-math112', SKILL = 'reference-angles'
interface Audit { id: number; shown: number; destroyed: boolean; defaultSession: boolean; calls: Array<{ method: string; input?: unknown; result?: unknown; error?: string }>; isolation?: unknown }
interface MainAudit { chartAudit: Audit[]; holdChart?: boolean; releaseChart?: () => void }
const pngHash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

async function closeWithAudit(app: ElectronApplication, info: TestInfo): Promise<void> {
  try {
    const audit = await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit).catch(error => ({ unavailable: String(error) }))
    writeFileSync(info.outputPath('final-audit.json'), JSON.stringify(audit, null, 2))
  } finally { await app.close() }
}

function prepare(fixture: ChartFixture, theme: 'light' | 'dark'): { home: string; skillPath: string; skillBytes: string } {
  const home = homeWithDemoCourse()
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: theme === 'light' ? 'en' : 'es', theme, motion: 'reduced', cursor: 'system' } }))
  const dir = join(home, 'Packs', PACK, 'skills')
  let skillPath = ''
  for (const file of readdirSync(dir)) {
    const path = join(dir, file), skill = JSON.parse(readFileSync(path, 'utf8'))
    if (skill.id === SKILL) { skill.lesson = [fixture.block]; skillPath = path }
    writeFileSync(path, JSON.stringify(skill))
  }
  if (!skillPath) throw new Error('The fixture skill is unavailable')
  const progressPath = join(home, 'Packs', PACK, 'progress.json'), progress = JSON.parse(readFileSync(progressPath, 'utf8'))
  progress.settings = { ...(progress.settings ?? {}), lessonMode: 'reading' }
  writeFileSync(progressPath, JSON.stringify(progress))
  return { home, skillPath, skillBytes: readFileSync(skillPath, 'utf8') }
}

async function start(home: string, dpr2: boolean, pageZoom = 1, nativeViewport = false): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const sourceDpr = dpr2 ? 2 : 1
  const app = await electron.launch({ args: [resolve(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-mock-keychain', `--force-device-scale-factor=${sourceDpr}`], env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_NO_UPDATES: '1', AULA_NO_LOGIN_ITEM: '1' } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ app: main, session }) => {
      const state = globalThis as unknown as MainAudit; state.chartAudit = []
      main.on('browser-window-created', (_event, window) => {
        const wc = window.webContents
        const audit: Audit = { id: wc.id, shown: 0, destroyed: false, defaultSession: wc.session === session.defaultSession, calls: [] }
        state.chartAudit.push(audit)
        window.on('show', () => { audit.shown++ }); wc.once('destroyed', () => { audit.destroyed = true })
        const execute = wc.executeJavaScript.bind(wc)
        wc.executeJavaScript = (async (code: string, gesture?: boolean) => {
          const match = /^window\.aulaFigureRender\.(render|resize|normalize)\(([\s\S]*)\)$/.exec(code)
          if (!match) return execute(code, gesture)
          const method = match[1], input = JSON.parse(match[2]) as Record<string, unknown>
          const call: Audit['calls'][number] = { method, input: method === 'normalize' ? { width: input.width, height: input.height } : input }
          audit.calls.push(call)
          try {
            const result = await execute(code, gesture)
            call.result = method === 'normalize' ? { width: result.width, height: result.height } : result
            if (method === 'render') {
              audit.isolation = await execute(`(()=>{const root=document.querySelector('[data-chart-scene]'),css=getComputedStyle(root);return{bridge:'aula' in globalThis,node:typeof require!=='undefined'||typeof process!=='undefined',links:document.querySelectorAll('a[href]').length,images:document.querySelectorAll('img[src]').length,frames:document.querySelectorAll('iframe,object,embed').length,text:root.textContent,context:{family:css.fontFamily,style:css.fontStyle,direction:css.direction,language:root.lang}}})()`)
              if (state.holdChart) await new Promise<void>((resolve, reject) => { state.releaseChart = resolve; wc.once('destroyed', () => reject(new Error('Fixture chart capture cancelled'))) })
            }
            return result
          } catch (error) { call.error = String(error); throw error }
        }) as typeof wc.executeJavaScript
      })
    })
    await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula)
    await assertNativeChartContext(app, page, sourceDpr)
    if (nativeViewport) {
      // Sólo el diagnóstico de raster: ningún override de Playwright/CDP antes de su control nativo.
      if (pageZoom !== 1) throw new Error('Native raster diagnostic requires page zoom one')
      await app.evaluate(({ BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows()
        if (windows.length !== 1) throw new Error('Native raster diagnostic requires its single source window')
        windows[0].setContentSize(1440, 1100)
      })
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const actual = await app.evaluate(({ BrowserWindow }) => {
        const bounds = BrowserWindow.getAllWindows()[0].getContentBounds()
        return { width: bounds.width, height: bounds.height }
      })
      if (![actual.width, actual.height].every(n => Number.isInteger(n) && n > 0 && n <= 4096)) throw new Error('Native diagnostic viewport is invalid: ' + JSON.stringify(actual))
      await expect.poll(() => page.evaluate('({width:innerWidth,height:innerHeight})'), { timeout: 5000 }).toEqual(actual)
    } else {
      await page.setViewportSize({ width: 1440, height: 1100 })
      await initializeChartReference(page, sourceDpr)
    }
    if (pageZoom !== 1) await setChartReferencePageZoom(app, page, pageZoom)
    return { app, page, errors }
  } catch (error) { await app.close().catch(() => undefined); throw error }
}

async function evaluateElement<R>(target: Locator, expression: string): Promise<R> {
  const key = `__aulaChartOracle_${randomUUID()}`
  await target.evaluate((element, key) => { (globalThis as unknown as Record<string, unknown>)[key] = element }, key)
  try { return await target.page().evaluate<R>(`(${expression})(globalThis[${JSON.stringify(key)}])`) }
  finally { await target.page().evaluate(key => { delete (globalThis as unknown as Record<string, unknown>)[key] }, key) }
}

const action = (figure: Locator): Locator => figure.getByRole('button', { name: /Export figure|Exportar figura/ })
async function destination(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: path === null, filePath: path ?? undefined })) as typeof dialog.showSaveDialog }, path)
}
async function save(app: ElectronApplication, page: Page, figure: Locator, path: string, expectedText?: string): Promise<void> {
  await destination(app, path)
  await action(figure).focus(); await action(figure).press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: /^(Save|Guardar) SVG/ })).toHaveCount(0)
  const png = page.getByRole('menuitem', { name: /^(Save|Guardar) PNG/ })
  if (expectedText !== undefined) await expect(figure.locator('[data-chart-export-body]')).toHaveText(expectedText)
  await expect(png).toBeFocused(); await png.press('Enter')
  await expect.poll(() => existsSync(path), { timeout: 30_000 }).toBe(true)
  await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
}
async function inspect(page: Page, path: string, info: TestInfo, name: string): Promise<void> {
  const png = readFileSync(path), width = png.readUInt32BE(16), height = png.readUInt32BE(20), chunks: string[] = []
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(Math.min(width, height)).toBeGreaterThan(0); expect(Math.max(width, height)).toBeLessThanOrEqual(4096); expect(width * height).toBeLessThanOrEqual(16 * 1024 * 1024)
  for (let at = 8; at < png.length;) { const size = png.readUInt32BE(at); chunks.push(png.toString('ascii', at + 4, at + 8)); at += 12 + size }
  expect(chunks.some(c => ['iCCP', 'tEXt', 'zTXt', 'iTXt', 'acTL'].includes(c))).toBe(false)
  const opaque = await page.evaluate<boolean>(`(async()=>{const i=new Image();i.src='data:image/png;base64,${png.toString('base64')}';await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);const p=x.getImageData(0,0,c.width,c.height).data;for(let n=3;n<p.length;n+=4)if(p[n]!==255)return false;return true;})()`)
  expect(opaque).toBe(true); await info.attach(`${name}.png`, { path, contentType: 'image/png' })
}
async function sameExportRaster(page: Page, original: Buffer, repeated: Buffer, paper: number[], info: TestInfo, name: string): Promise<void> {
  const hashes = { original: pngHash(original), repeated: pngHash(repeated) }
  let comparison: ChartRasterConsistency | undefined
  if (hashes.original !== hashes.repeated) {
    comparison = await page.evaluate<ChartRasterConsistency>(`(async()=>{
      const decode=async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});if(!context)throw new Error('PNG decoder unavailable');context.drawImage(image,0,0);const raster={width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data};canvas.width=canvas.height=0;return raster;};
      return (${compareChartRasterConsistency.toString()})(await decode('${original.toString('base64')}'),await decode('${repeated.toString('base64')}'),${JSON.stringify(paper)});
    })()`)
  }
  writeFileSync(info.outputPath(`${name}-consistency.json`), JSON.stringify({ hashes, byteIdentical: hashes.original === hashes.repeated, comparison }, null, 2))
  if (comparison) assertChartRasterConsistency(comparison)
}
async function capture(app: ElectronApplication, page: Page, figure: Locator, home: string, info: TestInfo, name: string): Promise<ChartRenderSceneV1> {
  const body = figure.locator('[data-chart-export-body]'), path = join(home, `${name}.png`)
  const context = await evaluateElement<unknown>(body, `root=>{const css=getComputedStyle(root);return{family:css.fontFamily,style:css.fontStyle,direction:css.direction,language:root.closest('[lang]')?.getAttribute('lang')||document.documentElement.lang||'en'}}`)
  const expectedText = await body.textContent() ?? ''
  await save(app, page, figure, path, expectedText); await inspect(page, path, info, name)
  const originalAudits = await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit)
  const original = originalAudits.at(-1)!.calls.find(c => c.method === 'render')?.input as FigureRenderInput
  expect(original?.kind).toBe('chart')
  if (original.kind !== 'chart') throw new Error('Expected Chart render input')
  // La fase de píxel global cambia el hinting vivo: el PNG natural y el DTO deben ser invariantes.
  const placement = await canonicalizeChartReference(body)
  try {
    const reference = await captureChartReference(body, info, name), canonicalPath = join(home, `${name}-canonical.png`)
    await save(app, page, figure, canonicalPath, expectedText)
    const audits = await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit)
    const canonical = audits.at(-1)!.calls.find(c => c.method === 'render')?.input as FigureRenderInput
    writeFileSync(info.outputPath(`${name}-audit.json`), JSON.stringify(audits, null, 2))
    await info.attach(`${name}-canonical.png`, { path: canonicalPath, contentType: 'image/png' })
    expect(canonical?.kind).toBe('chart')
    if (canonical.kind !== 'chart') throw new Error('Expected repeated Chart render input')
    const geometryTolerance = chartReferenceGeometryTolerance(placement.before, placement.after)
    expect(canonical.scene.layers).toHaveLength(original.scene.layers.length)
    const layers = canonical.scene.layers.map((layer, i) => {
      const box = original.scene.layers[i].box
      for (const field of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(layer.box[field] - box[field]), `${name} layer ${i} box.${field}`).toBeLessThanOrEqual(geometryTolerance.box[field])
      return { ...layer, box }
    })
    // Sólo estas cajas proceden de BCR Float32; primitivas, textos, estilos, métricas y canvas siguen exactos.
    expect({ ...canonical, scene: { ...canonical.scene, layers } }).toEqual(original)
    await sameExportRaster(page, readFileSync(path), readFileSync(canonicalPath), reference.geometry.background, info, name)
    writeFileSync(info.outputPath(`${name}-placement.json`), JSON.stringify({ before: placement.before, after: placement.after, displacement: placement.displacement, target: placement.target, quantum: placement.quantum, residual: placement.residual, method: placement.method, geometryTolerance }, null, 2))
    await compareDiagramPixels(page, reference.png, readFileSync(path), reference.geometry, info, name, 'dense')
    for (const audit of [originalAudits.at(-1)!, audits.at(-1)!]) {
      expect(audit.shown).toBe(0); expect(audit.destroyed).toBe(true); expect(audit.defaultSession).toBe(false)
      expect(audit.isolation).toMatchObject({ bridge: false, node: false, links: 0, images: 0, frames: 0, context })
    }
    expect(JSON.stringify(original.scene)).not.toContain('PRIVATE_')
    expect(JSON.stringify(original.scene)).not.toContain('FOLDED_AWAY_')
    expect(JSON.stringify(original.scene)).not.toContain('UNPAINTED_')
    return original.scene
  } finally { await placement.restore() }
}

async function hoverData(page: Page, body: Locator, fixture: ChartFixture): Promise<boolean> {
  if (fixture.branch === 'empty' || fixture.key === 'pie-no-positive') return false
  if (fixture.branch === 'donut') {
    // Una zona pintada del sector conserva el foco sin quedar tapada por el menú de la esquina superior.
    const point = await evaluateElement<{ x: number; y: number }>(body.locator('svg path').first(), `path=>{
      const b=path.getBBox(),m=path.getScreenCTM();if(!m)throw new Error('The live sector transform is unavailable');
      for(let row=18;row>1;row--)for(let col=2;col<19;col++){
        const x=b.x+b.width*col/20,y=b.y+b.height*row/20;
        if([[0,0],[-2,0],[2,0],[0,-2],[0,2]].every(([dx,dy])=>path.isPointInFill(new DOMPoint(x+dx,y+dy)))){const p=new DOMPoint(x,y).matrixTransform(m);return{x:p.x,y:p.y};}
      }
      throw new Error('No painted interior point found for the live sector');
    }`)
    await page.mouse.move(point.x, point.y)
  }
  else if (fixture.branch === 'vertical-bars' || fixture.branch === 'horizontal-bars') await body.locator('svg rect[fill="transparent"]').first().hover()
  else {
    const point = await body.locator('svg circle').first().boundingBox()
    if (!point) throw new Error('The reference point is unavailable')
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2)
  }
  if (fixture.branch !== 'donut') await expect(body.locator('.pointer-events-none.absolute.z-10')).toHaveCount(1)
  await page.waitForTimeout(300)
  if (fixture.branch === 'donut') await waitForPieHover(body)
  return true
}

async function choosePng(page: Page, figure: Locator): Promise<void> {
  await action(figure).focus(); await action(figure).press('ArrowDown')
  await page.getByRole('menuitem', { name: /^(Save|Guardar) PNG/ }).press('Enter')
}
async function releaseCapture(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => { const state = globalThis as unknown as MainAudit; state.holdChart = false; state.releaseChart?.(); delete state.releaseChart })
}

test('Chart PNG: cancelar navegación y diálogo permite reintentar sin cambiar datos', async ({}, info) => {
  const fixture = CHART_FIXTURES[0], source = prepare(fixture, 'light'), { app, page, errors } = await start(source.home, false)
  const canceled = join(source.home, 'canceled.png')
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="chart"]').first()
    await expect(figure.locator('[data-chart-export-body]')).toBeVisible(); await page.evaluate('document.fonts.ready')
    await destination(app, canceled)
    await app.evaluate(() => { (globalThis as unknown as MainAudit).holdChart = true })
    await choosePng(page, figure)
    await expect.poll(() => app.evaluate(() => typeof (globalThis as unknown as MainAudit).releaseChart === 'function')).toBe(true)
    await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'true')
    const busy = figure.locator('[data-figure-export] button')
    await expect(busy).toHaveAttribute('aria-disabled', 'true'); await busy.press('ArrowDown')
    await expect(page.getByRole('menuitem')).toHaveCount(0)
    await go(page, { name: 'home' })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(existsSync(canceled)).toBe(false); await releaseCapture(app)

    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    await expect(figure.locator('[data-chart-export-body]')).toBeVisible(); await page.evaluate('document.fonts.ready')
    const progressPath = join(source.home, 'Packs', PACK, 'progress.json'), before = readFileSync(progressPath, 'utf8')
    await destination(app, null); await choosePng(page, figure)
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit.length)).toBe(2)
    await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false'); await expect(action(figure)).toBeFocused()
    expect(readFileSync(progressPath, 'utf8')).toBe(before); expect(existsSync(canceled)).toBe(false)
    const path = join(source.home, 'retry-after-cancel.png')
    await save(app, page, figure, path); await inspect(page, path, info, 'retry-after-cancel')
    const audit = await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit)
    expect(audit).toHaveLength(3); expect(audit.every(a => a.destroyed && a.shown === 0 && !a.defaultSession)).toBe(true)
    expect(readFileSync(progressPath, 'utf8')).toBe(before); expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(errors).toEqual([])
  } finally {
    try { await releaseCapture(app); writeFileSync(info.outputPath('lifecycle-audit.json'), JSON.stringify(await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit), null, 2)) }
    finally { await app.close() }
  }
})

test('Chart PNG: un error real limpia la captura y permite reintentar la misma escena', async ({}, info) => {
  const source = prepare(CHART_FIXTURES[0], 'dark'), { app, page, errors } = await start(source.home, true)
  const path = join(source.home, 'retry-after-render-error.png'), marker = 'PRIVATE_CHART_RENDER_FAILURE'
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="chart"]').first()
    await expect(figure.locator('[data-chart-export-body]')).toBeVisible(); await page.evaluate('document.fonts.ready')
    await app.evaluate(({ app: main }, marker) => {
      let armed = true
      main.on('browser-window-created', (_event, window) => {
        const wc = window.webContents, execute = wc.executeJavaScript.bind(wc)
        wc.executeJavaScript = (async (code: string, gesture?: boolean) => {
          const result = await execute(code, gesture)
          // El renderer y su validación se ejecutan de verdad; sólo se rechaza su primer resultado.
          if (armed && code.startsWith('window.aulaFigureRender.render(')) { armed = false; throw new Error(marker) }
          return result
        }) as typeof wc.executeJavaScript
      })
    }, marker)
    const progressPath = join(source.home, 'Packs', PACK, 'progress.json'), before = readFileSync(progressPath, 'utf8')
    await destination(app, path); await choosePng(page, figure)
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit.length)).toBe(1)
    await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByText('No se pudo guardar el dibujo', { exact: true })).toBeVisible()
    await expect(page.getByText(marker)).toHaveCount(0); expect(existsSync(path)).toBe(false)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await save(app, page, figure, path); await inspect(page, path, info, 'retry-after-render-error')
    const audit = await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit)
    expect(audit).toHaveLength(2); expect(audit.every(a => a.destroyed && a.shown === 0 && !a.defaultSession)).toBe(true)
    expect(audit[1].calls.find(c => c.method === 'render')?.input).toEqual(audit[0].calls.find(c => c.method === 'render')?.input)
    expect(readFileSync(progressPath, 'utf8')).toBe(before); expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(errors).toEqual([])
    writeFileSync(info.outputPath('render-error-audit.json'), JSON.stringify(audit, null, 2))
  } finally { await closeWithAudit(app, info) }
})

test('Chart PNG: cuatro fases subpíxel externas producen la misma escena e imagen', async ({}, info) => {
  const fixture = CHART_FIXTURES.find(f => f.key === 'histogram')!, source = prepare(fixture, 'light'), { app, page, errors } = await start(source.home, false)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="chart"]').first(), body = figure.locator('[data-chart-export-body]')
    await expect(body).toBeVisible(); await page.evaluate('document.fonts.ready'); await page.waitForTimeout(300)
    await hoverData(page, body, fixture)
    const original = await snapshotChartReference(body), originalStyle = await body.getAttribute('style')
    let expectedInput: unknown, expectedPng: Buffer | undefined
    try {
      for (const phase of [0, .25, .5, .75]) {
        const left = (Math.floor(original.body.box.x) + phase - original.body.box.x) / original.body.scaleX
        const top = (Math.floor(original.body.box.y) + phase - original.body.box.y) / original.body.scaleY
        await evaluateElement<void>(body, `root=>{root.style.position='relative';root.style.left='${left}px';root.style.top='${top}px'}`)
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        assertChartReferenceInvariant(original, await snapshotChartReference(body))
        const path = join(source.home, `external-phase-${phase}.png`)
        await save(app, page, figure, path, await body.textContent() ?? '')
        const audit = await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit), current = audit.at(-1)!
        const input = current.calls.find(c => c.method === 'render')?.input, png = readFileSync(path)
        if (expectedPng) { expect(input).toEqual(expectedInput); expect(pngHash(png)).toBe(pngHash(expectedPng)) }
        else { expectedInput = input; expectedPng = png; await inspect(page, path, info, 'external-phase-reference') }
        expect(current.destroyed).toBe(true); expect(current.shown).toBe(0)
        writeFileSync(info.outputPath(`phase-${phase}.json`), JSON.stringify({ snapshot: await snapshotChartReference(body), audit: current }, null, 2))
      }
    } finally {
      await body.evaluate((root, style) => { if (style === null) root.removeAttribute('style'); else root.setAttribute('style', style) }, originalStyle)
    }
    expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(errors).toEqual([])
  } finally { await closeWithAudit(app, info) }
})

for (const variant of [
  { key: 'academic', theme: 'academic', layout: 'content' as const, font: 'serif', italic: false, dpr2: false, pageZoom: 1 },
  { key: 'chalk', theme: 'chalk', layout: 'content' as const, font: 'rounded', italic: false, dpr2: false, pageZoom: 1 },
  { key: 'quote', theme: 'aula', layout: 'quote' as const, font: 'serif', italic: true, dpr2: false, pageZoom: 1 },
  ...[false, true].flatMap(dpr2 => [{ label: 'in', factor: 1.2 }, { label: 'out', factor: 5 / 6 }].map(zoom => ({
    key: `academic-page-zoom-${zoom.label}-dpr${dpr2 ? 2 : 1}`, theme: 'academic', layout: 'content' as const,
    font: 'serif', italic: false, dpr2, pageZoom: zoom.factor
  })))
]) test(`Chart PNG: tipografía de Slides reales ${variant.key}`, async ({}, info) => {
  const fixture = CHART_FIXTURES[0], source = prepare(fixture, 'light')
  // Quote reserva menos altura; esta prueba de fuentes usa una serie que cabe completa.
  const block = variant.key === 'quote' ? { ...fixture.block, series: fixture.block.series.slice(0, 1) } : fixture.block
  const slide: import('../../src/shared/schema/cards').Slide = { id: `slide-${variant.key}`, layout: variant.layout, blocks: [block], right: [] }
  const skill = JSON.parse(source.skillBytes)
  skill.lesson = [{ id: `deck-${variant.key}`, type: 'slides', theme: variant.theme, transition: 'none', slides: [slide] }]
  source.skillBytes = JSON.stringify(skill); writeFileSync(source.skillPath, source.skillBytes)
  const { app, page, errors } = await start(source.home, variant.dpr2, variant.pageZoom)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="chart"]').first(), body = figure.locator('[data-chart-export-body]')
    await expect(body).toBeVisible(); await body.scrollIntoViewIfNeeded(); await page.mouse.move(8, 8)
    await page.evaluate('document.fonts.ready'); await page.waitForTimeout(300)
    const progressPath = join(source.home, 'Packs', PACK, 'progress.json'), before = readFileSync(progressPath, 'utf8')
    const scene = await capture(app, page, figure, source.home, info, `slide-${variant.key}`)
    expect(scene.metrics).toMatchObject({ bodyFont: variant.font, bodyItalic: variant.italic })
    expect(scene.metrics.cssZoom).toBeGreaterThan(1)
    expect(readFileSync(progressPath, 'utf8')).toBe(before); expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(errors).toEqual([])
  } finally { await closeWithAudit(app, info) }
})

test('Chart PNG: exporta el cuerpo completo aunque Slides recorte su viewport', async ({}, info) => {
  const source = prepare(CHART_FIXTURES[0], 'light'), skill = JSON.parse(source.skillBytes)
  skill.lesson = [{ id: 'clipped-chart-deck', type: 'slides', theme: 'aula', transition: 'none', slides: [{ id: 'clipped-chart-slide', layout: 'quote', blocks: [CHART_FIXTURES[0].block], right: [] }] }]
  source.skillBytes = JSON.stringify(skill); writeFileSync(source.skillPath, source.skillBytes)
  const { app, page, errors } = await start(source.home, false)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="chart"]').first(), body = figure.locator('[data-chart-export-body]')
    await expect(body).toBeVisible(); await page.evaluate('document.fonts.ready'); await page.waitForTimeout(300)
    const before = await snapshotChartReference(body), path = join(source.home, 'clipped-viewport.png')
    const clippedBy = await evaluateElement<number>(body, `root=>{const box=root.getBoundingClientRect();let count=0;for(let at=root.parentElement;at;at=at.parentElement){const c=getComputedStyle(at),b=at.getBoundingClientRect();if(['hidden','clip'].includes(c.overflowY)&&(box.top<b.top-.01||box.bottom>b.bottom+.01))count++;}return count;}`)
    expect(clippedBy).toBeGreaterThan(0)
    await save(app, page, figure, path); await inspect(page, path, info, 'clipped-viewport')
    const clippedInput = await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit.at(-1)!.calls.find(c => c.method === 'render')!.input as FigureRenderInput)
    expect(clippedInput.kind).toBe('chart')
    if (clippedInput.kind !== 'chart') throw new Error('Expected Chart render input')
    // Sólo se revela el recorte exterior para observar todo el cuerpo. El layout y el contenido no cambian.
    await evaluateElement<void>(body, `root=>{
      if(root.__chartOuterClip)throw new Error('Outer clipping fixture already active');
      const values=[];root.__chartOuterClip=values;
      for(let at=root.parentElement;at;at=at.parentElement){const css=getComputedStyle(at);if(['hidden','clip'].includes(css.overflowX)||['hidden','clip'].includes(css.overflowY)){values.push({node:at,style:at.getAttribute('style')});at.style.setProperty('overflow','visible','important');}}
    }`)
    try {
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      assertChartReferenceInvariant(before, await snapshotChartReference(body))
      const complete = await capture(app, page, figure, source.home, info, 'revealed-full-body')
      expect(complete).toEqual(clippedInput.scene)
      const paper = await evaluateElement<number[]>(body, `root=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');c.fillStyle=getComputedStyle(root.closest('figure')).backgroundColor;c.fillRect(0,0,1,1);return Array.from(c.getImageData(0,0,1,1).data).slice(0,3);}`)
      await sameExportRaster(page, readFileSync(path), readFileSync(join(source.home, 'revealed-full-body.png')), paper, info, 'outer-clipping-invariance')
    } finally {
      await evaluateElement<void>(body, `root=>{const values=root.__chartOuterClip||[];delete root.__chartOuterClip;for(const{node,style}of values){if(style===null)node.removeAttribute('style');else node.setAttribute('style',style);}}`)
    }
    expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(errors).toEqual([])
  } finally { await closeWithAudit(app, info) }
})

for (const variant of [{ theme: 'light' as const, dpr2: true }, { theme: 'dark' as const, dpr2: false }])
  test(`Chart PNG: tema ${variant.theme} independiente de DPR ${variant.dpr2 ? 2 : 1}`, async ({}, info) => {
    const fixture = CHART_FIXTURES.find(f => f.key === 'histogram')!, source = prepare(fixture, variant.theme)
    const { app, page, errors } = await start(source.home, variant.dpr2)
    try {
      await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
      const figure = page.locator('[data-block="chart"]').first(), body = figure.locator('[data-chart-export-body]')
      await expect(body).toBeVisible(); await page.evaluate('document.fonts.ready'); await page.waitForTimeout(300)
      await hoverData(page, body, fixture)
      const scene = await capture(app, page, figure, source.home, info, `theme-${variant.theme}-dpr${variant.dpr2 ? 2 : 1}`)
      expect(scene.appearance.theme).toBe(variant.theme)
      expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(errors).toEqual([])
    } finally { await closeWithAudit(app, info) }
  })

test('Chart PNG: fuente mono, raíz ampliada y zoom CSS anidado conservan la geometría', async ({}, info) => {
  const source = prepare(CHART_FIXTURES[0], 'light'), { app, page, errors } = await start(source.home, false)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="chart"]').first(), body = figure.locator('[data-chart-export-body]')
    await expect(body).toBeVisible()
    await evaluateElement<void>(figure, `root=>{document.documentElement.style.fontSize='18px';root.style.fontFamily='var(--font-mono)';root.style.zoom='1.25';root.querySelector('[data-chart-export-body]').style.zoom='1.4';}`)
    await page.evaluate('document.fonts.ready'); await body.scrollIntoViewIfNeeded(); await page.mouse.move(8, 8); await page.waitForTimeout(300)
    const scene = await capture(app, page, figure, source.home, info, 'mono-nested-css-zoom')
    expect(scene.metrics).toMatchObject({ bodyFont: 'mono', bodyItalic: false, rootFontPx: 18, cssZoom: 1.75 })
    expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(errors).toEqual([])
  } finally { await closeWithAudit(app, info) }
})

// Colección causal, no aprobación de fidelidad: el caso mono original y su oráculo permanecen intactos.
test('Chart diagnóstico de raster: mono nativo, emulación y filtros externos', async ({}, info) => {
  test.setTimeout(90_000)
  const source = prepare(CHART_FIXTURES[0], 'light'), { app, page, errors } = await start(source.home, false, 1, true)
  const records: unknown[] = [], cleanupErrors: string[] = [], leaseKey = '__chartRasterFilters_' + randomUUID()
  let session: CDPSession | undefined, emulated = false, leaseInstalled = false, failed = false, failure: unknown
  const detail = (error: unknown) => error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) }
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="chart"]').first(), body = figure.locator('[data-chart-export-body]')
    await expect(body).toBeVisible()
    await evaluateElement<void>(figure, `root=>{document.documentElement.style.fontSize='18px';root.style.fontFamily='var(--font-mono)';root.style.zoom='1.25';root.querySelector('[data-chart-export-body]').style.zoom='1.4';}`)
    await page.evaluate('document.fonts.ready'); await body.scrollIntoViewIfNeeded(); await page.mouse.move(8, 8); await page.waitForTimeout(300)
    const baseline = await snapshotChartReference(body)
    const settle = () => page.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))')
    const native = async () => ({
      main: await app.evaluate(({ app: main, BrowserWindow, screen }) => {
        const windows = BrowserWindow.getAllWindows()
        if (windows.length !== 1) throw new Error('Raster diagnostic lost its source window')
        const win = windows[0], bounds = win.getContentBounds()
        return { id: win.webContents.id, startupFactor: main.commandLine.getSwitchValue('force-device-scale-factor'), screenFactor: screen.getDisplayMatching(win.getBounds()).scaleFactor, pageZoom: win.webContents.getZoomFactor(), width: bounds.width, height: bounds.height, visible: win.isVisible(), backgroundThrottling: win.webContents.getBackgroundThrottling() }
      }),
      dom: await page.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollX,scrollY,visibilityState:document.visibilityState,hidden:document.hidden,visual:visualViewport?{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop}:null})'),
      playwrightViewport: page.viewportSize()
    })
    const nativeBaseline = await native()
    const viewport = { width: nativeBaseline.main.width, height: nativeBaseline.main.height }
    records.push({ stage: 'native-viewport', requested: { width: 1440, height: 1100 }, actual: viewport, nativeBaseline })
    expect(nativeBaseline.main).toMatchObject({ startupFactor: '1', screenFactor: 1, pageZoom: 1, visible: false, backgroundThrottling: true })
    expect(nativeBaseline.dom).toMatchObject({ ...viewport, dpr: 1, scrollX: 0, scrollY: 0, visual: { ...viewport, scale: 1, offsetLeft: 0, offsetTop: 0 } })
    expect(nativeBaseline.playwrightViewport).toBeNull()
    const filters = await evaluateElement<unknown>(body, `(root)=>{
      const key=` + JSON.stringify(leaseKey) + `;
      const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
      const nodes=[root,...root.querySelectorAll('*')];if(nodes.length>5000)throw new Error('Diagnostic Chart is unexpectedly large');
      const boxes=nodes.map(rect).filter(b=>b.width>0&&b.height>0);
      const ink={left:Math.min(...boxes.map(b=>b.x)),top:Math.min(...boxes.map(b=>b.y)),right:Math.max(...boxes.map(b=>b.x+b.width)),bottom:Math.max(...boxes.map(b=>b.y+b.height))};
      const path=e=>{const a=[];for(let n=e;n&&n!==document.documentElement;n=n.parentElement)a.unshift(n.tagName+':'+Array.from(n.parentElement?.children||[]).indexOf(n));return a.join('/')};
      const inventory=[],targets=[],candidates=[...document.querySelectorAll('.material-bar')];if(candidates.length>16)throw new Error('Too many external filters for the fixed diagnostic');
      for(const e of candidates){
        if(!(e instanceof HTMLElement))throw new Error('Unexpected external filter element');
        const c=getComputedStyle(e),b=rect(e),external=!root.contains(e)&&!e.contains(root),visible=c.display!=='none'&&c.visibility==='visible'&&Number(c.opacity)>0&&b.width>0&&b.height>0;
        const overlap=Math.max(0,Math.min(b.x+b.width,ink.right)-Math.max(b.x,ink.left))*Math.max(0,Math.min(b.y+b.height,ink.bottom)-Math.max(b.y,ink.top));
        const entry={path:path(e),tag:e.tagName,className:e.getAttribute('class'),box:b,filter:c.backdropFilter,display:c.display,visibility:c.visibility,opacity:c.opacity,position:c.position,zIndex:c.zIndex,external,visible,overlap,style:e.getAttribute('style')};
        inventory.push(entry);
        if(visible&&c.backdropFilter!=='none'&&external&&overlap===0)targets.push({e,entry,value:e.style.getPropertyValue('backdrop-filter'),priority:e.style.getPropertyPriority('backdrop-filter'),modified:null});
      }
      let disabled=false;
      const state=()=>targets.map(t=>({path:t.entry.path,connected:t.e.isConnected,box:rect(t.e),filter:getComputedStyle(t.e).backdropFilter,style:t.e.getAttribute('style'),value:t.e.style.getPropertyValue('backdrop-filter'),priority:t.e.style.getPropertyPriority('backdrop-filter')}));
      globalThis[key]={
        state,
        disable(){if(disabled||!targets.length)throw new Error('No fixed external disjoint filter set');for(const t of targets){if(!t.e.isConnected||t.e.getAttribute('style')!==t.entry.style||getComputedStyle(t.e).backdropFilter!==t.entry.filter||JSON.stringify(rect(t.e))!==JSON.stringify(t.entry.box))throw new Error('External filter changed before control');}disabled=true;for(const t of targets){t.e.style.setProperty('backdrop-filter','none','important');t.modified=t.e.getAttribute('style');if(getComputedStyle(t.e).backdropFilter!=='none'||JSON.stringify(rect(t.e))!==JSON.stringify(t.entry.box))throw new Error('External filter control changed geometry');}return state();},
        restore(){const errors=[];for(const t of targets){if(disabled){if(t.e.getAttribute('style')!==t.modified){errors.push('Concurrent external style mutation: '+t.entry.path);t.value?t.e.style.setProperty('backdrop-filter',t.value,t.priority):t.e.style.removeProperty('backdrop-filter');}else{t.entry.style===null?t.e.removeAttribute('style'):t.e.setAttribute('style',t.entry.style);}}if(!t.e.isConnected||t.e.style.getPropertyValue('backdrop-filter')!==t.value||t.e.style.getPropertyPriority('backdrop-filter')!==t.priority||t.e.getAttribute('style')!==t.entry.style||getComputedStyle(t.e).backdropFilter!==t.entry.filter||JSON.stringify(rect(t.e))!==JSON.stringify(t.entry.box))errors.push('External filter did not restore: '+t.entry.path);}disabled=false;return{errors,state:state()};}
      };return{scope:'Only observed disjoint external .material-bar filters; all other filters remain uncontrolled',ink,inventory,selected:targets.map(t=>t.entry)};
    }`)
    leaseInstalled = true
    records.push({ stage: 'setup', baseline, nativeBaseline, filters })
    session = await page.context().newCDPSession(page)
    const captureStage = async (stage: string, clip?: { x: number; y: number; width: number; height: number; scale: number }): Promise<void> => {
      const before = await snapshotChartReference(body), contextBefore = await native()
      const svg = await evaluateElement<unknown>(body, `root=>{const texts=[...root.querySelectorAll('svg text')].filter(e=>e.textContent==='−7');if(texts.length!==1)throw new Error('Diagnostic SVG text is not unique');const e=texts[0],r=e.getBoundingClientRect(),b=e.getBBox(),m=e.getScreenCTM(),range=document.createRange();range.selectNodeContents(e);return{box:{x:r.x,y:r.y,width:r.width,height:r.height},svgBox:{x:b.x,y:b.y,width:b.width,height:b.height},ctm:m?{a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f}:null,ranges:[...range.getClientRects()].map(r=>({x:r.x,y:r.y,width:r.width,height:r.height})),filters:globalThis[` + JSON.stringify(leaseKey) + `].state()}}`)
      const args = { format: 'png' as const, fromSurface: true, captureBeyondViewport: false, ...(clip ? { clip } : {}) }
      const started = performance.now(), response = await session!.send('Page.captureScreenshot', args), ended = performance.now()
      const png = Buffer.from(response.data, 'base64'), path = info.outputPath(stage + '.png')
      writeFileSync(path, png)
      const after = await snapshotChartReference(body), contextAfter = await native()
      const dimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
      records.push({ stage, diagnosticOnly: true, args, started, ended, before, after, contextBefore, contextAfter, svg, dimensions, sha256: pngHash(png) })
      await info.attach(stage + '.png', { path, contentType: 'image/png' })
      assertChartCaptureInvariant(baseline, before); assertChartCaptureInvariant(before, after)
      expect(contextBefore).toEqual(nativeBaseline); expect(contextAfter).toEqual(nativeBaseline)
      expect(dimensions).toEqual(clip ? { width: Math.round(clip.width * clip.scale), height: Math.round(clip.height * clip.scale) } : viewport)
    }
    await captureStage('A-native-full')
    emulated = true
    await session.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false }); await settle()
    await captureStage('B-matched-full')
    const b = baseline.body.box, x = Math.floor(b.x - 8), y = Math.floor(b.y - 8)
    const clip = { x, y, width: Math.ceil(b.x + b.width + 8) - x, height: Math.ceil(b.y + b.height + 8) - y }
    requireContainedChartClip(clip, viewport)
    expect(baseline.body.scaleX).toBe(1.75); expect(baseline.body.scaleY).toBe(1.75)
    await captureStage('C-matched-calibration', { ...clip, scale: 1 })
    await captureStage('C-matched-dense', { ...clip, scale: 2 / baseline.body.scaleX })
    await session.send('Emulation.clearDeviceMetricsOverride'); emulated = false; await settle()
    await captureStage('D-cleared-native-full')
    records.push({ stage: 'filter-disabled', state: await page.evaluate('globalThis[' + JSON.stringify(leaseKey) + '].disable()') }); await settle()
    await captureStage('E-external-backdrop-none')
    const restored = await page.evaluate<{ errors: string[]; state: unknown }>('globalThis[' + JSON.stringify(leaseKey) + '].restore()')
    records.push({ stage: 'filter-restored', ...restored }); expect(restored.errors).toEqual([]); await settle()
    await captureStage('F-restored-native-full')
    const path = join(source.home, 'mono-raster-context-export.png')
    await save(app, page, figure, path); await inspect(page, path, info, 'mono-raster-context-export')
    records.push({ stage: 'product-export', diagnosticOnly: true, sha256: pngHash(readFileSync(path)), audit: await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit) })
    expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(errors).toEqual([])
  } catch (error) { failed = true; failure = error; records.push({ stage: 'failure', error: detail(error) }) }
  finally {
    if (leaseInstalled) {
      try {
        const restored = await page.evaluate<{ errors: string[]; state: unknown }>('globalThis[' + JSON.stringify(leaseKey) + '].restore()')
        records.push({ stage: 'cleanup-filters', ...restored }); cleanupErrors.push(...restored.errors)
        await page.evaluate(key => { delete (globalThis as unknown as Record<string, unknown>)[key] }, leaseKey)
      } catch (error) { cleanupErrors.push('filters: ' + String(error)) }
    }
    if (session) {
      try { if (emulated) await session.send('Emulation.clearDeviceMetricsOverride') } catch (error) { cleanupErrors.push('metrics: ' + String(error)) }
      try { await session.detach() } catch (error) { cleanupErrors.push('session: ' + String(error)) }
    }
    // Conserva lo obtenido incluso si el cierre de Electron agota el plazo de la prueba.
    writeFileSync(info.outputPath('mono-raster-context-diagnostic.json'), JSON.stringify({ diagnosticCollectionPassed: false, fidelityConclusion: 'pending-analysis; original mono oracle is unchanged', cleanupPending: true, records, cleanupErrors }, null, 2))
    try { await closeWithAudit(app, info) } catch (error) { cleanupErrors.push('app: ' + String(error)) }
    writeFileSync(info.outputPath('mono-raster-context-diagnostic.json'), JSON.stringify({ diagnosticCollectionPassed: !failed && cleanupErrors.length === 0, fidelityConclusion: 'pending-analysis; original mono oracle is unchanged', records, cleanupErrors }, null, 2))
  }
  if (failed) throw failure
  expect(cleanupErrors).toEqual([])
})

test('Chart PNG: idioma árabe y dirección DOM efectiva se conservan', async ({}, info) => {
  const fixture = CHART_FIXTURES[0], source = prepare(fixture, 'light'), packPath = join(source.home, 'Packs', PACK, 'pack.json')
  const pack = JSON.parse(readFileSync(packPath, 'utf8')); pack.language = 'ar'; writeFileSync(packPath, JSON.stringify(pack))
  const packBefore = readFileSync(packPath, 'utf8'), { app, page, errors } = await start(source.home, false)
  try {
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const figure = page.locator('[data-block="chart"]').first(), body = figure.locator('[data-chart-export-body]')
    await expect(body).toBeVisible(); await page.evaluate('document.fonts.ready'); await page.waitForTimeout(300)
    await hoverData(page, body, fixture)
    // El sistema de numeración predeterminado depende de los datos Intl del navegador.
    const formatted = await page.evaluate('new Intl.NumberFormat("ar", { maximumFractionDigits: 3 }).format(12)')
    await expect(body.locator('.pointer-events-none.absolute.z-10')).toContainText(`${formatted} kg`)
    const sourceDirection = await evaluateElement<string>(body, 'root=>getComputedStyle(root).direction')
    const scene = await capture(app, page, figure, source.home, info, 'arabic-numbers')
    expect(scene.appearance.direction).toBe(sourceDirection)
    // Un contexto RTL explícito sí debe trasladarse; no se deduce sólo del idioma del curso.
    await evaluateElement<void>(body, "root=>{root.dir='rtl';root.lang='ar'}")
    await page.mouse.move(8, 8); await page.waitForTimeout(300)
    const rtl = await capture(app, page, figure, source.home, info, 'effective-rtl')
    expect(rtl.appearance).toMatchObject({ language: 'ar', direction: 'rtl' })
    expect(readFileSync(packPath, 'utf8')).toBe(packBefore); expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes); expect(errors).toEqual([])
  } finally { await closeWithAudit(app, info) }
})

for (const theme of ['light', 'dark'] as const) for (const fixture of CHART_FIXTURES) {
  test(`Chart PNG: ${fixture.key}, etiquetas y lectura en ${theme}`, async ({}, info) => {
    const source = prepare(fixture, theme), { app, page, errors } = await start(source.home, theme === 'dark')
    try {
      await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
      const figure = page.locator('[data-block="chart"]').first(), frame = figure.locator('figure'), body = figure.locator('[data-chart-export-body]')
      await expect(body).toBeVisible()
      await evaluateElement(frame, `element=>{const c=getComputedStyle(element);element.style.width=(${fixture.bodyWidth ?? 620}+parseFloat(c.paddingLeft)+parseFloat(c.paddingRight)+parseFloat(c.borderLeftWidth)+parseFloat(c.borderRightWidth))+'px';element.style.maxWidth='none';}`)
      await body.scrollIntoViewIfNeeded(); await page.mouse.move(8, 8); await page.evaluate('document.fonts.ready'); await page.waitForTimeout(300)
      const progressPath = join(source.home, 'Packs', PACK, 'progress.json'), before = readFileSync(progressPath, 'utf8')
      const normal = await capture(app, page, figure, source.home, info, `${fixture.key}-normal`)
      expect(normal.chartKind).toBe(fixture.block.kind); expect(normal.branch).toBe(fixture.branch)
      expect(normal.layers.filter(layer => layer.kind === 'svg')).toHaveLength(fixture.branch === 'empty' ? 0 : 1)
      if (await hoverData(page, body, fixture)) {
        const narrowBand = fixture.key === 'bar-narrow' ? {
          width: Number(await body.locator('svg rect[rx="6"]').getAttribute('width')),
          height: Number(await body.locator('svg rect[rx="6"]').getAttribute('height')),
          rx: Number(await body.locator('svg rect[rx="6"]').getAttribute('rx'))
        } : undefined
        const hovered = await capture(app, page, figure, source.home, info, `${fixture.key}-hover`)
        expect(hovered.branch).toBe(normal.branch); expect(hovered.layers).not.toEqual(normal.layers)
        if (narrowBand) {
          expect(narrowBand.width).toBeLessThan(narrowBand.rx * 2)
          const band = hovered.layers.flatMap(layer => layer.kind === 'svg' ? layer.primitives : []).find(p => p.kind === 'rect' && Math.abs(p.width - narrowBand.width) < .001 && Math.abs(p.height - narrowBand.height) < .001)
          expect(band).toMatchObject({ kind: 'rect', rx: narrowBand.rx })
        }
      }
      expect(readFileSync(source.skillPath, 'utf8')).toBe(source.skillBytes)
      expect(readFileSync(progressPath, 'utf8')).toBe(before); expect(errors).toEqual([])
    } finally {
      try {
        const audit = await app.evaluate(() => (globalThis as unknown as MainAudit).chartAudit).catch(error => ({ unavailable: String(error) }))
        writeFileSync(info.outputPath('final-audit.json'), JSON.stringify(audit, null, 2))
      } finally { await closeWithAudit(app, info) }
    }
  })
}

// La activación nativa del menú no debe convertirse en navegación de la diapositiva que lo contiene.
import { test, expect } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CHART_FIXTURES } from './chart-fixtures'
import { go, homeWithDemoCourse } from './helpers'

const PACK = 'exam-2-math112', SKILL = 'reference-angles', TITLE = 'Keyboard export deck'

for (const key of ['Enter', 'Space']) test(`Menú PNG en Slides: ${key} guarda sin avanzar la diapositiva`, async ({}, info) => {
  const home = homeWithDemoCourse(), dir = join(home, 'Packs', PACK, 'skills')
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', theme: 'light', motion: 'reduced', cursor: 'system' } }))
  let skillPath = '', skillBytes = ''
  for (const file of readdirSync(dir)) {
    const path = join(dir, file), skill = JSON.parse(readFileSync(path, 'utf8'))
    if (skill.id !== SKILL) continue
    skill.lesson = [{ id: 'keyboard-deck', type: 'slides', title: TITLE, theme: 'academic', transition: 'none', slides: [1, 2].map(n => ({
      id: `keyboard-slide-${n}`, title: `Keyboard slide ${n}`, layout: 'content',
      blocks: [{ ...CHART_FIXTURES[0].block, id: `keyboard-chart-${n}`, title: `Chart on slide ${n}` }], right: []
    })) }]
    skillPath = path; skillBytes = JSON.stringify(skill); writeFileSync(path, skillBytes)
  }
  if (!skillPath) throw new Error('The keyboard fixture skill is unavailable')
  const progressPath = join(home, 'Packs', PACK, 'progress.json'), progress = JSON.parse(readFileSync(progressPath, 'utf8'))
  progress.settings = { ...(progress.settings ?? {}), lessonMode: 'reading' }; writeFileSync(progressPath, JSON.stringify(progress))
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-mock-keychain', '--force-device-scale-factor=1'],
    env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_NO_UPDATES: '1', AULA_NO_LOGIN_ITEM: '1' }
  })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula)
    await go(page, { name: 'study', id: PACK, mode: 'learn', skill: SKILL })
    const deck = page.locator(`section[aria-label="${TITLE}"]`), slides = deck.locator('button[aria-current]')
    const figure = deck.locator('[data-block="chart"]').first(), action = figure.getByRole('button', { name: /Export figure|Exportar figura/ })
    await expect(slides).toHaveCount(2); await expect(slides.nth(0)).toHaveAttribute('aria-current', 'true')
    await expect(figure.locator('[data-chart-export-body]')).toBeVisible(); await page.evaluate('document.fonts.ready')
    const beforeProgress = readFileSync(progressPath, 'utf8'), path = join(home, `menu-${key}.png`)
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog }, path)
    await action.focus(); await action.press('ArrowDown')
    const option = page.getByRole('menuitem', { name: /^(Save|Guardar) PNG/ })
    await expect(option).toBeFocused(); await option.press(key)
    // Con el bug, Slides consume la tecla, cambia aria-current y cancela el clic nativo antes de capturar.
    await expect(slides.nth(0)).toHaveAttribute('aria-current', 'true')
    await expect.poll(() => existsSync(path), { timeout: 30_000 }).toBe(true)
    await expect(figure.locator('[data-figure-export]')).toHaveAttribute('aria-busy', 'false')
    await expect(slides.nth(0)).toHaveAttribute('aria-current', 'true')
    const png = readFileSync(path)
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBeGreaterThan(0); expect(png.readUInt32BE(20)).toBeGreaterThan(0)
    expect(readFileSync(progressPath, 'utf8')).toBe(beforeProgress)
    expect(readFileSync(skillPath, 'utf8')).toBe(skillBytes)
    await info.attach(`menu-${key}.png`, { path, contentType: 'image/png' })
    // La misma tecla sigue navegando cuando el foco pertenece al deck, fuera del menú.
    await deck.focus(); await deck.press(key)
    await expect(slides.nth(1)).toHaveAttribute('aria-current', 'true')
    expect(errors).toEqual([])
  } finally { await app.close() }
})

// Reintentos desde una conversación ya guardada: perfil temporal, archivo de prueba y servicio real con IA simulada.
import { test, expect, type ElectronApplication, type Page } from 'playwright/test'
import { _electron as electron } from 'playwright'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { AssistantAttachment, AssistantMessage, AssistantThread, TutorContext } from '../../src/shared/assistant/types'
import { go, homeWithDemoCourse } from './helpers'

const PACK = 'exam-2-math112'
const SKILL = 'reference-angles'
const image = readFileSync(resolve(__dirname, '../../resources/icon.png'))
const assetID = `${createHash('sha256').update(image).digest('hex').slice(0, 16)}.png`
const hash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

function fixture(text: string, language: 'en' | 'es', missing = false) {
  const home = homeWithDemoCourse()
  const id = `retry-${language}-${text ? 'question' : 'image'}`
  const now = new Date().toISOString()
  const attachment: AssistantAttachment = { id: 'image-attachment', kind: 'image', name: 'test-picture.png', bytes: image.length, status: 'ready', pages: 0, characters: 0, imageAssets: [assetID], thumbnail: assetID }
  const context: TutorContext = { courseID: PACK, skillID: SKILL, blockID: 'fixture-figure', screen: 'practice', lastResult: 'not solved yet', markedFigure: { studentText: text, context: 'UNTRUSTED_FIGURE_CONTENT' } }
  const user: AssistantMessage = { id: 'original-question', role: 'user', text, date: now, mentions: [], attachments: [attachment], cards: [], steps: [], notices: [], failed: false, interrupted: false, context }
  const failed: AssistantMessage = { id: 'original-failure', role: 'assistant', text: 'Fixture network failure', date: now, mentions: [], attachments: [], cards: [], steps: [], notices: [], failed: true, interrupted: false }
  const thread: AssistantThread = { id, title: 'Retry image fixture', created: now, updated: now, messages: [user, failed], pinned: false }
  const threadPath = join(home, 'Assistant', 'threads', `${id}.json`)
  const files = join(home, 'Assistant', 'Packs', id)
  const assetPath = join(files, 'assets', assetID)
  mkdirSync(dirname(threadPath), { recursive: true })
  mkdirSync(dirname(assetPath), { recursive: true })
  const pack = JSON.parse(readFileSync(join(home, 'Packs', PACK, 'pack.json'), 'utf8'))
  writeFileSync(join(files, 'pack.json'), JSON.stringify({ ...pack, id, title: 'Conversation files', sources: [], skillOrder: [] }))
  if (!missing) writeFileSync(assetPath, image)
  writeFileSync(threadPath, JSON.stringify(thread))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language } }))
  return { home, id, threadPath, assetPath, user, failed }
}

async function start(home: string): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-mock-keychain'],
    env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_FAKE_AI_DELAY_MS: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1', AULA_NO_UPDATES: '1', AULA_NO_LOGIN_ITEM: '1' }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula)
  return { app, page, errors }
}

function readThread(path: string): AssistantThread { return JSON.parse(readFileSync(path, 'utf8')) as AssistantThread }

for (const imageOnly of [false, true]) {
  test(`Reintentar conserva el adjunto y el mensaje original: ${imageOnly ? 'sólo imagen' : 'texto e imagen'}`, async () => {
    test.setTimeout(120_000)
    const data = fixture(imageOnly ? '' : 'Explain the attached figure.', imageOnly ? 'es' : 'en')
    const originalHash = hash(data.assetPath)
    let running = await start(data.home)
    try {
      await go(running.page, { name: 'chat', conversation: data.id })
      await expect(running.page.locator('[data-role="user"]')).toHaveCount(1)
      await expect(running.page.locator('[data-role="user"]').getByText('test-picture.png', { exact: true })).toBeVisible()
      const retry = running.page.getByRole('button', { name: imageOnly ? 'Reintentar' : 'Retry', exact: true })
      await expect(retry).toBeVisible()
      // Dos activaciones en el mismo turno de eventos: no deben crear dos solicitudes ni dos preguntas.
      await retry.evaluate(element => {
        const button = element as unknown as { click(): void }
        button.click(); button.click()
      })
      await expect.poll(() => readThread(data.threadPath).messages.filter(message => message.role === 'assistant' && !message.failed).length, { timeout: 60_000 }).toBe(1)
      await expect(running.page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 60_000 })
      const saved = readThread(data.threadPath)
      expect(saved.messages.filter(message => message.role === 'user')).toHaveLength(1)
      const original = saved.messages.find(message => message.id === data.user.id)!
      expect(original.text).toBe(data.user.text)
      expect(original.context).toEqual(data.user.context)
      expect(original.attachments).toEqual(data.user.attachments)
      expect(saved.messages.find(message => message.id === data.failed.id)).toEqual(data.failed)
      expect(hash(data.assetPath)).toBe(originalHash)
      const reply = saved.messages.find(message => message.role === 'assistant' && !message.failed)!

      // El recibo de una operación terminada sigue siendo idempotente después de cerrar y abrir Aula.
      expect(running.errors).toEqual([])
      await running.app.close()
      running = await start(data.home)
      await go(running.page, { name: 'chat', conversation: data.id })
      const result = await running.page.evaluate(async args => {
        const { aula } = globalThis as unknown as { aula: { invoke(method: string, args: unknown): Promise<{ ok: boolean; value?: { messageId: string; replyId: string; queued: boolean } }> } }
        return aula.invoke('chat.retry', args)
      }, { threadId: data.id, failedMessageId: data.failed.id })
      expect(result).toEqual({ ok: true, value: { messageId: data.user.id, replyId: reply.id, queued: false } })
      await expect(running.page.locator('[data-role="user"]')).toHaveCount(1)
      await expect(running.page.getByRole('button', { name: imageOnly ? 'Reintentar' : 'Retry', exact: true })).toHaveCount(0)
      expect(readThread(data.threadPath).messages.map(message => message.id)).toEqual(saved.messages.map(message => message.id))
      expect(hash(data.assetPath)).toBe(originalHash)
      expect(running.errors).toEqual([])
    } finally { await running.app.close() }
  })
}

test('un adjunto que falta se explica sin iniciar una respuesta incompleta', async () => {
  const data = fixture('Explain the attached figure.', 'en', true)
  const before = readFileSync(data.threadPath, 'utf8')
  const { app, page, errors } = await start(data.home)
  try {
    await go(page, { name: 'chat', conversation: data.id })
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    await retry.click()
    await expect(page.locator('[aria-live="polite"]').filter({ has: page.locator('.material-menu') })).toContainText(/attachment|picture|file/i)
    await expect(retry).toBeEnabled()
    expect(readFileSync(data.threadPath, 'utf8')).toBe(before)
    expect(existsSync(data.assetPath)).toBe(false)
    await expect(page.locator('[data-role="user"]')).toHaveCount(1)
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(1)
    expect(errors).toEqual([])
  } finally { await app.close() }
})

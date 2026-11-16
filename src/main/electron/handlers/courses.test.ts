// R3: borrar un curso desde su cabecera mientras Aula aún lo escribe. Antes el equipo seguía trabajando (y gastando), volvía a
// crear `Packs/<id>/runs` y un curso nuevo con el mismo título heredaba la ejecución fallida del borrado.
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { makePack } from '@shared/schema'
import { setDataRoot } from '@main/services/paths'
import { getLibrary } from '@main/services/store'
import { scriptedAgents } from '@main/services/pipeline/agents'
import { DraftStore } from '@main/services/pipeline/drafts'
import { GenerationService } from '@main/services/pipeline/service'

const handlers = new Map<string, (args: unknown) => unknown>()
const trashed: string[] = []
let home = ''
/** Lo que tarda la papelera (en la de verdad, la carpeta sigue ahí un rato). */
let trashDelay = 0
let service: GenerationService | null = null

vi.mock('electron', () => ({
  app: { getPath: () => home },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  // la papelera del sistema: se lleva la carpeta a otro sitio
  shell: {
    trashItem: async (dir: string) => {
      if (trashDelay) await new Promise((x) => setTimeout(x, trashDelay))
      const bin = join(home, '.Trash'); mkdirSync(bin, { recursive: true }); renameSync(dir, join(bin, `${basename(dir)}-${trashed.length}`)); trashed.push(dir)
    }
  }
}))
vi.mock('../rpc', () => ({ handle: (m: string, fn: (args: unknown) => unknown) => handlers.set(m, fn), emit: () => undefined }))
vi.mock('./generation', () => ({ generationService: () => service }))
vi.mock('@main/services/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/services/store')>()),
  installSampleCourses: () => [], migrateWelcomeTone: () => [], startCourseWatcher: () => undefined
}))

const plan = { title: 'Aritmética', subject: 'Matemáticas', language: 'es', units: [{ id: 'u1', title: 'Operaciones', skills: [{ id: 'suma', title: 'Sumar' }, { id: 'resta', title: 'Restar' }] }] }

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'aula-courses-'))
  setDataRoot(home)
  ;(await import('./courses')).register()
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('courses.delete', () => {
  it('detiene al equipo que escribe el curso antes de borrarlo: no sigue, no deja carpeta y otro curso no hereda nada', async () => {
    const authors: string[] = []
    let release = (): void => undefined
    const gate = new Promise<void>((r) => { release = r })
    service = new GenerationService({
      library: getLibrary, drafts: new DraftStore(() => join(home, 'Drafts')),
      agents: async () => scriptedAgents(async (task, call) => {
        if (task.role === 'planner') { await call('set_course_plan', plan); return 'ok' }
        if (task.role !== 'author') return ''
        authors.push(task.prompt)
        // como un agente de verdad: deja de trabajar al cancelarlo
        await Promise.race([gate, new Promise((r) => task.signal.addEventListener('abort', r, { once: true }))])
        try { await call('add_cards', { cards: [{ front: 'a', back: 'b' }] }) } catch { /* curso borrado */ }
        return 'ok'
      })
    })
    const { runId, packId } = await service.start(undefined, { title: 'Aritmética', topics: 'Suma y resta', depth: 'quick', allowWeb: false, verify: false, materialIds: [], officialIds: [] })
    for (let i = 0; i < 300 && !authors.length; i++) await new Promise((x) => setTimeout(x, 10))
    expect(authors.length).toBeGreaterThan(0)

    await handlers.get('courses.delete')!({ id: packId })
    const calls = authors.length
    expect(service.runs().filter((r) => r.packId === packId)).toEqual([])
    release()
    await service.whenFinished(runId)
    await new Promise((x) => setTimeout(x, 50))

    expect(trashed).toEqual([join(home, 'Packs', packId)])
    expect(authors.length).toBe(calls)
    expect(existsSync(join(home, 'Packs', packId))).toBe(false)
    const fresh = getLibrary().createPack(makePack({ id: '', title: 'Aritmética' }))
    expect(fresh.id).toBe(packId)
    expect(service.runs().filter((r) => r.packId === fresh.id)).toEqual([])
  })

  it('si los materiales terminan de leerse mientras el curso va a la papelera, no empieza nada ni vuelve la carpeta', async () => {
    const team: string[] = []
    let release = (): void => undefined
    const reading = new Promise<void>((r) => { release = r })
    const drafts = new DraftStore(() => join(home, 'Drafts'))
    const d = drafts.addText(undefined, 'Ejemplo: 1/4 + 2/4 = 3/4. Las fracciones equivalentes representan la misma cantidad.', 'Pizarra')
    await drafts.idle(d.draftId)
    const ids = drafts.materials(d.draftId).map((m) => m.id)
    // como un PDF grande que aún se lee
    const idle = drafts.idle.bind(drafts)
    drafts.idle = async (id: string) => { await reading; return idle(id) }
    service = new GenerationService({ library: getLibrary, drafts, agents: async () => scriptedAgents(async (task) => { team.push(task.role); return '' }) })
    const starting = service.start(d.draftId, { title: 'Geometría', topics: 'Triángulos', depth: 'quick', allowWeb: false, verify: false, materialIds: ids, officialIds: [] })
    let packId: string | undefined
    for (let i = 0; i < 200 && !packId; i++) { await new Promise((x) => setTimeout(x, 5)); packId = getLibrary().listPacks().find((p) => p.title === 'Geometría')?.id }
    expect(packId).toBeTruthy()

    trashDelay = 80
    const deleting = handlers.get('courses.delete')!({ id: packId }) as Promise<void>
    await new Promise((x) => setTimeout(x, 20))
    expect(existsSync(join(home, 'Packs', packId!))).toBe(true)
    release()
    await expect(starting).rejects.toMatchObject({ code: 'not_found' })
    await deleting
    trashDelay = 0
    await new Promise((x) => setTimeout(x, 50))

    expect(team).toEqual([])
    expect(existsSync(join(home, 'Packs', packId!))).toBe(false)
    expect(drafts.materials(d.draftId).map((m) => m.id)).toEqual(ids)
  })
})

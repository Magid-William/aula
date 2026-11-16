// «Crear curso» de punta a punta con la IA simulada (`AULA_FAKE_AI`) sobre una carpeta de datos temporal: el área de
// preparación lee .txt/.md, el curso se crea al momento («en preparación»), el equipo lo escribe y verifica, el registro se
// guarda y se reanuda, «Pedir cambios» se deshace con el historial y recoge la petición de «Preparar más ejercicios».
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { learningContentRequest } from '@engine/study/content-request'
import type { MaterialView, RunView } from '@shared/generation/types'
import { makePack } from '@shared/schema'
import { createFakeModel, setModelOverride } from '../ai'
import { isPreparing } from '../calendar/preparation'
import { writeJSONAtomic } from '../fs'
import { setDataRoot } from '../paths'
import { updateSettings } from '../settings'
import { getLibrary, type PackStore } from '../store'
import { boundValidator } from '../study/assets'
import { scriptedAgents } from './agents'
import { DraftStore, draftInInstruction } from './drafts'
import { fakeTeamScript } from './fakeTeam'
import { createGenerationService, GenerationService, validateCreateRequest } from './index'
import { hasWrittenSkill } from './service'

let home: string
let files: string
let svc: GenerationService
const views: RunView[] = []
const materials: MaterialView[] = []

const BASE = { depth: 'quick', lessonMode: 'stepByStep', allowWeb: false, verify: true, materialIds: [], officialIds: [] }

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'aula-home-'))
  files = mkdtempSync(join(tmpdir(), 'aula-files-'))
  setDataRoot(home)
  setModelOverride(createFakeModel)
  process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
  svc = createGenerationService({ emit: (v) => views.push(v), onMaterial: (_d, m) => materials.push(m) })
})
afterAll(() => {
  setModelOverride(null)
  rmSync(home, { recursive: true, force: true })
  rmSync(files, { recursive: true, force: true })
})

function store(packId: string): PackStore {
  const s = getLibrary().openPack(packId)
  if (!s) throw new Error('sin curso')
  return s
}

describe('crear un curso', () => {
  let packId = ''
  let runId = ''

  it('el área de preparación lee textos, .md y .txt (y avisa del avance o del error)', async () => {
    writeFileSync(join(files, 'apuntes.md'), '# Fracciones\n\nUna **fracción** es una parte de un todo: $\\frac{a}{b}$.\n\n## Suma\n\nCon el mismo denominador se suman los numeradores.\n')
    writeFileSync(join(files, 'resumen.txt'), 'Para restar fracciones con distinto denominador, primero se busca un denominador común.\n')
    const a = svc.drafts.addText(undefined, 'Ejemplo: 1/4 + 2/4 = 3/4. Las fracciones equivalentes representan la misma cantidad.', 'Pizarra')
    expect(a.draftId).toMatch(/^draft-[a-z0-9]{10}$/)
    expect(a.materials).toHaveLength(1)
    const b = svc.drafts.addFiles(a.draftId, [join(files, 'apuntes.md'), join(files, 'resumen.txt'), join(files, 'no-existe.pdf')])
    expect(b.draftId).toBe(a.draftId)
    expect(b.materials).toHaveLength(4)
    const missing = b.materials.find((m) => m.title === 'no-existe.pdf')
    expect(missing).toMatchObject({ status: 'failed', error: 'No encuentro el archivo.' })
    await svc.drafts.idle(a.draftId)
    const list = svc.drafts.materials(a.draftId)
    const ready = list.filter((m) => m.status === 'ready')
    expect(ready.map((m) => m.kind).sort()).toEqual(['markdown', 'text', 'text'])
    expect(ready.every((m) => m.characters > 20 && m.pages >= 1 && m.progress === undefined)).toBe(true)
    expect(materials.some((m) => m.status === 'processing' && typeof m.detail === 'string')).toBe(true)
    expect(materials.filter((m) => m.status === 'ready')).toHaveLength(3)
    // quitar un material
    const left = svc.drafts.remove(a.draftId, missing!.id)
    expect(left).toHaveLength(3)

    const r = await svc.start(a.draftId, { ...BASE, title: 'Fracciones', topics: 'Suma de fracciones, resta de fracciones', materialIds: ready.map((m) => m.id), officialIds: [ready[0].id] })
    packId = r.packId
    runId = r.runId
    // el curso existe al momento y está «en preparación»
    const s = store(packId)
    expect(s.loadPack().title).toBe('Fracciones')
    expect(isPreparing(s)).toBe(true)
    expect(svc.run(runId)?.state).toBe('running')
    expect(svc.runs().some((x) => x.id === runId && x.packId === packId)).toBe(true)
    // los materiales pasaron al curso (el oficial, como tal) y el borrador desapareció
    const sources = s.loadPack().sources
    expect(sources.map((x) => x.id).sort()).toEqual(ready.map((m) => m.id).sort())
    expect(sources.find((x) => x.id === ready[0].id)?.trust).toBe('official')
    expect(existsSync(join(home, 'Drafts', a.draftId))).toBe(false)
  })

  it('el equipo termina: curso válido, con ejercicios verificados, tarjetas y registro guardado', async () => {
    const st = await svc.whenFinished(runId)
    expect(st?.aula2.state, st?.failure).toBe('done')
    const s = store(packId)
    const pack = s.loadPack()
    expect(pack.skills).toHaveLength(2)
    expect(pack.blueprint).toBeDefined()
    for (const ref of pack.skills) {
      expect(ref.status).toBe('ready')
      const k = s.loadSkill(ref.id)
      expect(boundValidator(s).checkSkill(k, pack).filter((i) => i.severity === 'error')).toEqual([])
      expect(k.exercises.length).toBeGreaterThanOrEqual(8)
      expect(k.cards.length).toBeGreaterThanOrEqual(5)
      expect(k.lesson.some((b) => b.type === 'tryit')).toBe(true)
      expect(k.exercises.every((e) => e.review?.state === 'verified')).toBe(true)
    }
    expect(isPreparing(s)).toBe(false)
    // el registro (formato Swift) está en runs/ y el monitor dice la verdad
    expect(existsSync(join(s.runsDirectory, `${runId}.json`))).toBe(true)
    const raw = JSON.parse(readFileSync(join(s.runsDirectory, `${runId}.json`), 'utf8')) as Record<string, unknown>
    expect((raw.request as Record<string, unknown>).mode).toEqual({ create: {} })
    const v = svc.run(runId)
    expect(v).toMatchObject({ state: 'done', progress: 1, mode: 'create', packId })
    expect(v?.report).toMatchObject({ skillsReady: 2, skillsNeedingReview: 0, skillsFailed: 0, exercises: 16, cards: 10, verified: 16, flagged: 0 })
    expect(v?.lanes.every((l) => l.status === 'done')).toBe(true)
    expect(v?.provider).toContain('IA simulada')
    // los avisos al monitor: el avance nunca retrocede y termina en 1
    const mine = views.filter((x) => x.id === runId).map((x) => x.progress)
    expect(mine.length).toBeGreaterThan(2)
    expect(mine[mine.length - 1]).toBe(1)
    for (let i = 1; i < mine.length; i++) expect(mine[i]).toBeGreaterThanOrEqual(mine[i - 1] - 0.05)
    expect(svc.runs().find((x) => x.id === runId)).toMatchObject({ state: 'done', stageLabel: 'Terminado' })
  })

  it('«Pedir cambios» recoge la petición de «Preparar más ejercicios», amplía solo esa habilidad y se deshace', async () => {
    const s = store(packId)
    const pack = s.loadPack()
    const skill = s.loadSkill(pack.skills[0].id)
    const before = skill.exercises.length
    const req = learningContentRequest(pack, skill, undefined, 'practice-20261026120000-abcd', new Date(), 'es')
    writeJSONAtomic(join(s.runsDirectory, `${req.id}.practice-request.json`), req)
    const r = await svc.extend(packId, req.instruction, skill.id)
    const st = await svc.whenFinished(r.runId)
    expect(st?.aula2.state, st?.failure).toBe('done')
    expect(st?.request.depth).toBe('quick')
    expect(st?.request.allowWeb).toBe(false)
    expect(st?.request.userNotes).toContain('Guided learning needs fresh')
    expect(st?.aula2.practiceRequest).toBe(req.id)
    const consumed = JSON.parse(readFileSync(join(s.runsDirectory, `${req.id}.practice-request.json`), 'utf8')) as Record<string, unknown>
    expect(consumed).toMatchObject({ status: 'consumed', runId: r.runId })
    expect(s.loadSkill(skill.id).exercises.length).toBe(before + 3)
    // solo se verificó lo nuevo de esa habilidad
    expect(st?.aula2.lanes.filter((l) => l.role === 'verifier').map((l) => l.skill)).toEqual([skill.id])
    expect(svc.run(r.runId)).toMatchObject({ mode: 'extend', state: 'done', skill: skill.id })
    // Aprender enseña ese tema «escribiéndose» mientras dura: el resumen de la lista también dice cuál es
    expect(svc.runs().find((x) => x.id === r.runId)).toMatchObject({ mode: 'extend', skill: skill.id })
    // un solo grupo del historial, que se deshace entero
    const history = getLibrary().history!
    const group = history.groups({ courseID: packId }).find((g) => g.id === `pipeline-${r.runId}`)
    expect(group?.label).toContain('Pedir cambios')
    history.undo(`pipeline-${r.runId}`)
    expect(s.loadSkill(skill.id).exercises.length).toBe(before)
    // y la creación tampoco vuelve a estar «en preparación»
    expect(isPreparing(s)).toBe(false)
  })

  it('«Materiales» del curso: el borrador nombrado en la petición pasa al curso antes de ampliar', async () => {
    const d = svc.drafts.addText(undefined, 'Las fracciones impropias tienen el numerador mayor que el denominador. Ejemplo: 7/4.', 'Impropias')
    await svc.drafts.idle(d.draftId)
    const instruction = `Lee los materiales nuevos «Impropias» (borrador ${d.draftId}) y amplía el curso con lo que aporten: lecciones, ejercicios y tarjetas.`
    expect(draftInInstruction(instruction)).toBe(d.draftId)
    const r = await svc.extend(packId, instruction)
    await svc.whenFinished(r.runId)
    expect(store(packId).loadPack().sources.some((x) => x.title === 'Impropias')).toBe(true)
  })

  it('«Materiales» del curso: lo ya leído pasa al curso al momento, sin ampliar (J2-7)', async () => {
    const d = svc.drafts.addText(undefined, 'Una fracción unitaria tiene numerador 1. Ejemplo: 1/5.', 'Unitarias')
    await svc.drafts.idle(d.draftId)
    expect(svc.attachMaterials(packId, d.draftId)).toEqual({ moved: 1 })
    const s = store(packId)
    const src = s.loadPack().sources.find((x) => x.title === 'Unitarias')
    expect(src).toBeDefined()
    expect(existsSync(join(s.directory, 'sources', src!.id, 'chunks.json'))).toBe(true)
    // el borrador ya no tiene nada: volver a pedirlo no duplica
    expect(svc.attachMaterials(packId, d.draftId)).toEqual({ moved: 0 })
    expect(s.loadPack().sources.filter((x) => x.title === 'Unitarias')).toHaveLength(1)
    // lo que aún se está leyendo pasa en cuanto termina (aunque nadie mire la pestaña)
    const e = svc.drafts.addText(undefined, 'Las fracciones mixtas combinan un entero y una fracción: 2 1/3.', 'Mixtas')
    svc.attachMaterials(packId, e.draftId)
    await svc.drafts.idle(e.draftId)
    await new Promise((r) => setTimeout(r, 20))
    expect(store(packId).loadPack().sources.some((x) => x.title === 'Mixtas')).toBe(true)
    expect(() => svc.attachMaterials('no-existe', d.draftId)).toThrow()
    expect(() => svc.attachMaterials(packId, '../x')).toThrow()
  })

  it('la hora del examen elegida al crear (9:00) no pasa a las 8:00 cuando el plan manda solo el día (J2-12)', async () => {
    const exam = new Date(2026, 10, 8, 9, 0)
    const r = await svc.start(undefined, { ...BASE, title: 'Ángulos', topics: 'Ángulos complementarios', examDate: exam.toISOString() })
    await svc.whenFinished(r.runId)
    const date = store(r.packId).loadPack().exam?.date
    expect(date).toBeDefined()
    const d = new Date(date!)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 8, 9, 0])
  })

  it('valida la petición antes de crear nada', async () => {
    const count = getLibrary().packIDs().length
    await expect(svc.start(undefined, { ...BASE, title: '  ' })).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(svc.start(undefined, { ...BASE, title: 'Nada' })).rejects.toMatchObject({ code: 'generation_no_material' })
    await expect(svc.start('../../etc', { ...BASE, title: 'X', topics: 'a' })).rejects.toMatchObject({ code: 'invalid_args' })
    expect(() => validateCreateRequest({ ...BASE, title: 'X', examDate: 'mañana' })).toThrow()
    expect(validateCreateRequest({ ...BASE, title: 'X', lessonMode: 'nope', depth: 'nope' })).toMatchObject({ depth: 'standard', lessonMode: 'stepByStep' })
    expect(getLibrary().packIDs().length).toBe(count)
    await expect(svc.extend('no-existe', 'algo')).rejects.toMatchObject({ code: 'not_found' })
    await expect(svc.extend(packId, '')).rejects.toMatchObject({ code: 'invalid_args' })
  })
})

describe('detener, reanudar y quedarse con lo que hay', () => {
  it('detener deja la creación en pausa; reanudar la termina sin repetir el plan', async () => {
    process.env.AULA_FAKE_TEAM_DELAY_MS = '40'
    const r = await svc.start(undefined, { ...BASE, title: 'Porcentajes', topics: 'Porcentajes, descuentos y aumentos', verify: false })
    // en cuanto hay plan, se detiene
    for (let i = 0; i < 200 && !store(r.packId).loadPack().skills.length; i++) await new Promise((x) => setTimeout(x, 10))
    svc.cancel(r.runId)
    const paused = await svc.whenFinished(r.runId)
    expect(paused?.aula2.state).toBe('paused')
    expect(svc.run(r.runId)?.state).toBe('paused')
    expect(isPreparing(store(r.packId))).toBe(true)
    // ampliar ahora escondería la creación a medias (pasaría a ser la última ejecución, sin «Reanudar» en ninguna parte)
    await expect(svc.extend(r.packId, 'Escribe completo el primer tema')).rejects.toMatchObject({ code: 'generation_unfinished' })
    expect(svc.runs().filter((x) => x.packId === r.packId).map((x) => x.id)).toEqual([r.runId])
    process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
    await svc.resume(r.runId)
    const done = await svc.whenFinished(r.runId)
    expect(done?.aula2.state, done?.failure).toBe('done')
    expect(done?.aula2.lanes.filter((l) => l.role === 'planner')).toHaveLength(1)
    expect(store(r.packId).loadPack().skills.every((x) => x.status === 'ready')).toBe(true)
    expect(isPreparing(store(r.packId))).toBe(false)
  })

  it('«Quedarme con lo que hay» convierte un curso a medias en un curso normal', async () => {
    process.env.AULA_FAKE_TEAM_DELAY_MS = '40'
    const r = await svc.start(undefined, { ...BASE, title: 'Decimales', topics: 'Decimales, redondeo', verify: false })
    // con algún tema ya escrito (sin ninguno no se puede: ver la prueba de abajo)
    for (let i = 0; i < 400 && !hasWrittenSkill(store(r.packId)); i++) await new Promise((x) => setTimeout(x, 10))
    await svc.keep(r.runId)
    process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
    const s = store(r.packId)
    expect(isPreparing(s)).toBe(false)
    expect(existsSync(join(s.runsDirectory, `${r.runId}.kept.json`))).toBe(true)
    expect(svc.run(r.runId)?.state).toBe('done')
    // ya es un curso normal: se puede ampliar
    const more = await svc.extend(r.packId, 'Añade un ejemplo resuelto más')
    expect((await svc.whenFinished(more.runId))?.aula2.state).toBe('done')
  })

  it('A3-P2-8: sin ningún tema escrito no se ofrece un curso «listo» con 0 temas', async () => {
    process.env.AULA_FAKE_TEAM_DELAY_MS = '40'
    const r = await svc.start(undefined, { ...BASE, title: 'Vacío', topics: 'Nada todavía', verify: false })
    for (let i = 0; i < 200 && !store(r.packId).loadPack().skills.length; i++) await new Promise((x) => setTimeout(x, 10))
    svc.cancel(r.runId)
    await svc.whenFinished(r.runId)
    process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
    // como si el modelo no hubiera escrito nada (el plan sí está)
    const s = store(r.packId)
    for (const ref of s.loadPack().skills) rmSync(join(s.directory, 'skills', `${ref.id}.json`), { force: true })
    expect(hasWrittenSkill(s)).toBe(false)
    await expect(svc.keep(r.runId)).rejects.toMatchObject({ code: 'generation_nothing_to_keep' })
    expect(svc.run(r.runId)?.state).toBe('paused')
    expect(isPreparing(s)).toBe(true)
  })

  it('una ejecución que quedó «trabajando» al cerrar la app se ve en pausa y se puede reanudar', async () => {
    const r = await svc.start(undefined, { ...BASE, title: 'Potencias', topics: 'Potencias', verify: false })
    await svc.whenFinished(r.runId)
    const s = store(r.packId)
    // simula un cierre a medias: el registro dice «running» y no terminó
    const file = join(s.runsDirectory, `${r.runId}.json`)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    delete raw.finishedAt
    ;(raw.aula2 as Record<string, unknown>).state = 'running'
    ;(raw.stages as Record<string, unknown>).polish = 'running'
    writeFileSync(file, JSON.stringify(raw))
    const fresh = createGenerationService({})
    expect(fresh.run(r.runId)?.state).toBe('paused')
    await fresh.resume(r.runId)
    const done = await fresh.whenFinished(r.runId)
    expect(done?.aula2.state).toBe('done')
    expect(done?.stages.polish).toBe('done')
  })
})

describe('varias ejecuciones', () => {
  it('como mucho `maxRuns` a la vez; las demás esperan turno', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aula-lib-'))
    try {
      let running = 0
      let peak = 0
      const service = new GenerationService({
        library: getLibrary, drafts: new DraftStore(() => join(root, 'Drafts')), maxRuns: 1,
        agents: async (req) => {
          const script = fakeTeamScript(req)
          return scriptedAgents(async (task, call) => {
            if (task.role === 'planner') { running++; peak = Math.max(peak, running) }
            try { return await script(task, call) } finally { if (task.role === 'planner') { await new Promise((x) => setTimeout(x, 30)); running-- } }
          })
        }
      })
      const a = await service.start(undefined, { ...BASE, title: 'Uno', topics: 'Uno', verify: false })
      const b = await service.start(undefined, { ...BASE, title: 'Dos', topics: 'Dos', verify: false })
      expect(service.run(b.runId)?.state).toBe('running')
      const [sa, sb] = await Promise.all([service.whenFinished(a.runId), service.whenFinished(b.runId)])
      expect(sa?.aula2.state).toBe('done')
      expect(sb?.aula2.state).toBe('done')
      expect(peak).toBe(1)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

describe('borrar un curso mientras Aula lo escribe (R3)', () => {
  it('cancelPack detiene la del curso (en marcha o esperando turno) y al borrarlo no queda nada que herede otro', async () => {
    const plan = { title: 'Aritmética', subject: 'Matemáticas', language: 'es', units: [{ id: 'u1', title: 'Operaciones', skills: [{ id: 'suma', title: 'Sumar' }, { id: 'resta', title: 'Restar' }] }] }
    const authors: string[] = []
    let release = (): void => undefined
    const gate = new Promise<void>((r) => { release = r })
    const service = new GenerationService({
      library: getLibrary, drafts: new DraftStore(() => join(home, 'Drafts-R3')), maxRuns: 1,
      agents: async () => scriptedAgents(async (task, call) => {
        if (task.role === 'planner') { await call('set_course_plan', plan); return 'ok' }
        if (task.role !== 'author') return ''
        authors.push(task.prompt)
        // como un agente de verdad: deja de trabajar al cancelarlo
        await Promise.race([gate, new Promise((r) => task.signal.addEventListener('abort', r, { once: true }))])
        return 'ok'
      })
    })
    const a = await service.start(undefined, { ...BASE, title: 'Aritmética', topics: 'Suma y resta', verify: false })
    // con `maxRuns: 1` esta espera turno
    const b = await service.start(undefined, { ...BASE, title: 'Geometría', topics: 'Triángulos', verify: false })
    for (let i = 0; i < 300 && !authors.length; i++) await new Promise((x) => setTimeout(x, 10))
    expect(authors.length).toBeGreaterThan(0)
    const states = (packId: string): string[] => service.runs().filter((r) => r.packId === packId).map((r) => r.state)

    await service.cancelPack(b.packId)
    expect(states(b.packId)).toEqual(['paused'])
    expect(states(a.packId)).toEqual(['running'])

    await service.cancelPack(a.packId)
    expect(states(a.packId)).toEqual(['paused'])
    const calls = authors.length
    await getLibrary().deletePack(a.packId)
    release()
    await new Promise((x) => setTimeout(x, 50))
    // nadie sigue escribiendo ni vuelve a crear `Packs/<id>/runs`
    expect(authors.length).toBe(calls)
    expect(existsSync(join(home, 'Packs', a.packId))).toBe(false)
    expect(service.run(a.runId)).toBeNull()
    // un curso nuevo con el mismo título no hereda la ejecución del borrado
    const fresh = getLibrary().createPack(makePack({ id: '', title: 'Aritmética' }))
    expect(fresh.id).toBe(a.packId)
    expect(states(fresh.id)).toEqual([])
    // sin ejecuciones, no hace nada
    await expect(service.cancelPack('no-existe')).resolves.toBeUndefined()
  })

  it('si lo borran mientras aún se leen sus materiales (o mientras va a la papelera), no vuelve `Packs/<id>` y los materiales siguen en el borrador', async () => {
    const drafts = new GatedDrafts(() => join(home, 'Drafts-R3-materiales'))
    const team: string[] = []
    const service = new GenerationService({ library: getLibrary, drafts, agents: async () => scriptedAgents(async (task) => { team.push(task.role); return '' }) })
    const d = drafts.addText(undefined, 'Ejemplo: 1/4 + 2/4 = 3/4. Las fracciones equivalentes representan la misma cantidad.', 'Pizarra')
    await drafts.idle(d.draftId)
    const ids = drafts.materials(d.draftId).map((m) => m.id)
    expect(ids).toHaveLength(1)
    const gone = (packId: string): void => {
      expect(existsSync(join(home, 'Packs', packId))).toBe(false)
      expect(service.runs().filter((r) => r.packId === packId)).toEqual([])
      expect(drafts.materials(d.draftId).map((m) => m.id)).toEqual(ids)
    }

    // «Crear curso» con un PDF que aún se lee: el curso ya está en la biblioteca y se borra del todo entretanto
    let release = drafts.hold()
    const first = outcome(service.start(d.draftId, { ...BASE, title: 'Probabilidad', topics: 'Dados', verify: false, materialIds: ids }))
    const p1 = await packTitled('Probabilidad')
    await service.removePack(p1, () => getLibrary().deletePack(p1))
    release()
    expect(await first).toMatchObject({ code: 'not_found' })
    gone(p1)
    // otro curso con el mismo título no hereda sus materiales ni su índice
    const fresh = getLibrary().createPack(makePack({ id: '', title: 'Probabilidad' }))
    expect(fresh.id).toBe(p1)
    expect(fresh.loadPack().sources).toEqual([])
    expect(readdirSync(join(fresh.directory, 'sources'))).toEqual([])

    // terminan de leerse mientras va a la papelera (la carpeta aún existe): tampoco arranca nada
    release = drafts.hold()
    const second = outcome(service.start(d.draftId, { ...BASE, title: 'Combinatoria', topics: 'Permutaciones', verify: false, materialIds: ids }))
    const p2 = await packTitled('Combinatoria')
    await service.removePack(p2, async () => {
      release()
      await pause(30)
      await getLibrary().deletePack(p2)
    })
    expect(await second).toMatchObject({ code: 'not_found' })
    gone(p2)

    // «Pedir cambios» con materiales del borrador: igual
    const p3 = getLibrary().createPack(makePack({ id: '', title: 'Estadística' })).id
    release = drafts.hold()
    const third = outcome(service.extend(p3, `Lee los materiales nuevos «Pizarra» (borrador ${d.draftId}) y amplía el curso.`))
    await pause(20)
    await service.removePack(p3, () => getLibrary().deletePack(p3))
    release()
    expect(await third).toMatchObject({ code: 'not_found' })
    gone(p3)
    expect(team).toEqual([])
  })

  it('si lo borran y crean otro con el mismo título (el mismo id) mientras esperaba, lo pendiente del viejo no sigue en el nuevo', async () => {
    const drafts = new GatedDrafts(() => join(home, 'Drafts-R3-recrear'))
    const team: string[] = []
    const service = new GenerationService({ library: getLibrary, drafts, agents: async () => scriptedAgents(async (task) => { team.push(task.role); return '' }) })
    const d = drafts.addText(undefined, 'Ejemplo: 1/4 + 2/4 = 3/4. Las fracciones equivalentes representan la misma cantidad.', 'Pizarra')
    await drafts.idle(d.draftId)
    const ids = drafts.materials(d.draftId).map((m) => m.id)
    const recreate = async (packId: string): Promise<PackStore> => {
      await service.removePack(packId, () => getLibrary().deletePack(packId, trash))
      const fresh = getLibrary().createPack(makePack({ id: '', title: 'Trigonometría' }))
      expect(fresh.id).toBe(packId)
      return fresh
    }
    // el curso nuevo: sin ejecuciones y sin fuentes (ni en su índice ni en la carpeta)
    const untouched = (s: PackStore): void => {
      expect(service.runs().filter((r) => r.packId === s.id)).toEqual([])
      expect(s.loadPack().sources).toEqual([])
      expect(readdirSync(join(s.directory, 'sources'))).toEqual([])
    }

    // «Crear curso»: la creación vieja aún esperaba a sus materiales
    let release = drafts.hold()
    const old = outcome(service.start(d.draftId, { ...BASE, title: 'Trigonometría', topics: 'Senos', verify: false, materialIds: ids }))
    const p = await packTitled('Trigonometría')
    const fresh = await recreate(p)
    release()
    expect(await old).toMatchObject({ code: 'not_found' })
    untouched(fresh)
    expect(drafts.materials(d.draftId).map((m) => m.id)).toEqual(ids)

    // «Pedir cambios» con materiales del borrador
    release = drafts.hold()
    const extending = outcome(service.extend(p, `Lee los materiales nuevos «Pizarra» (borrador ${d.draftId}) y amplía el curso.`))
    await pause(20)
    const again = await recreate(p)
    release()
    expect(await extending).toMatchObject({ code: 'not_found' })
    untouched(again)
    expect(drafts.materials(d.draftId).map((m) => m.id)).toEqual(ids)

    // «Materiales» del curso: lo que aún se leía al añadirlo tampoco pasa al nuevo
    release = drafts.hold()
    const late = drafts.addText(undefined, 'Las razones trigonométricas relacionan los lados de un triángulo rectángulo.', 'Apuntes')
    expect(service.attachMaterials(p, late.draftId)).toEqual({ moved: 0 })
    const third = await recreate(p)
    release()
    await drafts.idle(late.draftId)
    await pause(20)
    untouched(third)
    expect(drafts.materials(late.draftId).map((m) => m.status)).toEqual(['ready'])
    expect(team).toEqual([])
  })

  it('«Reanudar» de un curso que se borra y se vuelve a crear mientras se prepara la IA: no sigue en el nuevo', async () => {
    let ready: Promise<void> = Promise.resolve()
    const service = new GenerationService({
      library: getLibrary, drafts: new DraftStore(() => join(home, 'Drafts-R3-reanudar')),
      agents: async () => {
        await ready
        return scriptedAgents(async (task) => { await new Promise((r) => task.signal.addEventListener('abort', r, { once: true })); return '' })
      }
    })
    const r = await service.start(undefined, { ...BASE, title: 'Vectores', topics: 'Módulo y dirección', verify: false })
    service.cancel(r.runId)
    await service.whenFinished(r.runId)
    let release = (): void => undefined
    ready = new Promise<void>((x) => { release = x })
    const resuming = outcome(service.resume(r.runId))
    await pause(20)
    await service.removePack(r.packId, () => getLibrary().deletePack(r.packId, trash))
    const fresh = getLibrary().createPack(makePack({ id: '', title: 'Vectores' }))
    expect(fresh.id).toBe(r.packId)
    release()
    expect(await resuming).toMatchObject({ code: 'not_found' })
    expect(service.pipeline(r.runId)).toBeUndefined()
    expect(service.runs().filter((x) => x.packId === fresh.id)).toEqual([])
  })

  it('dos «Crear curso» con el mismo borrador y título (el primero, borrado mientras esperaba): solo uno lanza el equipo', async () => {
    const drafts = new GatedDrafts(() => join(home, 'Drafts-R3-doble'))
    const service = new GenerationService({ library: getLibrary, drafts, agents: async () => scriptedAgents(async () => '') })
    const d = drafts.addText(undefined, 'Ejemplo: 1/4 + 2/4 = 3/4. Las fracciones equivalentes representan la misma cantidad.', 'Pizarra')
    await drafts.idle(d.draftId)
    const ids = drafts.materials(d.draftId).map((m) => m.id)
    const req = { ...BASE, title: 'Logaritmos', topics: 'Propiedades', verify: false, materialIds: ids }
    const release = drafts.hold()
    const first = outcome(service.start(d.draftId, req))
    const p = await packTitled('Logaritmos')
    await service.removePack(p, () => getLibrary().deletePack(p))
    const second = service.start(d.draftId, req)
    // el segundo crea el curso con el mismo id y espera a los mismos materiales
    expect(await packTitled('Logaritmos')).toBe(p)
    release()
    expect(await first).toMatchObject({ code: 'not_found' })
    const r = await second
    expect(r.packId).toBe(p)
    expect(service.runs().filter((x) => x.packId === p).map((x) => x.id)).toEqual([r.runId])
    await service.whenFinished(r.runId)
    // los materiales pasaron una sola vez, al curso que sigue
    expect(store(p).loadPack().sources).toHaveLength(1)
    expect(drafts.materials(d.draftId)).toEqual([])
  })

  it('dos «Pedir cambios» a la vez en el mismo curso: el segundo no lanza otro equipo', async () => {
    const drafts = new GatedDrafts(() => join(home, 'Drafts-R3-dos-cambios'))
    // el equipo sigue trabajando hasta que se le detiene
    const service = new GenerationService({
      library: getLibrary, drafts,
      agents: async () => scriptedAgents(async (task) => { await new Promise((r) => task.signal.addEventListener('abort', r, { once: true })); return '' })
    })
    const d = drafts.addText(undefined, 'Ejemplo: 1/4 + 2/4 = 3/4. Las fracciones equivalentes representan la misma cantidad.', 'Pizarra')
    await drafts.idle(d.draftId)
    const p = getLibrary().createPack(makePack({ id: '', title: 'Polinomios' })).id
    const ask = `Lee los materiales nuevos «Pizarra» (borrador ${d.draftId}) y amplía el curso.`
    const release = drafts.hold()
    const both = Promise.all([outcome(service.extend(p, ask)), outcome(service.extend(p, ask))])
    await pause(20)
    release()
    const codes = (await both).map((x) => (x as { code?: string }).code)
    expect(codes.filter((c) => c === 'generation_busy')).toHaveLength(1)
    const runs = service.runs().filter((x) => x.packId === p)
    expect(runs).toHaveLength(1)
    service.cancel(runs[0].id)
    await service.whenFinished(runs[0].id)
  })
})

const pause = (ms: number): Promise<void> => new Promise((x) => setTimeout(x, ms))

/** Como la papelera del sistema (sin ella, «Eliminados/<id>-<segundo>» no admite dos borrados del mismo id en el mismo segundo). */
async function trash(dir: string): Promise<void> {
  rmSync(dir, { recursive: true, force: true })
}

/** El id del curso con ese título en cuanto aparece en la biblioteca (`start` lo crea tras preparar la IA). */
async function packTitled(title: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const id = getLibrary().listPacks().find((p) => p.title === title)?.id
    if (id) return id
    await pause(5)
  }
  throw new Error(`sin curso «${title}»`)
}

/** El resultado o el error, recogido al momento (puede llegar mientras la prueba aún espera a la papelera). */
function outcome(p: Promise<unknown>): Promise<unknown> {
  return p.then((v) => v, (e: unknown) => e)
}

/** Un borrador cuyos materiales tardan en leerse lo que diga la prueba (como un PDF grande o escaneado). */
class GatedDrafts extends DraftStore {
  private gate: Promise<void> = Promise.resolve()

  hold(): () => void {
    let release = (): void => undefined
    this.gate = new Promise<void>((r) => { release = r })
    return release
  }

  override async idle(draftId: string): Promise<void> {
    await this.gate
    return super.idle(draftId)
  }
}

describe('idioma del curso y forma de las lecciones', () => {
  it('lo elegido al crear llega al curso, al progreso y al registro', async () => {
    process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
    expect(validateCreateRequest({ ...BASE, title: 'X', language: 'fr', lessonMode: 'explore' })).toMatchObject({ language: 'fr', lessonMode: 'explore' })
    const r = await svc.start(undefined, { ...BASE, title: 'Révolution française', topics: '1789, la Terreur', language: 'fr', lessonMode: 'read', verify: false })
    const st = await svc.whenFinished(r.runId)
    expect(st?.aula2.state, st?.failure).toBe('done')
    const s = store(r.packId)
    expect(s.loadPack().language).toBe('fr')
    expect(s.loadProgress().settings.lessonMode).toBe('reading')
    const raw = JSON.parse(readFileSync(join(s.runsDirectory, `${r.runId}.json`), 'utf8')) as { request: Record<string, unknown> }
    expect(raw.request).toMatchObject({ language: 'fr', lessonMode: 'reading' })
  })

  it('con fecha, el examen se llama en el idioma del curso (no «Examen» en un curso en alemán)', async () => {
    process.env.AULA_FAKE_TEAM_DELAY_MS = '40'
    const r = await svc.start(undefined, { ...BASE, title: 'Thermodynamik', topics: 'Hauptsätze', language: 'de', examDate: new Date(2026, 11, 3, 9, 0).toISOString(), verify: false })
    // nada más crearlo (antes de que el plan diga otra cosa)
    expect(store(r.packId).loadPack().exam?.title).toBe('Prüfung')
    await svc.whenFinished(r.runId)
    process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
  })

  it('sin idioma en la petición, el de «Idioma de los cursos nuevos»', async () => {
    updateSettings({ general: { courseLanguage: 'it' } })
    try {
      const r = await svc.start(undefined, { ...BASE, title: 'Rinascimento', topics: 'Firenze, i Medici', verify: false })
      expect(store(r.packId).loadPack().language).toBe('it')
      await svc.whenFinished(r.runId)
    } finally {
      updateSettings({ general: { courseLanguage: 'auto' } })
    }
  })
})

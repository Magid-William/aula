import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { makePack, type SourceMeta } from '@shared/schema'
import { DraftStore } from '../pipeline/drafts'
import { SearchIndex } from '../search/searchIndex'
import { PackStore } from '../store/packStore'
import { AssistantStore } from './store'
import { checkedAttachmentFiles, MAX_ATTACHMENT_BYTES, withAttachmentOriginals } from './attachments'
import { outputText } from './toolkit'
import { searchSourcesTool } from './tools/research'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aula-retry-files-test-')); roots.push(root)
  const store = new AssistantStore(join(root, 'Assistant')), files = store.files('thread')
  const original = join(root, 'apuntes.txt'), text = 'OWN_SENTINEL geometry triangle and its three sides.'
  writeFileSync(original, text)
  const meta: SourceMeta = { id: 'source', title: 'Apuntes', kind: 'text', addedAt: new Date().toISOString(), pages: 1, characters: text.length, status: 'ready', trust: 'other', warnings: [] }
  const source = files.saveSource(meta, [{ id: 'chunk', sourceID: meta.id, ordinal: 0, page: 1, text }], original)
  const controller = new AbortController(), checked = checkedAttachmentFiles(files, store.root, controller.signal)
  return { root, store, files, checked, source, text, controller }
}
const toolContext = () => ({ callId: 'fixture-call', signal: new AbortController().signal })

describe('búsqueda de adjuntos verificados del reintento', () => {
  it('busca texto propio sin abrir índice ni construir el proveedor de vectores', async () => {
    const f = fixture(), vectors = vi.fn(() => { throw new Error('No debe construirse') })
    const tool = searchSourcesTool(() => f.checked, vectors)
    const result = await tool.run({ query: 'geometry', source_ids: ['source'] }, toolContext())
    expect(outputText(result)).toContain('OWN_SENTINEL')
    expect(vectors).not.toHaveBeenCalled()
    expect(existsSync(join(f.files.directory, 'sources', 'index.json'))).toBe(false)
    expect(outputText(await tool.run({ query: 'geometry', source_ids: ['another-source'] }, toolContext()))).not.toContain('OWN_SENTINEL')
  })

  it.each(['thread', 'sources', 'chunks', 'index'])('no escapa al sustituir %s después de crear el wrapper', async kind => {
    const f = fixture(), outside = new PackStore('outside', join(f.root, 'outside'))
    outside.createLayout(); outside.savePack(makePack({ id: 'outside', title: 'Outside' }))
    const chunks = [{ id: 'external-chunk', sourceID: 'source', ordinal: 0, text: 'EXTERNAL_SENTINEL geometry triangle' }]
    outside.saveSource(f.source, chunks)
    const ownIndex = join(f.files.directory, 'sources', 'index.json'), outsideIndex = join(outside.directory, 'sources', 'index.json')
    writeFileSync(outsideIndex, new SearchIndex(chunks).data())
    const target = kind === 'thread' ? f.files.directory : kind === 'sources' ? join(f.files.directory, 'sources') : kind === 'chunks' ? f.files.chunksPath('source') : ownIndex
    const destination = kind === 'thread' ? outside.directory : kind === 'sources' ? join(outside.directory, 'sources') : kind === 'chunks' ? outside.chunksPath('source') : outsideIndex
    if (existsSync(target)) renameSync(target, target + '-saved')
    symlinkSync(destination, target, kind === 'thread' || kind === 'sources' ? process.platform === 'win32' ? 'junction' : 'dir' : 'file')
    const result = await Promise.resolve(searchSourcesTool(() => f.checked).run({ query: 'geometry' }, toolContext())).then(outputText, err => String(err))
    expect(result).not.toContain('EXTERNAL_SENTINEL')
    if (kind === 'index') expect(result).toContain('OWN_SENTINEL')
    else expect(result).not.toContain('OWN_SENTINEL')
  })
})

describe('originales del reintento cedidos a una tarea asíncrona', () => {
  it('captura antes de esperar, conserva nombre y permisos, y limpia después del consumidor', async () => {
    const f = fixture()
    let release!: () => void, copy = '', staging = ''
    const wait = new Promise<void>(resolve => { release = resolve })
    const operation = withAttachmentOriginals(f.checked, ['source'], async paths => {
      copy = paths[0]; staging = dirname(dirname(copy))
      expect(basename(copy)).toBe('apuntes.txt')
      expect(copy).not.toBe(f.files.originalPath(f.source))
      if (process.platform !== 'win32') {
        expect(statSync(staging).mode & 0o777).toBe(0o700)
        expect(statSync(dirname(copy)).mode & 0o777).toBe(0o700)
        expect(statSync(copy).mode & 0o777).toBe(0o600)
      }
      await wait
      return readFileSync(copy, 'utf8')
    })
    expect(existsSync(copy)).toBe(true)
    const original = f.files.originalPath(f.source)!, outside = join(f.root, 'external.txt')
    writeFileSync(outside, 'EXTERNAL_SENTINEL')
    rmSync(original); symlinkSync(outside, original, 'file')
    release()
    await expect(operation).resolves.toBe(f.text)
    expect(existsSync(staging)).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('EXTERNAL_SENTINEL')
  })

  it('la copia durable de DraftStore ya es independiente cuando termina idle', async () => {
    const f = fixture(), drafts = new DraftStore(() => join(f.root, 'Drafts'))
    let staging = ''
    const draftId = await withAttachmentOriginals(f.checked, ['source'], async paths => {
      staging = dirname(dirname(paths[0]))
      const result = drafts.addFiles(undefined, paths)
      await drafts.idle(result.draftId)
      expect(existsSync(staging)).toBe(true)
      expect(drafts.materials(result.draftId)[0].status).toBe('ready')
      return result.draftId
    })
    expect(existsSync(staging)).toBe(false)
    const meta = drafts.metas(draftId)[0]
    expect(readFileSync(join(drafts.directory(draftId), 'sources', meta.id, meta.filename!), 'utf8')).toBe(f.text)
  })

  it.each(['failure', 'cancel'])('conserva copias durante la espera y limpia tras %s', async mode => {
    const f = fixture()
    let release!: () => void, staging = ''
    const wait = new Promise<void>(resolve => { release = resolve })
    const operation = withAttachmentOriginals(f.checked, ['source'], async (paths, signal) => {
      staging = dirname(dirname(paths[0]))
      await wait
      signal?.throwIfAborted()
      throw new Error('Fixture consumer failed')
    })
    if (mode === 'cancel') f.controller.abort(new Error('Fixture cancelled'))
    expect(existsSync(staging)).toBe(true)
    release()
    await expect(operation).rejects.toThrow(mode === 'cancel' ? /cancelled/ : /failed/)
    expect(existsSync(staging)).toBe(false)
    expect(readFileSync(f.files.originalPath(f.source)!, 'utf8')).toBe(f.text)
  })

  it.each(['cancelled', 'too-large', 'symlink', 'missing'])('no inicia el consumidor si el original está %s', async mode => {
    const f = fixture(), path = f.files.originalPath(f.source)!, use = vi.fn(async () => {})
    if (mode === 'cancelled') f.controller.abort(new Error('Fixture cancelled'))
    if (mode === 'too-large') truncateSync(path, MAX_ATTACHMENT_BYTES + 1)
    if (mode === 'missing') rmSync(path)
    if (mode === 'symlink') { const outside = join(f.root, 'outside.txt'); writeFileSync(outside, 'EXTERNAL_SENTINEL'); rmSync(path); symlinkSync(outside, path, 'file') }
    await expect(withAttachmentOriginals(f.checked, ['source'], use)).rejects.toThrow()
    expect(use).not.toHaveBeenCalled()
  })

  it('conserva la omisión de transcripciones sin archivo y el flujo normal sin copias', async () => {
    const f = fixture(), { filename: _filename, ...textOnly } = f.source
    f.files.saveSource({ ...textOnly, id: 'transcript', kind: 'audio' }, [{ id: 'voice', sourceID: 'transcript', ordinal: 0, text: 'Transcripción' }])
    const selected = await withAttachmentOriginals(f.checked, ['transcript'], async paths => paths)
    expect(selected).toEqual([])
    expect(await withAttachmentOriginals(f.files, ['source'], async paths => paths)).toEqual([f.files.originalPath(f.source)])
    expect(existsSync(f.files.originalPath(f.source)!)).toBe(true)
  })

  it('deduplica los IDs antes de copiar y limita IDs y bytes agregados antes de iniciar trabajo', async () => {
    const f = fixture(), use = vi.fn(async () => {})
    await withAttachmentOriginals(f.checked, ['source', 'source', 'source'], async paths => {
      expect(paths).toHaveLength(1)
      expect(readFileSync(paths[0], 'utf8')).toBe(f.text)
    })
    await expect(withAttachmentOriginals(f.checked, Array.from({ length: 11 }, (_, i) => `source-${i}`), use)).rejects.toMatchObject({ code: 'attachment_limit' })
    const second = f.files.saveSource({ ...f.source, id: 'second' }, [], join(f.root, 'apuntes.txt'))
    // Archivos dispersos: el total se rechaza por tamaño antes de reservar memoria o copiar sus bytes.
    truncateSync(f.files.originalPath(f.source)!, MAX_ATTACHMENT_BYTES)
    truncateSync(f.files.originalPath(second)!, 1)
    await expect(withAttachmentOriginals(f.checked, ['source', 'second'], use)).rejects.toMatchObject({ code: 'attachment_limit' })
    expect(use).not.toHaveBeenCalled()
  })
})

// Adjuntos del chat (port de AssistantMedia.swift): cada archivo se prepara para la IA sin salir del equipo y queda en el almacén
// de la conversación (`AssistantStore.files`):
//   - documentos (PDF, Word, PowerPoint, Excel, EPUB, texto…): su texto con el lector de materiales (y OCR si es escaneado);
//   - imágenes: una copia (reducida si se puede) para la IA que ve imágenes + el texto que reconozca el OCR;
//   - vídeo y audio: la transcripción y los fotogramas solo si quien monta el servicio sabe hacerlo (`AttachmentMedia`).
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { IDs } from '@engine/base/ids'
import { tr } from '@shared/ai/i18n'
import type { AssistantAttachment } from '@shared/assistant/types'
import { decodePack, decodeSourceChunk, type Pack, type SourceChunk, type SourceMeta } from '@shared/schema'
import { EmptySourceError, importSourceIntoPack } from '../ingest'
import { imageInfo } from '../ingest/extract/imageInfo'
import { log } from '../log'
import { PackStore } from '../store/packStore'
import { SafePath } from '../store/safePath'
import { AulaError } from '../errors'
import { attachmentKind } from './models'

/** Lado mayor de las imágenes que se mandan a la IA (los proveedores reducen por encima de ~1,15 megapíxeles). */
export const MAX_IMAGE_SIDE = 1568
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
/** Sin poder reducirla, una imagen más grande no se manda a la IA (solo su texto). */
const MAX_RAW_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

const unavailableAttachment = (): AulaError => new AulaError('attachment_unavailable', tr('No se puede recuperar uno de los adjuntos guardados. Vuelve a adjuntarlo para enviar la pregunta.', 'One of the saved attachments is unavailable. Attach it again to send your question.'))
const snapshotLimit = (): AulaError => new AulaError('attachment_limit', tr('Este reintento puede pasar al curso hasta 10 adjuntos y 200 MB en total. Añade menos archivos desde Crear curso.', 'This retry can pass up to 10 attachments and 200 MB in total to a course. Add fewer files from Create course.'))

/** Sin enlaces bajo el almacén propio, también cuando se sustituyó una carpeta completa (assets, sources o el hilo). */
function checkedPath(path: string, root: string): void {
  const rel = relative(resolve(root), resolve(path))
  if (!rel || isAbsolute(rel) || rel.split(sep).some(p => p === '..')) throw unavailableAttachment()
  let current = resolve(root)
  for (const part of rel.split(sep)) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) throw unavailableAttachment()
  }
  if (!SafePath.isInside(realpathSync(path), realpathSync(root))) throw unavailableAttachment()
}

/** Lee el descriptor comprobado, no vuelve a abrir una ruta tras esperar al proveedor. No acepta rutas del renderer. */
export function readStoredAttachmentFile(path: string, root: string, maxBytes = MAX_ATTACHMENT_BYTES): Buffer {
  let fd: number | undefined
  try {
    checkedPath(path, root)
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.size > maxBytes) throw unavailableAttachment()
    // Detecta un cambio de destino entre comprobar y abrir; el descriptor mantiene el archivo comprobado al leer.
    checkedPath(path, root)
    const named = statSync(path)
    if (opened.dev !== named.dev || opened.ino !== named.ino) throw unavailableAttachment()
    const bytes = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const n = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (!n) throw unavailableAttachment()
      offset += n
    }
    if (fstatSync(fd).size !== opened.size) throw unavailableAttachment()
    return bytes
  } catch { throw unavailableAttachment() }
  finally { if (fd !== undefined) closeSync(fd) }
}

export function storedAttachmentAssetPath(files: PackStore, asset: string): string {
  if (!SafePath.isComponent(asset)) throw unavailableAttachment()
  return join(files.assetsDirectory, asset)
}

const checkedFiles = new WeakMap<PackStore, { root: string; signal?: AbortSignal }>()
export const isCheckedAttachmentFiles = (files: PackStore): boolean => checkedFiles.has(files)

/** Vista de lectura del almacén del reintento: las herramientas vuelven a comprobar las rutas cuando realmente leen. */
export function checkedAttachmentFiles(files: PackStore, root: string, signal?: AbortSignal): PackStore {
  class CheckedFiles extends PackStore {
    override loadPack(): Pack {
      return decodePack(JSON.parse(readStoredAttachmentFile(this.packPath, root, 16 * 1024 * 1024).toString('utf8')))
    }
    override loadChunks(sourceID: string): SourceChunk[] {
      if (!SafePath.isComponent(sourceID)) throw unavailableAttachment()
      const raw: unknown = JSON.parse(readStoredAttachmentFile(this.chunksPath(sourceID), root).toString('utf8'))
      if (!Array.isArray(raw)) throw unavailableAttachment()
      return raw.flatMap(value => { const chunk = decodeSourceChunk(value); return chunk ? [chunk] : [] })
    }
    override assetPath(asset: string): string | undefined {
      try {
        const path = storedAttachmentAssetPath(this, asset)
        checkedPath(path, root)
        return statSync(path).isFile() ? realpathSync(path) : undefined
      } catch { return undefined }
    }
    override originalPath(source: SourceMeta): string | undefined {
      if (!source.filename) return undefined
      try {
        if (!SafePath.isComponent(source.id) || !SafePath.isComponent(source.filename)) return undefined
        const path = join(this.sourceDirectory(source.id), source.filename)
        checkedPath(path, root)
        return statSync(path).isFile() ? realpathSync(path) : undefined
      } catch { return undefined }
    }
  }
  const checked = new CheckedFiles(files.id, files.directory)
  checkedFiles.set(checked, { root, signal })
  return checked
}

/** Las tareas que releen una ruta después de esperar reciben copias privadas; se conservan hasta terminar la ingestión. */
export async function withAttachmentOriginals<T>(files: PackStore | undefined, ids: readonly string[], use: (paths: string[], signal?: AbortSignal) => Promise<T>): Promise<T> {
  const checked = files && checkedFiles.get(files)
  checked?.signal?.throwIfAborted()
  if (!files || !ids.length) return use([], checked?.signal)
  let sources: SourceMeta[]
  try { sources = files.loadPack().sources } catch (err) {
    if (checked) throw err
    return use([])
  }
  let staging: string | undefined
  try {
    const selected = checked ? [...new Set(ids)] : ids
    if (checked && selected.length > MAX_ATTACHMENTS) throw snapshotLimit()
    const originals: string[] = []
    let expectedBytes = 0
    for (const id of selected) {
      checked?.signal?.throwIfAborted()
      const source = sources.find(s => s.id === id)
      if (!source) { if (checked) throw unavailableAttachment(); continue }
      const path = files.originalPath(source)
      if (!path) { if (checked && source.filename) throw unavailableAttachment(); continue }
      if (!checked) { originals.push(path); continue }
      // Conserva el prefijo léxico del almacén (/var y /private/var son alias en macOS); la lectura verifica el destino real.
      const ownPath = join(files.sourceDirectory(source.id), source.filename!)
      expectedBytes += statSync(ownPath).size
      if (expectedBytes > MAX_ATTACHMENT_BYTES) throw snapshotLimit()
      originals.push(ownPath)
    }
    if (!checked) return await use(originals)
    const paths: string[] = []
    let copiedBytes = 0
    for (const path of originals) {
      checked.signal?.throwIfAborted()
      const bytes = readStoredAttachmentFile(path, checked.root, MAX_ATTACHMENT_BYTES - copiedBytes)
      copiedBytes += bytes.length
      if (!staging) {
        staging = mkdtempSync(join(tmpdir(), 'aula-retry-originals-'))
        chmodSync(staging, 0o700)
      }
      // Dos materiales pueden llamarse igual; conservamos sus nombres/extensiones sin sobrescribirlos.
      const directory = join(staging, String(paths.length))
      mkdirSync(directory, { mode: 0o700 })
      const copy = join(directory, basename(path))
      writeFileSync(copy, bytes, { flag: 'wx', mode: 0o600 })
      paths.push(copy)
    }
    checked.signal?.throwIfAborted()
    return await use(paths, checked.signal)
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true })
  }
}

/** Antes de reintentar: todos los recursos del mensaje siguen disponibles en SU almacén, sin importar rutas antiguas. */
export function checkRetryAttachments(attachments: readonly AssistantAttachment[], files: PackStore, root: string): void {
  if (!attachments.length) return
  try {
    checkedPath(files.directory, root)
    for (const a of attachments) {
      if (a.status !== 'ready') throw unavailableAttachment()
      for (const asset of new Set([...a.imageAssets, ...(a.thumbnail ? [a.thumbnail] : [])])) {
        const path = storedAttachmentAssetPath(files, asset)
        checkedPath(path, root)
        const st = statSync(path)
        if (!st.isFile() || !st.size || st.size > MAX_ATTACHMENT_BYTES) throw unavailableAttachment()
      }
      if (a.sourceID) {
        if (!SafePath.isComponent(a.sourceID)) throw unavailableAttachment()
        const pack = decodePack(JSON.parse(readStoredAttachmentFile(files.packPath, root, 16 * 1024 * 1024).toString('utf8')))
        const source = pack.sources.find(s => s.id === a.sourceID)
        if (!source) throw unavailableAttachment()
        const chunks = JSON.parse(readStoredAttachmentFile(files.chunksPath(a.sourceID), root).toString('utf8')) as unknown
        if (!Array.isArray(chunks) || (a.characters > 0 && !chunks.some(value => decodeSourceChunk(value)?.text.trim()))) throw unavailableAttachment()
        if (source.filename) {
          if (!SafePath.isComponent(source.filename)) throw unavailableAttachment()
          const original = join(files.sourceDirectory(a.sourceID), source.filename)
          checkedPath(original, root)
          const st = statSync(original)
          if (!st.isFile() || st.size > MAX_ATTACHMENT_BYTES) throw unavailableAttachment()
        }
      }
      if (a.kind === 'image' && !a.imageAssets.length && !a.sourceID) throw unavailableAttachment()
    }
  } catch { throw unavailableAttachment() }
}

/** Lo que sabe hacer con imágenes, vídeo y audio quien monta el servicio (Electron: `nativeImage`); todo opcional. */
export interface AttachmentMedia {
  /** JPEG con el lado mayor ≤ `maxSide` (undefined = no se pudo). */
  jpeg?(path: string, maxSide: number): Promise<Uint8Array | undefined>
  /** Miniatura JPEG de cualquier archivo (la primera página de un PDF…). */
  thumbnail?(path: string): Promise<Uint8Array | undefined>
  /** Fotogramas clave de un vídeo (JPEG) y su duración en segundos. */
  frames?(path: string): Promise<{ frames: Uint8Array[]; duration?: number } | undefined>
  /** Transcripción de la voz de un audio o vídeo. */
  transcribe?(path: string, language: string): Promise<{ text: string; duration?: number } | undefined>
}

/** Un adjunto aún sin leer (para enseñarlo enseguida en el mensaje). */
export function pendingAttachment(path: string): AssistantAttachment {
  let bytes = 0
  try { bytes = statSync(path).size } catch { bytes = 0 }
  return { id: IDs.short(8), kind: attachmentKind(extname(path)), name: basename(path), bytes, status: 'processing', pages: 0, characters: 0, imageAssets: [] }
}

const isImageFile = (path: string): boolean => attachmentKind(extname(path)) === 'image'
const browserImage = (path: string): boolean => ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(path).toLowerCase())

async function importText(files: PackStore, path: string, title?: string, signal?: AbortSignal): Promise<{ id: string; pages: number; characters: number } | undefined> {
  const imported = await importSourceIntoPack(files.directory, { type: 'file', path, ...(title ? { title } : {}) }, { store: files, trust: 'other', ...(signal ? { signal } : {}) })
  return { id: imported.meta.id, pages: imported.meta.pages, characters: imported.meta.characters }
}

async function importTranscript(files: PackStore, text: string, name: string, signal?: AbortSignal): Promise<{ id: string; characters: number } | undefined> {
  try {
    const imported = await importSourceIntoPack(files.directory, { type: 'text', text, title: tr(`${name} (transcripción)`, `${name} (transcript)`) }, { store: files, trust: 'other', ...(signal ? { signal } : {}) })
    return { id: imported.meta.id, characters: imported.meta.characters }
  } catch {
    return undefined
  }
}

/** Píxeles como mucho para decodificar una imagen del chat en el proceso principal (un móvil de 48 Mpx cabe). */
export const CHAT_MAX_DECODE_PIXELS = 60_000_000

/**
 * ¿La imagen tiene más píxeles de los que se pueden decodificar aquí? Se mira solo la cabecera (A2-P2-15: un PNG de 281 KB y
 * 17 000 × 17 000 píxeles llevaba el proceso principal a 2,3 GB, dos veces). Si no se sabe, false.
 */
export function imageTooLargeToDecode(path: string, maxPixels = CHAT_MAX_DECODE_PIXELS): boolean {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const head = new Uint8Array(1024 * 1024)
    const n = readSync(fd, head, 0, head.length, 0)
    const info = imageInfo(head.subarray(0, n))
    return !!info && info.width > 0 && info.height > 0 && info.width * info.height > maxPixels
  } catch {
    return false
  } finally {
    if (fd !== null) try { closeSync(fd) } catch { /* nada */ }
  }
}

/** Una copia de la imagen para la IA (reducida si se puede) y su miniatura. */
async function imageAssets(path: string, files: PackStore, media: AttachmentMedia | undefined): Promise<{ asset?: string; thumbnail?: string }> {
  const out: { asset?: string; thumbnail?: string } = {}
  // una imagen gigantesca no se decodifica aquí (su texto lo sigue leyendo el lector aparte, con su propio tope)
  if (imageTooLargeToDecode(path)) media = undefined
  try {
    const big = await media?.jpeg?.(path, MAX_IMAGE_SIDE)
    if (big?.length) out.asset = files.addAsset(big, 'jpg')
    else if (browserImage(path) && statSync(path).size <= MAX_RAW_IMAGE_BYTES) out.asset = files.addAsset(readFileSync(path), extname(path).slice(1).toLowerCase().replace('jpeg', 'jpg'))
    const small = await media?.jpeg?.(path, 360)
    out.thumbnail = small?.length ? files.addAsset(small, 'jpg') : out.asset
  } catch (err) {
    log.debug('Chat: no pude copiar la imagen', err)
  }
  return out
}

/** Lee un archivo adjunto y lo deja en el almacén de la conversación. Nunca lanza: si falla, el adjunto dice por qué. */
export async function processAttachment(path: string, base: AssistantAttachment, files: PackStore, opts: { media?: AttachmentMedia; language: string; signal?: AbortSignal }): Promise<AssistantAttachment> {
  const a: AssistantAttachment = { ...base, status: 'processing', imageAssets: [...base.imageAssets] }
  const fail = (note: string): AssistantAttachment => ({ ...a, status: 'failed', note })
  let size = 0
  try { size = statSync(path).size } catch { return fail(tr('No encuentro el archivo.', "I can't find the file.")) }
  a.bytes = size
  if (size > MAX_ATTACHMENT_BYTES) return fail(tr('Es demasiado grande (máximo 200 MB).', "It's too big (200 MB max)."))
  const media = opts.media
  switch (a.kind) {
    case 'image': {
      const img = await imageAssets(path, files, media)
      if (img.asset) a.imageAssets = [img.asset]
      if (img.thumbnail) a.thumbnail = img.thumbnail
      // el texto de la imagen (OCR): sirve aunque la IA no vea imágenes
      try {
        const t = await importText(files, path, undefined, opts.signal)
        if (t && t.characters > 0) { a.sourceID = t.id; a.characters = t.characters }
      } catch { /* sin texto */ }
      if (!a.imageAssets.length && !a.sourceID) return fail(tr('No pude abrir la imagen.', "I couldn't open the image."))
      a.status = 'ready'
      return a
    }
    case 'video': case 'audio': {
      if (a.kind === 'video') {
        const f = await media?.frames?.(path).catch(() => undefined)
        if (f) {
          if (f.duration) a.duration = f.duration
          f.frames.slice(0, 6).forEach((frame, i) => {
            try {
              const id = files.addAsset(frame, 'jpg')
              a.imageAssets.push(id)
              if (i === 0) a.thumbnail = id
            } catch { /* sin fotograma */ }
          })
        }
      }
      const heard = await media?.transcribe?.(path, opts.language).catch(() => undefined)
      if (heard?.duration && !a.duration) a.duration = heard.duration
      const text = heard?.text.trim() ?? ''
      if (text) {
        a.transcript = text
        const t = await importTranscript(files, text, a.name, opts.signal)
        if (t) { a.sourceID = t.id; a.characters = t.characters }
      }
      if (a.kind === 'audio' && !text) return fail(media?.transcribe ? tr('No pude transcribirlo.', "I couldn't transcribe it.") : tr('Este equipo aún no sabe transcribir audio.', "This computer can't transcribe audio yet."))
      if (a.kind === 'video' && !a.imageAssets.length && !text) return fail(tr('No pude leer el vídeo.', "I couldn't read the video."))
      a.status = 'ready'
      if (a.kind === 'video' && !text) a.note = tr('Solo la imagen (sin voz que transcribir)', 'Only the picture (no speech to transcribe)')
      return a
    }
    default: {
      try {
        const t = await importText(files, path, undefined, opts.signal)
        if (t) { a.sourceID = t.id; a.pages = t.pages; a.characters = t.characters }
        a.status = 'ready'
        if (!a.characters) a.note = tr('Sin texto legible', 'No readable text')
      } catch (err) {
        if (err instanceof EmptySourceError) return { ...a, status: 'ready', note: tr('Sin texto legible', 'No readable text') }
        // una imagen que no sabíamos clasificar por su extensión
        if (isImageFile(path) || a.kind === 'other') {
          const img = await imageAssets(path, files, media)
          if (img.asset) return { ...a, kind: 'image', imageAssets: [img.asset], ...(img.thumbnail ? { thumbnail: img.thumbnail } : {}), status: 'ready' }
        }
        return fail(err instanceof Error ? err.message : String(err))
      }
      try {
        const thumb = await media?.thumbnail?.(path)
        if (thumb?.length) a.thumbnail = files.addAsset(thumb, 'jpg')
      } catch { /* sin miniatura */ }
      return a
    }
  }
}

import { extname, isAbsolute } from 'node:path'
import { serializeFigureSvg } from '@engine/figures/svg'
import { FigureValidationError, type FigureSaveResult } from '@shared/figures'
import { tr } from '@shared/ai/i18n'
import { AulaError, invalidArgs } from '../errors'
import { writeFileAtomic } from '../fs'
import { canonicalizeFigurePng } from './png'

type Format = 'svg' | 'png'
type ChoosePath = (name: string, format: Format) => Promise<string | null>
const invalid = () => invalidArgs(tr('No se puede exportar esa figura.', 'This figure cannot be exported.'))

function input(value: unknown): { suggestedName: string; format: Format; payload: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const v = value as Record<string, unknown>
  if (v.format !== 'svg' && v.format !== 'png') throw invalid()
  const field = v.format === 'svg' ? 'svg' : 'data'
  if (Object.keys(v).some(k => !['suggestedName', 'format', field].includes(k))) throw invalid()
  if (typeof v.suggestedName !== 'string' || !v.suggestedName.trim() || v.suggestedName.length > 200) throw invalid()
  return { suggestedName: v.suggestedName, format: v.format, payload: v[field] }
}

function filename(name: string, format: Format): string {
  let base = name.replace(/\.(?:svg|png)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 160)
  if (!base || /^\.+$/.test(base)) base = 'Aula'
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base)) base = `Aula-${base}`
  return `${base}.${format}`
}

/** Un diálogo a la vez, con permisos de revelado ligados al emisor que guardó el archivo. */
export class FigureExports {
  private busy = false
  private readonly saved = new WeakMap<object, Set<string>>()
  constructor(private readonly write: (path: string, data: Uint8Array) => void = writeFileAtomic) {}

  async save(value: unknown, owner: object, choose: ChoosePath): Promise<FigureSaveResult | null> {
    if (this.busy) throw new AulaError('busy', tr('Termina de guardar la figura anterior.', 'Finish saving the previous figure.'))
    this.busy = true
    try {
      const args = input(value)
      let bytes: Buffer
      try {
        bytes = args.format === 'svg' ? Buffer.from(serializeFigureSvg(args.payload), 'utf8') : await canonicalizeFigurePng(args.payload)
      } catch (error) {
        if (error instanceof FigureValidationError && error.reason === 'too_large') throw new AulaError('too_large', tr('La figura es demasiado grande para exportarla.', 'The figure is too large to export.'))
        throw invalid()
      }
      const path = await choose(filename(args.suggestedName, args.format), args.format)
      if (path === null) return null
      // La ruta viene exclusivamente del diálogo nativo; el contenido y la extensión deben coincidir.
      if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || extname(path).toLowerCase() !== `.${args.format}`) {
        throw invalidArgs(tr(`Elige un archivo .${args.format}.`, `Choose a .${args.format} file.`))
      }
      try { this.write(path, bytes) } catch { throw new AulaError('write_failed', tr('No se pudo guardar la figura.', 'The figure could not be saved.')) }
      let grants = this.saved.get(owner)
      if (!grants) { grants = new Set(); this.saved.set(owner, grants) }
      grants.delete(path); grants.add(path)
      if (grants.size > 100) grants.delete(grants.values().next().value!)
      return { path }
    } finally { this.busy = false }
  }

  revealPath(owner: object, value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) throw invalid()
    const path = (value as { path?: unknown }).path
    if (typeof path !== 'string' || !this.saved.get(owner)?.has(path)) {
      throw new AulaError('forbidden', tr('Sólo se pueden mostrar las figuras que acabas de guardar.', 'Only figures you have saved can be revealed.'))
    }
    return path
  }

  forget(owner: object): void { this.saved.delete(owner) }
}

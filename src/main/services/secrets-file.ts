// Almacén de secretos en un archivo (`secrets.enc`) con un cifrado que se inyecta (safeStorage en la app, uno falso en las
// pruebas). Lo importante: si el archivo existe pero NO se puede leer (el estudiante pulsó «Denegar» en el aviso del
// llavero, el llavero está bloqueado, en Linux aún no se abrió o la clave cambió), el almacén queda BLOQUEADO:
//   - las lecturas devuelven «no hay» (nada se rompe), pero NO se escribe nada: `set`/`delete` lanzan `secrets_locked`;
//   - el archivo original se conserva intacto, y se reintenta leerlo (al pedirlo el estudiante o, solo, cada pocos minutos;
//     en macOS un fallo del llavero no: el sistema lo lee una vez por ejecución y, si se denegó, solo reabrir Aula vuelve a
//     preguntar);
//   - «Empezar de cero» lo aparta como `secrets.unreadable-<fecha>.enc` (nunca se borra) y deja el almacén vacío; no se
//     ofrece si el sistema no deja cifrar (tras «Denegar» en macOS el archivo se leerá bien al reabrir Aula).
// Antes, un solo fallo dejaba la caché en `{}` y la siguiente escritura (las cookies, cada 5 minutos) sobrescribía el
// archivo: se perdían para siempre todas las claves de API y las sesiones de las plataformas.
// Sin cifrado del sistema solo se guarda en claro en Linux sin llavero ('basic'). En macOS y Windows ('unavailable': aviso
// del llavero denegado) no se escribe NADA hasta que se pueda cifrar: ni en claro ni un archivo vacío.
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { backupPath, writeFileAtomic } from './fs'
import { AulaError } from './errors'
import { log } from './log'
import { tr } from '@shared/ai/i18n'
import type { SecretStore } from './secrets'

export const MAGIC_ENC = 'AULA-SEC1:'
export const MAGIC_PLAIN = 'AULA-PLN1:'

/**
 * Cómo se cifra: 'os' = cifrado del sistema; 'basic' = sin cifrado real (solo Linux sin llavero: en claro con permisos
 * 0600); 'unavailable' = el cifrado del sistema no está disponible ahora (macOS o Windows): no se escribe nada.
 */
export type SecretProtection = 'os' | 'basic' | 'unavailable'

export interface SecretCipher {
  protection(): SecretProtection
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

/** decrypt/corrupt/io = el archivo no se lee; unavailable = no se puede cifrar, así que no se escribe. */
export type SecretsLockReason = 'decrypt' | 'corrupt' | 'io' | 'unavailable'

/** Estado del almacén (lo ve la interfaz). */
export interface SecretsStatus {
  /** true = no se puede leer o no se puede escribir (nada se guarda ni se borra). */
  locked: boolean
  reason?: SecretsLockReason
  /** Cuándo se intentó leer por última vez (ISO). */
  checkedAt?: string
  /** Solo reabrir Aula lo arregla (macOS tras «Denegar»: no deja cifrar ni descifrar en toda la ejecución). */
  needsRestart?: boolean
  /** «Empezar de cero» sirve: el archivo no se lee y se podrá volver a escribir. Si el sistema no deja cifrar, no: apartaría
   *  un archivo que quizá se lee bien al reabrir Aula, y aun así no se guardaría nada. */
  canReset?: boolean
}

export interface FileSecretStoreOptions {
  /** Cada cuánto se reintenta leer solo, al acceder, mientras está bloqueado (por defecto, 5 minutos). Con `restartToRetry`
   *  un fallo del llavero ('decrypt') no se reintenta solo (no serviría en esa ejecución); uno de lectura ('io', 'corrupt'), sí. */
  retryEveryMs?: number
  now?: () => number
  /** Cambió el estado (bloqueado ↔ abierto, o el motivo). */
  onChange?: (status: SecretsStatus) => void
  /** macOS: el sistema lee el llavero una sola vez por proceso (también si se denegó). Si entonces no deja cifrar, reintentar
   *  dentro de la misma ejecución no sirve y el estado pide reabrir Aula; si deja (la clave cambió), se reintenta aquí. */
  restartToRetry?: boolean
}

export function secretsLockedError(needsRestart = false): AulaError {
  return new AulaError(
    'secrets_locked',
    needsRestart
      ? tr(
        'Aula no puede abrir el llavero del sistema, así que por ahora no guarda ni borra claves ni sesiones (las que tenías siguen a salvo). Reabre Aula desde el aviso de la barra lateral y, cuando el sistema lo pida, permite el acceso.',
        "Aula can't open the system keychain, so for now it won't save or remove keys or sessions (the ones you had are safe). Reopen Aula from the notice in the sidebar and allow access when your system asks."
      )
      : tr(
        'Aula no puede abrir el llavero del sistema, así que por ahora no guarda ni borra claves ni sesiones (las que tenías siguen a salvo). Reinténtalo desde el aviso de la barra lateral.',
        "Aula can't open the system keychain, so for now it won't save or remove keys or sessions (the ones you had are safe). Try again from the notice in the sidebar."
      ),
    { aiReason: "Aula can't open the system keychain right now, so it can't save or remove keys or sessions (the existing ones are safe)." }
  )
}

/** Motivos en los que ya se preguntó al llavero (así, mirar si deja cifrar no muestra el aviso del sistema por eso). */
const KEYCHAIN_REASONS: ReadonlySet<SecretsLockReason> = new Set(['decrypt', 'unavailable'])

/** «secrets.enc» → «secrets.unreadable-2026-10-27T09-30-00.enc» (en la misma carpeta). */
export function unreadableCopyPath(file: string, date: Date): string {
  const stamp = date.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-')
  const name = basename(file)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return join(dirname(file), `${stem}.unreadable-${stamp}${ext}`)
}

class Unreadable extends Error {
  constructor(readonly reason: SecretsLockReason, message: string) {
    super(message)
  }
}

export class FileSecretStore implements SecretStore {
  private cache: Record<string, string> | null = null
  private lock: { reason: SecretsLockReason; at: number } | null = null
  /** Desde cuándo no se puede cifrar (no se escribe nada); null = se puede, o aún no se ha visto que no. */
  private unavailableAt: number | null = null
  /** El sistema decía que sí, pero cifrar falló (o no dio nada): no se vuelve a dar por bueno hasta «Reintentar». */
  private encryptFailed = false
  /** El último estado avisado con `onChange`. */
  private shown = 'open'
  private readonly retryEveryMs: number
  private readonly now: () => number

  constructor(private readonly file: () => string, private readonly cipher: SecretCipher, private readonly opts: FileSecretStoreOptions = {}) {
    this.retryEveryMs = opts.retryEveryMs ?? 5 * 60_000
    this.now = opts.now ?? Date.now
  }

  // MARK: SecretStore

  get(key: string): string | null {
    return this.load()?.[key] ?? null
  }

  set(key: string, value: string): void {
    this.save({ ...this.writable(), [key]: value })
  }

  delete(key: string): void {
    const m = this.writable()
    if (!(key in m)) return
    const next = { ...m }
    delete next[key]
    this.save(next)
  }

  keys(): string[] {
    return Object.keys(this.load() ?? {})
  }

  /** true = no se puede leer el archivo, o no se puede cifrar (lo que falte puede estar ahí o no poder guardarse). */
  locked(): boolean {
    return this.load() === null || !this.canWrite()
  }

  // MARK: Estado y salidas

  status(): SecretsStatus {
    this.load()
    if (!this.lock) this.canWrite()
    return this.current()
  }

  /** Vuelve a intentar leer el archivo ahora mismo (botón «Reintentar»; en macOS tras «Denegar» solo sirve reabrir Aula). */
  retry(): SecretsStatus {
    if (this.lock) this.lock.at = -Infinity
    this.encryptFailed = false
    return this.status()
  }

  /**
   * «Empezar de cero»: aparta el archivo que no se puede leer (no se borra: si el llavero vuelve, se puede recuperar) y
   * deja el almacén vacío. Si ya se puede leer, no hace nada. Si además no se puede cifrar (macOS tras «Denegar»), sigue sin
   * escribirse nada (ni en claro) hasta que se pueda: en macOS, al reabrir Aula. Por eso la interfaz solo lo ofrece con
   * `canReset`.
   */
  reset(): { status: SecretsStatus; movedTo?: string } {
    if (this.retry().locked === false || !this.lock) return { status: this.status() }
    const file = this.file()
    let movedTo: string | undefined
    if (existsSync(file)) {
      movedTo = unreadableCopyPath(file, new Date(this.now()))
      renameSync(file, movedTo)
      log.warn(`[secretos] el archivo que no se podía leer queda apartado en ${basename(movedTo)}`)
    }
    this.cache = {}
    this.setLock(null)
    return { status: this.status(), ...(movedTo ? { movedTo } : {}) }
  }

  /** El estado ya calculado (sin leer el archivo; al cifrado solo se le pregunta si ya se usó el llavero). */
  private current(): SecretsStatus {
    const block = this.lock ?? (this.unavailableAt != null ? { reason: 'unavailable' as const, at: this.unavailableAt } : null)
    if (!block) return { locked: false }
    return {
      locked: true,
      reason: block.reason,
      ...(Number.isFinite(block.at) ? { checkedAt: new Date(block.at).toISOString() } : {}),
      ...(this.needsRestart(block.reason) ? { needsRestart: true } : {}),
      // solo hay algo que apartar si el archivo no se lee, y solo sirve si después se podrá cifrar
      ...(this.lock && !this.keychainDenied(this.lock.reason) ? { canReset: true } : {})
    }
  }

  // MARK: Lectura y escritura

  /** Los secretos, o null si el archivo existe y no se puede leer (bloqueado). */
  private load(): Record<string, string> | null {
    if (this.cache) return this.cache
    if (this.lock && this.now() - this.lock.at < this.retryAfter(this.lock.reason)) return null
    const file = this.file()
    if (!existsSync(file)) {
      this.cache = {}
      this.setLock(null)
      return this.cache
    }
    try {
      this.cache = this.readFile(file)
    } catch (err) {
      // el principal no se lee: la copia anterior (solo ayuda si el archivo quedó dañado; con el llavero cerrado, tampoco)
      const bak = backupPath(file)
      if (existsSync(bak)) {
        try {
          this.cache = this.readFile(bak)
          log.warn('[secretos] secrets.enc estaba dañado: se usa la copia anterior')
        } catch { /* abajo */ }
      }
      if (!this.cache) {
        const reason = err instanceof Unreadable ? err.reason : 'io'
        log.error(`[secretos] no se pudo leer secrets.enc (${reason}): el almacén queda bloqueado y el archivo intacto`, err instanceof Error ? err.message : String(err))
        this.setLock({ reason, at: this.now() })
        return null
      }
    }
    this.setLock(null)
    return this.cache
  }

  private readFile(file: string): Record<string, string> {
    let raw: Buffer
    try {
      raw = readFileSync(file)
    } catch (err) {
      throw new Unreadable('io', err instanceof Error ? err.message : String(err))
    }
    const head = raw.subarray(0, MAGIC_ENC.length).toString('utf8')
    let json: string
    if (head === MAGIC_ENC) {
      try {
        json = this.cipher.decrypt(raw.subarray(MAGIC_ENC.length))
      } catch (err) {
        throw new Unreadable('decrypt', err instanceof Error ? err.message : String(err))
      }
    } else if (head === MAGIC_PLAIN) {
      json = raw.subarray(MAGIC_PLAIN.length).toString('utf8')
    } else {
      throw new Unreadable('corrupt', 'cabecera desconocida')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      throw new Unreadable('corrupt', 'JSON ilegible')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Unreadable('corrupt', 'no es un objeto')
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
    return out
  }

  private writable(): Record<string, string> {
    const m = this.load()
    if (!m) throw secretsLockedError(this.needsRestart(this.lock?.reason))
    return m
  }

  /** Escribe `m` y, solo si se escribió, pasa a ser la caché (si falla, en memoria queda lo que hay en el disco). */
  private save(m: Record<string, string>): void {
    const json = JSON.stringify(m)
    const protection = this.cipher.protection()
    if (protection === 'basic') {
      // solo Linux sin llavero (la clave de safeStorage sería fija: no protege nada); se avisa en Ajustes
      log.warn('El sistema no ofrece cifrado: los secretos se guardan con permisos 0600 sin cifrar')
      writeFileAtomic(this.file(), Buffer.from(MAGIC_PLAIN + json, 'utf8'), { mode: 0o600, backup: true })
    } else {
      const enc = protection === 'os' ? this.encrypt(json) : null
      if (!enc) {
        // sin cifrado (aviso del llavero denegado) o cifrar falló: ni en claro ni vacío; el archivo queda como estaba
        if (protection === 'os') this.encryptFailed = true
        this.markUnavailable(true)
        log.warn('[secretos] el sistema no deja cifrar: no se guarda nada hasta que se pueda')
        throw secretsLockedError(this.needsRestart('unavailable'))
      }
      writeFileAtomic(this.file(), Buffer.concat([Buffer.from(MAGIC_ENC, 'utf8'), enc]), { mode: 0o600, backup: true })
    }
    this.cache = m
    this.encryptFailed = false
    this.markUnavailable(false)
  }

  /** El texto cifrado, o null si no se pudo (un cifrado vacío tampoco vale: nunca se escribe un archivo sin contenido). */
  private encrypt(json: string): Buffer | null {
    try {
      const enc = this.cipher.encrypt(json)
      return enc.length > 0 ? enc : null
    } catch {
      return null
    }
  }

  /** ¿Se puede escribir ahora? En macOS y Windows sin cifrado, no (y queda en el estado). */
  private canWrite(): boolean {
    const ok = this.cipher.protection() !== 'unavailable' && !this.encryptFailed
    this.markUnavailable(!ok)
    return ok
  }

  /** ¿El llavero no deja cifrar (ni descifrar) ahora? Solo se pregunta si ya se le preguntó (motivo del llavero). */
  private keychainDenied(reason: SecretsLockReason): boolean {
    return KEYCHAIN_REASONS.has(reason) && this.cipher.protection() === 'unavailable'
  }

  /** Solo reabrir Aula lo arregla: macOS y el llavero no deja cifrar (tras «Denegar», en toda la ejecución). Si deja (la
   *  clave cambió o se recreó la entrada del llavero), reabrir no sirve: se reintenta aquí o se empieza de cero. */
  private needsRestart(reason: SecretsLockReason | undefined): boolean {
    return !!this.opts.restartToRetry && reason != null && this.keychainDenied(reason)
  }

  /** Cada cuánto se relee solo. macOS: un fallo del llavero no (se lee una vez por ejecución); uno de lectura, como siempre. */
  private retryAfter(reason: SecretsLockReason): number {
    return this.opts.restartToRetry && reason === 'decrypt' ? Infinity : this.retryEveryMs
  }

  private markUnavailable(on: boolean): void {
    if (on) this.unavailableAt ??= this.now()
    else this.unavailableAt = null
    this.publish()
  }

  /** Sin bloqueo de lectura, el estado depende de si se puede cifrar: se mira antes de avisar (sin un «abierto» de paso). */
  private setLock(next: { reason: SecretsLockReason; at: number } | null): void {
    this.lock = next
    if (next) this.publish()
    else this.canWrite()
  }

  /** Avisa si cambió lo que ve la interfaz (bloqueado o no, y por qué). */
  private publish(): void {
    const s = this.current()
    const key = s.locked ? `${s.reason ?? ''}${s.needsRestart ? ':restart' : ''}${s.canReset ? ':reset' : ''}` : 'open'
    if (key === this.shown) return
    this.shown = key
    this.opts.onChange?.(s)
  }
}

// J3-1 (P0): si el llavero no deja descifrar secrets.enc una vez, NO se pierde nada (antes la siguiente escritura —las
// cookies, cada 5 minutos— sobrescribía el archivo con solo la clave nueva).
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSecretStore, MAGIC_ENC, MAGIC_PLAIN, unreadableCopyPath, type SecretCipher, type SecretProtection, type SecretsStatus } from './secrets-file'
import { AulaError } from './errors'
import { backupPath } from './fs'

/** Cifrado de juguete que se puede «cerrar» (como un llavero denegado o bloqueado). */
function fakeCipher(): SecretCipher & { open: boolean } {
  const c = {
    open: true,
    protection: () => 'os' as const,
    encrypt: (text: string) => Buffer.from(Buffer.from(text, 'utf8').toString('base64'), 'utf8'),
    decrypt: (data: Buffer) => {
      if (!c.open) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
      return Buffer.from(data.toString('utf8'), 'base64').toString('utf8')
    }
  }
  return c
}

/**
 * Como safeStorage en macOS o Windows: `available` = el sistema deja cifrar (en macOS, tras «Denegar», no vuelve a dejar
 * en toda la ejecución); `readable` = descifra el archivo. `basic` imita Linux sin llavero.
 */
function systemCipher(opts: { available?: boolean; readable?: boolean; basic?: boolean; emptyCipher?: boolean } = {}) {
  const c = {
    available: opts.available ?? true,
    readable: opts.readable ?? true,
    basic: opts.basic ?? false,
    emptyCipher: opts.emptyCipher ?? false,
    encrypts: 0,
    decrypts: 0,
    protection: (): SecretProtection => (c.basic ? 'basic' : c.available ? 'os' : 'unavailable'),
    encrypt: (text: string): Buffer => {
      if (!c.available) throw new Error('Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.')
      c.encrypts++
      return c.emptyCipher ? Buffer.alloc(0) : Buffer.from(Buffer.from(text, 'utf8').toString('base64'), 'utf8')
    },
    decrypt: (data: Buffer): string => {
      c.decrypts++
      if (!c.available || !c.readable) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString. Decryption is not available.')
      return Buffer.from(data.toString('utf8'), 'base64').toString('utf8')
    }
  }
  return c
}

/** Ningún archivo de la carpeta lleva secretos en claro. */
function noPlaintextIn(folder: string): boolean {
  return readdirSync(folder).every((name) => !readFileSync(join(folder, name)).subarray(0, MAGIC_PLAIN.length).equals(Buffer.from(MAGIC_PLAIN)))
}

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aula-secrets-'))
  file = join(dir, 'secrets.enc')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function seed(cipher: SecretCipher, data: Record<string, string>): Buffer {
  const bytes = Buffer.concat([Buffer.from(MAGIC_ENC), cipher.encrypt(JSON.stringify(data))])
  writeFileSync(file, bytes)
  return bytes
}

const ORIGINAL = { 'ai.key.openai': 'sk-1', 'ai.key.anthropic': 'sk-2', 'platform.cookies.canvas': '{"v":1}' }

describe('FileSecretStore', () => {
  it('sin archivo: empieza vacío, escribe cifrado y lo vuelve a leer', () => {
    const c = fakeCipher()
    const s = new FileSecretStore(() => file, c)
    expect(s.keys()).toEqual([])
    s.set('a', '1')
    expect(readFileSync(file).subarray(0, MAGIC_ENC.length).toString()).toBe(MAGIC_ENC)
    expect(new FileSecretStore(() => file, c).get('a')).toBe('1')
    expect(s.status()).toEqual({ locked: false })
  })

  it('PoC de J3: con el llavero cerrado, la siguiente escritura NO sobrescribe el archivo (antes se perdía todo)', () => {
    const c = fakeCipher()
    const before = seed(c, ORIGINAL)
    c.open = false
    const changes: SecretsStatus[] = []
    const s = new FileSecretStore(() => file, c, { onChange: (st) => changes.push(st) })
    expect(s.keys()).toEqual([])
    expect(s.get('ai.key.openai')).toBeNull()
    expect(s.locked()).toBe(true)
    // lo que hacía saveCookieSnapshot a los 5 minutos
    expect(() => s.set('platform.cookies.acc1', '{"v":1,"cookies":[]}')).toThrowError(AulaError)
    try { s.set('x', 'y') } catch (e) { expect((e as AulaError).code).toBe('secrets_locked') }
    expect(() => s.delete('ai.key.openai')).toThrowError(/llavero|keychain/)
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(s.status()).toMatchObject({ locked: true, reason: 'decrypt', canReset: true })
    expect(s.status().needsRestart).toBeUndefined()
    expect(changes).toEqual([expect.objectContaining({ locked: true, reason: 'decrypt' })])
  })

  it('«Reintentar» con el llavero ya abierto: vuelven todas las claves y las escrituras las conservan', () => {
    const c = fakeCipher()
    seed(c, ORIGINAL)
    c.open = false
    const changes: SecretsStatus[] = []
    const s = new FileSecretStore(() => file, c, { onChange: (st) => changes.push(st) })
    expect(s.locked()).toBe(true)
    c.open = true
    // sin reintento explícito no vuelve a preguntar al llavero en cada acceso
    expect(s.locked()).toBe(true)
    expect(s.retry()).toEqual({ locked: false })
    expect(s.get('ai.key.anthropic')).toBe('sk-2')
    s.set('platform.cookies.acc1', 'nuevo')
    const again = new FileSecretStore(() => file, c)
    expect(again.keys().sort()).toEqual([...Object.keys(ORIGINAL), 'platform.cookies.acc1'].sort())
    expect(changes.map((x) => x.locked)).toEqual([true, false])
  })

  it('reintenta solo, como mucho cada `retryEveryMs`', () => {
    const c = fakeCipher()
    seed(c, ORIGINAL)
    c.open = false
    let now = 1_000_000
    const s = new FileSecretStore(() => file, c, { retryEveryMs: 60_000, now: () => now })
    expect(s.locked()).toBe(true)
    c.open = true
    now += 30_000
    expect(s.locked()).toBe(true)
    now += 31_000
    expect(s.locked()).toBe(false)
    expect(s.get('ai.key.openai')).toBe('sk-1')
  })

  it('«Empezar de cero» aparta el archivo (no lo borra) y deja escribir', () => {
    const c = fakeCipher()
    const before = seed(c, ORIGINAL)
    c.open = false
    const s = new FileSecretStore(() => file, c, { now: () => Date.parse('2026-10-27T09:30:00Z') })
    expect(s.locked()).toBe(true)
    const r = s.reset()
    expect(r.status).toEqual({ locked: false })
    expect(r.movedTo).toBe(join(dir, 'secrets.unreadable-2026-10-27T09-30-00.enc'))
    expect(readFileSync(r.movedTo!).equals(before)).toBe(true)
    expect(existsSync(file)).toBe(false)
    s.set('ai.key.openai', 'sk-nueva')
    expect(s.keys()).toEqual(['ai.key.openai'])
    // y si el llavero vuelve, la copia apartada se puede recuperar
    c.open = true
    const copy = new FileSecretStore(() => r.movedTo!, c)
    expect(copy.get('ai.key.anthropic')).toBe('sk-2')
  })

  it('«Empezar de cero» no hace nada si ya se puede leer', () => {
    const c = fakeCipher()
    seed(c, ORIGINAL)
    const s = new FileSecretStore(() => file, c)
    expect(s.reset()).toEqual({ status: { locked: false } })
    expect(s.get('ai.key.openai')).toBe('sk-1')
    expect(readdirSync(dir)).toEqual(['secrets.enc'])
  })

  it('archivo dañado: usa la copia anterior si la hay; si no, se bloquea (corrupt) sin tocar nada', () => {
    const c = fakeCipher()
    const s1 = new FileSecretStore(() => file, c)
    s1.set('a', '1')
    s1.set('b', '2') // deja .secrets.enc.bak con {a}
    expect(existsSync(backupPath(file))).toBe(true)
    writeFileSync(file, 'basura')
    expect(new FileSecretStore(() => file, c).get('a')).toBe('1')
    rmSync(backupPath(file))
    const s3 = new FileSecretStore(() => file, c)
    expect(s3.status()).toMatchObject({ locked: true, reason: 'corrupt', canReset: true })
    expect(readFileSync(file, 'utf8')).toBe('basura')
  })

  it('macOS/Windows sin cifrado: no se escribe nada (ni en claro ni vacío) y el error lo dice', () => {
    const c = systemCipher({ available: false })
    const changes: SecretsStatus[] = []
    const s = new FileSecretStore(() => file, c, { onChange: (st) => changes.push(st) })
    expect(s.keys()).toEqual([])
    try {
      s.set('ai.key.openai', 'sk-nueva')
      expect.unreachable()
    } catch (e) {
      expect((e as AulaError).code).toBe('secrets_locked')
    }
    expect(existsSync(file)).toBe(false)
    expect(readdirSync(dir)).toEqual([])
    // lo que no se pudo guardar tampoco queda en memoria
    expect(s.get('ai.key.openai')).toBeNull()
    expect(s.locked()).toBe(true)
    expect(s.status()).toMatchObject({ locked: true, reason: 'unavailable' })
    expect(s.status().needsRestart).toBeUndefined()
    // no hay archivo que apartar
    expect(s.status().canReset).toBeUndefined()
    expect(changes).toEqual([expect.objectContaining({ locked: true, reason: 'unavailable' })])
  })

  it('el cifrado deja de estar disponible después de abrir: el archivo y su copia quedan intactos', () => {
    const c = systemCipher()
    const s = new FileSecretStore(() => file, c)
    s.set('ai.key.openai', 'sk-1')
    s.set('ai.key.anthropic', 'sk-2') // deja .secrets.enc.bak con {openai}
    const before = readFileSync(file)
    const bakBefore = readFileSync(backupPath(file))
    expect(s.get('ai.key.anthropic')).toBe('sk-2')
    c.available = false
    expect(() => s.set('platform.cookies.acc1', '{"v":1,"cookies":[]}')).toThrowError(/llavero|keychain/)
    expect(() => s.delete('ai.key.openai')).toThrowError(/llavero|keychain/)
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(readFileSync(backupPath(file)).equals(bakBefore)).toBe(true)
    expect(noPlaintextIn(dir)).toBe(true)
    // lo que ya estaba leído se sigue usando; lo que no se guardó, no aparece
    expect(s.get('ai.key.openai')).toBe('sk-1')
    expect(s.get('platform.cookies.acc1')).toBeNull()
    expect(s.status()).toMatchObject({ locked: true, reason: 'unavailable' })
    // vuelve (Windows, Linux): se escribe cifrado otra vez
    c.available = true
    expect(s.status()).toEqual({ locked: false })
    s.set('platform.cookies.acc1', 'nuevo')
    expect(readFileSync(file).subarray(0, MAGIC_ENC.length).toString()).toBe(MAGIC_ENC)
    expect(new FileSecretStore(() => file, c).keys().sort()).toEqual(['ai.key.anthropic', 'ai.key.openai', 'platform.cookies.acc1'])
  })

  it('macOS tras «Denegar»: «Empezar de cero» aparta el archivo pero no escribe nada hasta reabrir Aula', () => {
    const c = systemCipher()
    const before = seed(c, ORIGINAL)
    c.available = false // el aviso del llavero denegado: ni descifra ni cifra en toda la ejecución
    const changes: SecretsStatus[] = []
    const s = new FileSecretStore(() => file, c, { restartToRetry: true, now: () => Date.parse('2026-11-16T10:00:00Z'), onChange: (st) => changes.push(st) })
    expect(s.status()).toMatchObject({ locked: true, reason: 'decrypt', needsRestart: true })
    // la interfaz no ofrece «Empezar de cero»: apartaría un archivo que se lee bien al reabrir Aula
    expect(s.status().canReset).toBeUndefined()
    try {
      s.set('x', 'y')
      expect.unreachable()
    } catch (e) {
      expect((e as AulaError).message).toMatch(/Reabre Aula|Reopen Aula/)
    }
    // aun así, si se llama, aparta sin perder nada y sigue sin escribir
    const r = s.reset()
    expect(r.movedTo).toBe(join(dir, 'secrets.unreadable-2026-11-16T10-00-00.enc'))
    expect(readFileSync(r.movedTo!).equals(before)).toBe(true)
    expect(r.status).toMatchObject({ locked: true, reason: 'unavailable', needsRestart: true })
    // las claves que se vuelven a pegar y la copia de las cookies NO se guardan en claro (antes: AULA-PLN1 y su .bak)
    expect(() => s.set('ai.key.openai', 'sk-nueva')).toThrowError(/llavero|keychain/)
    expect(() => s.set('platform.cookies.acc1', '{"v":1,"cookies":[]}')).toThrowError(/llavero|keychain/)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(backupPath(file))).toBe(false)
    expect(noPlaintextIn(dir)).toBe(true)
    expect(s.keys()).toEqual([])
    expect(changes.map((x) => x.reason)).toEqual(['decrypt', 'unavailable'])
    // reabrir Aula con «Permitir siempre»: se empieza vacío y se guarda cifrado
    c.available = true
    const next = new FileSecretStore(() => file, c, { restartToRetry: true })
    expect(next.status()).toEqual({ locked: false })
    next.set('ai.key.openai', 'sk-nueva')
    expect(readFileSync(file).subarray(0, MAGIC_ENC.length).toString()).toBe(MAGIC_ENC)
    // y la copia apartada se puede recuperar con la misma clave
    expect(new FileSecretStore(() => r.movedTo!, c).get('ai.key.anthropic')).toBe('sk-2')
  })

  it('macOS tras «Denegar»: no reintenta solo (no serviría) y pide reabrir; «Reintentar» relee igual', () => {
    const c = systemCipher()
    seed(c, ORIGINAL)
    c.available = false
    let now = 1_000_000
    const s = new FileSecretStore(() => file, c, { restartToRetry: true, now: () => now })
    expect(s.locked()).toBe(true)
    const tries = c.decrypts
    now += 24 * 3600_000
    expect(s.locked()).toBe(true)
    expect(c.decrypts).toBe(tries)
    expect(s.status()).toMatchObject({ locked: true, reason: 'decrypt', needsRestart: true })
    expect(s.retry()).toMatchObject({ locked: true, reason: 'decrypt', needsRestart: true })
    expect(c.decrypts).toBe(tries + 1)
  })

  it('macOS con la clave cambiada (el llavero deja cifrar pero no descifra el archivo): no pide reabrir, reintenta aquí', () => {
    const c = systemCipher()
    const before = seed(c, ORIGINAL)
    c.readable = false // p. ej. se borró y se recreó «Aula Safe Storage»: reabrir Aula no lo arregla
    const changes: SecretsStatus[] = []
    const s = new FileSecretStore(() => file, c, { restartToRetry: true, onChange: (st) => changes.push(st) })
    expect(s.status()).toMatchObject({ locked: true, reason: 'decrypt', canReset: true })
    expect(s.status().needsRestart).toBeUndefined()
    try {
      s.set('x', 'y')
      expect.unreachable()
    } catch (e) {
      expect((e as AulaError).message).toMatch(/Reinténtalo|Try again/)
      expect((e as AulaError).message).not.toMatch(/Reabre Aula|Reopen Aula/)
    }
    expect(readFileSync(file).equals(before)).toBe(true)
    // «Reintentar» relee en el momento (sin reabrir): si el archivo vuelve a leerse, todo vuelve
    expect(s.retry()).toMatchObject({ locked: true, reason: 'decrypt' })
    c.readable = true
    expect(s.retry()).toEqual({ locked: false })
    expect(s.get('ai.key.anthropic')).toBe('sk-2')
    expect(changes.every((x) => !x.needsRestart)).toBe(true)
  })

  it('macOS: un fallo de lectura (io) se sigue reintentando solo cada 5 minutos', () => {
    let now = 1_000_000
    const c = systemCipher()
    mkdirSync(file) // leer una carpeta falla (EISDIR): como un disco que no responde un momento
    const s = new FileSecretStore(() => file, c, { restartToRetry: true, now: () => now })
    expect(s.status()).toMatchObject({ locked: true, reason: 'io', canReset: true })
    expect(s.status().needsRestart).toBeUndefined()
    rmSync(file, { recursive: true })
    seed(c, ORIGINAL)
    now += 4 * 60_000
    expect(s.locked()).toBe(true)
    now += 60_001
    expect(s.locked()).toBe(false)
    expect(s.get('ai.key.openai')).toBe('sk-1')
  })

  it('un archivo dañado no pide reabrir (eso no lo arregla)', () => {
    writeFileSync(file, 'basura')
    const s = new FileSecretStore(() => file, systemCipher(), { restartToRetry: true })
    expect(s.status()).toEqual(expect.objectContaining({ locked: true, reason: 'corrupt' }))
    expect(s.status().needsRestart).toBeUndefined()
  })

  it('nunca escribe un archivo vacío: un cifrado sin contenido se rechaza y el archivo queda intacto', () => {
    const c = systemCipher()
    const s = new FileSecretStore(() => file, c)
    s.set('a', '1')
    const before = readFileSync(file)
    c.emptyCipher = true
    expect(() => s.set('b', '2')).toThrowError(/llavero|keychain/)
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(s.get('b')).toBeNull()
    expect(s.status()).toMatchObject({ locked: true, reason: 'unavailable' })
  })

  it('Linux sin llavero (basic): se sigue guardando en claro con permisos 0600, como antes', () => {
    const c = systemCipher({ basic: true })
    const s = new FileSecretStore(() => file, c)
    s.set('ai.key.openai', 'sk-1')
    expect(readFileSync(file, 'utf8')).toBe(`${MAGIC_PLAIN}{"ai.key.openai":"sk-1"}`)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(s.status()).toEqual({ locked: false })
    expect(c.encrypts).toBe(0)
  })

  it('nombre de la copia apartada', () => {
    expect(unreadableCopyPath('/d/secrets.enc', new Date('2026-01-02T03:04:05.678Z'))).toBe(join('/d', 'secrets.unreadable-2026-01-02T03-04-05.enc'))
  })
})

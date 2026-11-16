// M4 (0.2.6): en macOS el sistema lee el llavero una vez por ejecución, así que «Reintentar» reabre Aula (lo único que vuelve
// a mostrar el aviso). En Linux y Windows reintenta en el momento, como antes. Y la pausa de las sesiones de las
// plataformas llega a la interfaz por el mismo aviso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const handlers = new Map<string, (args: unknown) => unknown>()
const emitted: Array<{ event: string; payload: unknown }> = []
const relaunch = vi.fn()
const quit = vi.fn()

vi.mock('electron', () => ({
  app: { relaunch: () => relaunch(), quit: () => quit() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (t: string) => Buffer.from(t), decryptString: (b: Buffer) => b.toString() }
}))
vi.mock('../rpc', () => ({
  handle: (m: string, fn: (args: unknown) => unknown) => handlers.set(m, fn),
  emit: (event: string, payload: unknown) => emitted.push({ event, payload })
}))

const { register } = await import('./secrets')
const { setSecretStore, MemorySecretStore } = await import('@main/services/secrets')
const { FileSecretStore, MAGIC_ENC } = await import('@main/services/secrets-file')
const { setSessionGate } = await import('@main/services/platforms/session-gate')
register()

const realPlatform = process.platform
function asPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

let dir: string
let readable = false
beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'aula-secrets-handler-'))
  readable = false
  emitted.length = 0
  relaunch.mockReset()
  quit.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  asPlatform(realPlatform)
  setSessionGate('open')
  setSecretStore(new MemorySecretStore())
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Un secrets.enc que el «llavero» no deja descifrar: tras «Denegar» en macOS tampoco deja cifrar; con `canEncrypt` (la clave
 * cambió, o Linux y Windows) sí deja.
 */
function deniedStore(restartToRetry: boolean, canEncrypt = !restartToRetry): void {
  const file = join(dir, 'secrets.enc')
  writeFileSync(file, Buffer.concat([Buffer.from(MAGIC_ENC), Buffer.from('{"a":"1"}')]))
  setSecretStore(new FileSecretStore(() => file, {
    protection: () => (readable || canEncrypt ? 'os' : 'unavailable'),
    encrypt: (t) => Buffer.from(t),
    decrypt: (b) => {
      if (!readable) throw new Error('Decryption is not available.')
      return b.toString()
    }
  }, { restartToRetry }))
}

const call = (m: string) => handlers.get(m)!(undefined) as Record<string, unknown>

describe('secrets.retry', () => {
  it('macOS con el llavero denegado: reabre Aula (app.relaunch + app.quit) en vez de reintentar sin preguntar', () => {
    asPlatform('darwin')
    deniedStore(true)
    expect(call('secrets.status')).toMatchObject({ locked: true, reason: 'decrypt', needsRestart: true })
    expect(call('secrets.retry')).toMatchObject({ locked: true, needsRestart: true })
    // pulsado dos veces: una sola Aula nueva
    call('secrets.retry')
    expect(relaunch).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('Linux y Windows: reintenta en el momento y nunca reabre la app', () => {
    for (const p of ['linux', 'win32'] as const) {
      asPlatform(p)
      readable = false
      deniedStore(false)
      expect(call('secrets.retry')).toMatchObject({ locked: true, reason: 'decrypt' })
      readable = true
      expect(call('secrets.retry')).toEqual({ locked: false })
      vi.runAllTimers()
    }
    expect(relaunch).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
    expect(emitted.filter((e) => e.event === 'secrets.changed').length).toBeGreaterThan(0)
  })

  it('macOS con la clave cambiada (el llavero deja cifrar): reintenta en el momento, nunca reabre (no serviría)', () => {
    asPlatform('darwin')
    deniedStore(true, true)
    const st = call('secrets.status')
    expect(st).toMatchObject({ locked: true, reason: 'decrypt', canReset: true })
    expect(st.needsRestart).toBeUndefined()
    expect(call('secrets.retry')).toMatchObject({ locked: true, reason: 'decrypt' })
    readable = true
    expect(call('secrets.retry')).toEqual({ locked: false })
    vi.runAllTimers()
    expect(relaunch).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
    expect(emitted.at(-1)).toEqual({ event: 'secrets.changed', payload: { locked: false } })
  })

  it('macOS con un almacén que se lee bien: «Reintentar» no reabre nada', () => {
    asPlatform('darwin')
    readable = true
    deniedStore(true)
    expect(call('secrets.retry')).toEqual({ locked: false })
    vi.runAllTimers()
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('las sesiones de las plataformas en pausa se avisan y «Reintentar» pide reabrir Aula en macOS', () => {
    asPlatform('darwin')
    readable = true
    deniedStore(true)
    setSessionGate('paused')
    expect(emitted.at(-1)).toEqual({ event: 'secrets.changed', payload: { locked: false, platformsPaused: true, needsRestart: true } })
    expect(call('secrets.status')).toEqual({ locked: false, platformsPaused: true, needsRestart: true })
    emitted.length = 0
    // reabre (no reintenta en el momento ni avisa de un cambio que no hubo)
    expect(call('secrets.retry')).toEqual({ locked: false, platformsPaused: true, needsRestart: true })
    expect(emitted).toEqual([])
  })
})

describe('secrets.reset', () => {
  it('macOS tras «Denegar»: no se ofrece; si se pide, aparta el archivo y sigue pidiendo reabrir (nada en claro)', () => {
    asPlatform('darwin')
    deniedStore(true)
    expect(call('secrets.status').canReset).toBeUndefined()
    const out = call('secrets.reset')
    expect(out).toMatchObject({ locked: true, reason: 'unavailable', needsRestart: true })
    expect(String(out.movedTo)).toMatch(/^secrets\.unreadable-.*\.enc$/)
    vi.runAllTimers()
    expect(relaunch).not.toHaveBeenCalled()
  })
})

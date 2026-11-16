// M4 (0.2.6): sin cifrado del sistema, solo Linux guarda en claro ('basic'). En macOS y Windows es 'unavailable' (no se
// escribe nada). Y la comprobación del llavero de las cookies (macOS) y el estado que ve la interfaz.
import { afterEach, describe, expect, it, vi } from 'vitest'

const safe = {
  available: true,
  backend: 'gnome_libsecret' as string,
  probe: async (): Promise<Buffer> => Buffer.from('v10xyz')
}

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => safe.available,
    getSelectedStorageBackend: () => safe.backend,
    encryptString: (t: string) => Buffer.from(t),
    decryptString: (b: Buffer) => b.toString(),
    encryptStringAsync: () => safe.probe()
  }
}))

const { cookieEncryptionAvailable, keychainNeedsRelaunch, secretProtection, secretsStateOf } = await import('./secrets')
const { setSessionGate } = await import('@main/services/platforms/session-gate')

afterEach(() => {
  safe.available = true
  safe.backend = 'gnome_libsecret'
  safe.probe = async () => Buffer.from('v10xyz')
  setSessionGate('open')
})

describe('secretProtection', () => {
  it('con cifrado del sistema: os en los tres', () => {
    for (const p of ['darwin', 'win32', 'linux'] as const) expect(secretProtection(p)).toBe('os')
  })

  it('sin cifrado: en claro solo en Linux; macOS y Windows no escriben nada', () => {
    safe.available = false
    expect(secretProtection('linux')).toBe('basic')
    expect(secretProtection('darwin')).toBe('unavailable')
    expect(secretProtection('win32')).toBe('unavailable')
  })

  it('Linux con la clave fija de Chromium (basic_text) sigue siendo basic, como antes', () => {
    safe.backend = 'basic_text'
    expect(secretProtection('linux')).toBe('basic')
    safe.backend = 'unknown'
    expect(secretProtection('linux')).toBe('basic')
  })

  it('solo macOS necesita reabrir Aula para volver a preguntar al llavero', () => {
    expect(keychainNeedsRelaunch('darwin')).toBe(true)
    expect(keychainNeedsRelaunch('win32')).toBe(false)
    expect(keychainNeedsRelaunch('linux')).toBe(false)
  })
})

describe('cookieEncryptionAvailable (macOS)', () => {
  it('deja cifrar con la clave de las cookies: true', async () => {
    await expect(cookieEncryptionAvailable()).resolves.toBe(true)
  })

  it('aviso denegado (la clave falta): false', async () => {
    safe.probe = async () => { throw new Error('Error while encrypting the text provided to safeStorage.encryptStringAsync.') }
    await expect(cookieEncryptionAvailable()).resolves.toBe(false)
  })

  it('un cifrado vacío no cuenta', async () => {
    safe.probe = async () => Buffer.alloc(0)
    await expect(cookieEncryptionAvailable()).resolves.toBe(false)
  })
})

describe('secretsStateOf', () => {
  it('sin pausa, el estado del almacén tal cual', () => {
    expect(secretsStateOf({ locked: false })).toEqual({ locked: false })
    expect(secretsStateOf({ locked: true, reason: 'decrypt', needsRestart: true })).toEqual({ locked: true, reason: 'decrypt', needsRestart: true })
  })

  it('con las sesiones de las plataformas en pausa: se avisa y pide reabrir Aula', () => {
    setSessionGate('paused')
    expect(secretsStateOf({ locked: false })).toEqual({ locked: false, platformsPaused: true, needsRestart: true })
    setSessionGate('checking')
    expect(secretsStateOf({ locked: false })).toEqual({ locked: false })
  })
})

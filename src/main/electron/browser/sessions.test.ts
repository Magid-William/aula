// S1 (0.2.6): mientras las sesiones de las plataformas esperan al llavero o están en pausa (macOS, aviso denegado), NINGUNA
// partición guardada `persist:platform-*` se abre: Chromium borraría al cargarlas las cookies que no descifra. Aquí se
// prueban las guardas de verdad (partitionFor, platformSession y snapshotCookies), con Electron simulado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformAccount } from '@shared/settings/platforms'

const electron = vi.hoisted(() => {
  const cookie = {
    name: 'MoodleSession', value: 'v', domain: 'campus.example.edu', hostOnly: true, path: '/', secure: true, httpOnly: true,
    session: true, sameSite: 'lax'
  }
  /** Una sesión de Chromium de mentira: lo justo para configurarla y leer sus cookies. */
  const fakeSession = () => ({
    cookies: { get: async () => [cookie], set: async () => undefined, flushStore: async () => undefined },
    webRequest: { onBeforeRequest: () => undefined, onCompleted: () => undefined, onErrorOccurred: () => undefined },
    getUserAgent: () => 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0.0.0 Electron/44.0.0 Safari/537.36',
    setUserAgent: () => undefined,
    setSpellCheckerEnabled: () => undefined,
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setDevicePermissionHandler: () => undefined,
    setDisplayMediaRequestHandler: () => undefined,
    on: () => undefined,
    resolveHost: async () => ({ endpoints: [] })
  })
  return { fromPartition: vi.fn((_partition: string, _opts?: unknown) => fakeSession()) }
})

vi.mock('electron', () => ({
  app: { getName: () => 'Aula', getLocale: () => 'es' },
  powerMonitor: { on: () => undefined },
  session: { fromPartition: electron.fromPartition }
}))

const { partitionFor, platformSession } = await import('./sessions')
const { snapshotCookies } = await import('./cookies')
const { setSessionGate } = await import('@main/services/platforms/session-gate')
const { MemorySecretStore, setSecretStore } = await import('@main/services/secrets')
const { AulaError } = await import('@main/services/errors')

const account: PlatformAccount = { id: 'acc1', kind: 'moodle', label: 'Moodle', baseURL: 'https://campus.example.edu' }

let store: InstanceType<typeof MemorySecretStore>
let setSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  electron.fromPartition.mockClear()
  store = new MemorySecretStore()
  setSpy = vi.spyOn(store, 'set')
  setSecretStore(store)
})
afterEach(() => {
  setSessionGate('open')
  setSecretStore(new MemorySecretStore())
})

/** El código del error que lanza `fn`, o null si no lanza. */
function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (e) {
    return e instanceof AulaError ? e.code : 'other'
  }
}

const CLOSED = [
  ['paused', 'platforms_keychain_restart'],
  ['checking', 'platforms_keychain_wait']
] as const

describe('guardas de las sesiones guardadas (S1)', () => {
  for (const [gate, code] of CLOSED) {
    describe(`con las sesiones «${gate}»`, () => {
      beforeEach(() => setSessionGate(gate))

      it('partitionFor y platformSession de una cuenta lanzan antes de abrir ninguna partición', () => {
        expect(codeOf(() => partitionFor('acc1'))).toBe(code)
        expect(codeOf(() => platformSession('acc1'))).toBe(code)
        expect(electron.fromPartition).not.toHaveBeenCalled()
      })

      it('la navegación sin cuenta (en memoria, sin cookies de ninguna plataforma) sigue funcionando', () => {
        expect(partitionFor(null)).toBe('platform-web')
        platformSession(null)
        expect(electron.fromPartition).toHaveBeenCalledTimes(1)
        expect(electron.fromPartition.mock.calls[0]?.[0]).toBe('platform-web')
      })

      it('la copia de las cookies no abre la partición ni toca secrets.enc', async () => {
        await expect(snapshotCookies(account)).resolves.toBe(false)
        expect(electron.fromPartition).not.toHaveBeenCalled()
        expect(setSpy).not.toHaveBeenCalled()
      })
    })
  }

  it('abiertas: la misma copia sí abre la partición de la cuenta y guarda (las espías funcionan)', async () => {
    expect(partitionFor('acc1')).toBe('persist:platform-acc1')
    await expect(snapshotCookies(account)).resolves.toBe(true)
    expect(electron.fromPartition).toHaveBeenCalledWith('persist:platform-acc1', { cache: true })
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy.mock.calls[0]?.[0]).toBe('platform.cookies.acc1')
  })
})

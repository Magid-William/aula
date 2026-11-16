// S1 (0.2.6): en macOS, si el llavero no deja descifrar las cookies (aviso denegado), Chromium borraría las sesiones de las
// plataformas al cargarlas. Antes de arrancar se pregunta al llavero y, si no deja, no se toca ninguna partición en toda la
// ejecución. En Linux y Windows todo sigue como antes.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AulaError } from '../errors'
import { assertSessionsOpen, onSessionGateChange, sessionGate, setSessionGate, startPlatformSessions, type SessionGate } from './session-gate'

afterEach(() => setSessionGate('open'))

function deps(over: Partial<Parameters<typeof startPlatformSessions>[0]> = {}) {
  const start = vi.fn(async () => undefined)
  const probe = vi.fn(async () => true)
  return { d: { platform: 'darwin' as NodeJS.Platform, hasAccounts: () => true, probe, start, ...over }, start, probe }
}

function codeOf(fn: () => void): string | null {
  try {
    fn()
    return null
  } catch (e) {
    return e instanceof AulaError ? e.code : 'other'
  }
}

describe('startPlatformSessions', () => {
  it('Linux y Windows: arranca como siempre, sin preguntar al llavero', async () => {
    for (const platform of ['linux', 'win32'] as const) {
      const { d, start, probe } = deps({ platform, probe: vi.fn(async () => false) })
      await expect(startPlatformSessions(d)).resolves.toBe('started')
      expect(probe).not.toHaveBeenCalled()
      expect(start).toHaveBeenCalledTimes(1)
      expect(sessionGate()).toBe('open')
    }
  })

  it('macOS sin cuentas: no hay sesiones que proteger (ni aviso del llavero de más)', async () => {
    const { d, start, probe } = deps({ hasAccounts: () => false })
    await expect(startPlatformSessions(d)).resolves.toBe('started')
    expect(probe).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('macOS con el llavero permitido: mientras se contesta el aviso nada toca las sesiones; luego arranca', async () => {
    let answer: (ok: boolean) => void = () => undefined
    const { d, start } = deps({ probe: () => new Promise<boolean>((r) => { answer = r }) })
    const run = startPlatformSessions(d)
    expect(sessionGate()).toBe('checking')
    expect(codeOf(assertSessionsOpen)).toBe('platforms_keychain_wait')
    expect(start).not.toHaveBeenCalled()
    answer(true)
    await expect(run).resolves.toBe('started')
    expect(sessionGate()).toBe('open')
    expect(codeOf(assertSessionsOpen)).toBeNull()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('macOS con el llavero denegado: no arranca, las sesiones quedan en pausa y se avisa', async () => {
    const seen: SessionGate[] = []
    const off = onSessionGateChange((g) => seen.push(g))
    const { d, start } = deps({ probe: vi.fn(async () => false) })
    await expect(startPlatformSessions(d)).resolves.toBe('paused')
    off()
    expect(start).not.toHaveBeenCalled()
    expect(sessionGate()).toBe('paused')
    expect(seen).toEqual(['checking', 'paused'])
    expect(codeOf(assertSessionsOpen)).toBe('platforms_keychain_restart')
  })

  it('macOS: si la comprobación falla del todo, también en pausa (nunca se arriesgan las cookies)', async () => {
    const { d, start } = deps({ probe: vi.fn(async () => { throw new Error('safeStorage cannot be used before app is ready') }) })
    await expect(startPlatformSessions(d)).resolves.toBe('paused')
    expect(start).not.toHaveBeenCalled()
  })

  it('el error de la pausa pide reabrir Aula (a la interfaz y a la IA)', () => {
    setSessionGate('paused')
    try {
      assertSessionsOpen()
      expect.unreachable()
    } catch (e) {
      const err = e as AulaError
      expect(err.message).toMatch(/Reabre Aula|Reopen Aula/)
      expect((err.details as { aiReason: string }).aiReason).toMatch(/reopen/i)
    }
  })
})

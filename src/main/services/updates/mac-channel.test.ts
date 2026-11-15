// Ejecuta getUpdater de la app con el setter y la comparación de versiones reales de electron-updater.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { AppUpdater } = require('electron-updater/out/AppUpdater') as { AppUpdater: new (...args: unknown[]) => {
  channel: string | null
  allowDowngrade: boolean
  allowPrerelease: boolean
  checkForUpdates: () => Promise<unknown>
  isUpdateAvailable: (info: { version: string }) => Promise<boolean>
} }
const descriptors = Object.fromEntries(['platform', 'execPath', 'resourcesPath'].map((key) => [key, Object.getOwnPropertyDescriptor(process, key)]))
let home: string | undefined

afterEach(() => {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(process, key, descriptor)
    else Reflect.deleteProperty(process, key)
  }
  vi.unstubAllEnvs()
  if (home) rmSync(home, { recursive: true, force: true })
})

describe('canal de actualizaciones desde 0.2.5', () => {
  it.each(['darwin', 'win32', 'linux'])('%s: el canal Mac no habilita downgrades ni cambia otros sistemas', async (platform) => {
    vi.resetModules()
    home = mkdtempSync(join(tmpdir(), 'aula-channel-'))
    const resources = join(home, 'Aula.app', 'Contents', 'Resources')
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, 'app-update.yml'), 'provider: github\nowner: luumlabs\nrepo: aula\n')
    const executable = join(home, 'Aula.app', 'Contents', 'MacOS', 'Aula')
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    // La ruta del Mac simulado usa sus separadores, aunque la prueba corra en Windows; el I/O conserva rutas nativas.
    Object.defineProperty(process, 'execPath', { value: platform === 'darwin' ? executable.replace(/\\/g, '/') : executable, configurable: true })
    Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true })
    vi.stubEnv('APPIMAGE', join(home, 'Aula.AppImage'))
    vi.stubEnv('AULA_NO_UPDATES', '')
    const u = new AppUpdater(null, { version: '0.2.5', name: 'Aula', isPackaged: true })
    u.checkForUpdates = vi.fn(async () => null)
    vi.doMock('electron', () => ({ app: { isPackaged: true }, powerMonitor: {}, shell: {} }))
    vi.doMock('electron-updater', () => ({ default: { autoUpdater: u } }))
    vi.doMock('@main/electron/rpc', () => ({ emit: () => undefined }))
    vi.doMock('@main/electron/window', () => ({ getMainWindow: () => null }))
    vi.doMock('@main/services/paths', () => ({ dataRoot: () => home }))
    vi.doMock('@main/services/log', () => ({ log: { info() {}, warn() {}, error() {} } }))
    const { checkForUpdates } = await import('@main/electron/updates')
    await checkForUpdates()
    expect(u.checkForUpdates).toHaveBeenCalledOnce()
    expect(u.channel).toBe(platform === 'darwin' ? 'developer-id' : null)
    expect(u.allowPrerelease).toBe(false)
    expect(u.allowDowngrade).toBe(false)
    await expect(u.isUpdateAvailable({ version: '0.2.4' })).resolves.toBe(false)
    await expect(u.isUpdateAvailable({ version: '0.2.5' })).resolves.toBe(false)
    await expect(u.isUpdateAvailable({ version: '0.2.6' })).resolves.toBe(true)
  })
})

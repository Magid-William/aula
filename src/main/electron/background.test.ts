import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ app: { isPackaged: true, setLoginItemSettings: vi.fn() }, warn: vi.fn() }))
vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('@main/services/log', () => ({ log: { warn: mocks.warn } }))
// El helper real se importa sin arrancar servicios, automatizaciones, ventanas ni proveedores.
vi.mock('@main/services/automations', () => ({}))
vi.mock('@main/services/automations/demo', () => ({}))
vi.mock('@main/services/assistant', () => ({}))
vi.mock('@main/services/settings', () => ({}))
vi.mock('@main/services/calendar', () => ({}))
vi.mock('@main/services/store', () => ({}))
vi.mock('@main/services/documents/saving', () => ({}))
vi.mock('./handlers/generation', () => ({}))
vi.mock('./browser', () => ({}))
vi.mock('./rpc', () => ({}))
vi.mock('./window', () => ({}))
vi.mock('./visibility', () => ({}))
vi.mock('./notifications', () => ({}))
vi.mock('./tray', () => ({}))

import { applyLoginItem } from './background'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  vi.clearAllMocks()
  mocks.app.isPackaged = true
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
})
afterEach(() => {
  vi.unstubAllEnvs()
  Object.defineProperty(process, 'platform', platform)
})

describe('elementos de inicio de sesión en un ensayo', () => {
  it('AULA_NO_LOGIN_ITEM=1 omite tanto registrar como retirar el elemento', () => {
    vi.stubEnv('AULA_NO_LOGIN_ITEM', '1')
    applyLoginItem(true)
    applyLoginItem(false)
    expect(mocks.app.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '0', 'true'])('sin el valor exacto 1 (%s), conserva las llamadas normales', (flag) => {
    vi.stubEnv('AULA_NO_LOGIN_ITEM', flag)
    applyLoginItem(true)
    applyLoginItem(false)
    expect(mocks.app.setLoginItemSettings.mock.calls).toEqual([
      [{ openAtLogin: true, args: ['--hidden'] }],
      [{ openAtLogin: false, args: ['--hidden'] }]
    ])
  })

  it('tampoco cambia la exclusión de desarrollo y Linux', () => {
    vi.stubEnv('AULA_NO_LOGIN_ITEM', undefined)
    mocks.app.isPackaged = false
    applyLoginItem(true)
    mocks.app.isPackaged = true
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    applyLoginItem(false)
    expect(mocks.app.setLoginItemSettings).not.toHaveBeenCalled()
  })
})

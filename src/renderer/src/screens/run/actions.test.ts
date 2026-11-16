// Las acciones del monitor con la creación parada: un rechazo del proceso principal se ve en un aviso (R4).
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/i18n'
import { useToasts } from '@renderer/design/Toast'
import { runStoppedAction } from './actions'

/** El puente del preload con una respuesta fija (el sobre del IPC, como lo devuelve el proceso principal). */
function bridge(envelope: unknown) {
  const invoke = vi.fn(async () => envelope)
  vi.stubGlobal('window', { aula: { invoke, on: () => () => {} } })
  return invoke
}

afterEach(() => {
  for (const t of useToasts.getState().items) useToasts.getState().dismiss(t.id)
  vi.unstubAllGlobals()
})

describe('acciones del monitor con la creación parada', () => {
  it('Reanudar sin clave del proveedor avisa con el mensaje del proceso principal en vez de tragárselo', async () => {
    const message = 'Falta la clave de API de DeepSeek. Añádela en Ajustes → IA.'
    const invoke = bridge({ ok: false, error: { message, code: 'ai_missing_key' } })
    // no rechaza: antes era una promesa rechazada sin nadie que la recogiera
    await expect(runStoppedAction('resume', 'run-1')).resolves.toBe(false)
    expect(invoke).toHaveBeenCalledWith('generation.resume', { id: 'run-1' })
    const items = useToasts.getState().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'error', title: i18n.t('run:resumeFailed'), body: message })
  })

  it('otra creación en marcha (generation_busy) también se avisa', async () => {
    bridge({ ok: false, error: { message: 'Ya hay una creación en marcha en este curso', code: 'generation_busy' } })
    await expect(runStoppedAction('resume', 'run-1')).resolves.toBe(false)
    expect(useToasts.getState().items.map((t) => t.body)).toEqual(['Ya hay una creación en marcha en este curso'])
  })

  it('Quedarme con lo que hay avisa con su propio título', async () => {
    const invoke = bridge({ ok: false, error: { message: 'No se encontró la ejecución', code: 'not_found' } })
    await expect(runStoppedAction('keep', 'run-2')).resolves.toBe(false)
    expect(invoke).toHaveBeenCalledWith('generation.keep', { id: 'run-2' })
    expect(useToasts.getState().items[0]).toMatchObject({ kind: 'error', title: i18n.t('run:keepFailed') })
  })

  it('si sale bien, no hay aviso', async () => {
    bridge({ ok: true, value: undefined })
    await expect(runStoppedAction('resume', 'run-1')).resolves.toBe(true)
    expect(useToasts.getState().items).toHaveLength(0)
  })

  it('el título del aviso está traducido en español e inglés', () => {
    expect(i18n.t('run:resumeFailed', { lng: 'es' })).toBe('No se pudo reanudar la creación')
    expect(i18n.t('run:resumeFailed', { lng: 'en' })).toBe('Couldn’t resume the creation')
  })
})

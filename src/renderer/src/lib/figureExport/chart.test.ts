import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChartRenderSceneV1 } from '@shared/figuresChart'
import { captureChartPng } from './chart'
import { api } from '@renderer/lib/api'
vi.mock('@renderer/lib/api', () => ({ api: { invoke: vi.fn() } }))
afterEach(() => vi.mocked(api.invoke).mockReset())
const scene: ChartRenderSceneV1 = { version: 1, family: 'chart', chartKind: 'bar', branch: 'empty', canvas: { width: 300, height: 160 }, metrics: { rootFontPx: 16, bodyFont: 'sans', bodyItalic: false, cssZoom: 1 }, appearance: { theme: 'light', language: 'en', direction: 'ltr', palette: { paper: '#fffdf9', text: '#000000', text2: '#222222', text3: '#444444', link: '#cc3311', accent: '#cc3311', brick: '#cc3311' } }, layers: [], output: { scale: 2 } }
describe('ciclo de captura Chart', () => {
  it('entrega PNG del mismo scene y retira cancelación al terminar', async () => {
    const controller = new AbortController(), data = new Uint8Array([1, 2, 3])
    vi.mocked(api.invoke).mockResolvedValue({ data, width: 600, height: 320 })
    expect(await captureChartPng(scene, controller.signal)).toBe(data)
    controller.abort()
    expect(api.invoke).toHaveBeenCalledTimes(1)
    expect(api.invoke).toHaveBeenCalledWith('figures.renderChartPng', { scene, jobId: expect.any(String) })
  })
  it('cancela el job al navegar sin esperar una respuesta tardía', async () => {
    const controller = new AbortController()
    vi.mocked(api.invoke).mockImplementation(method => method === 'figures.renderChartPng' ? new Promise(() => undefined) : Promise.resolve(undefined))
    const pending = captureChartPng(scene, controller.signal)
    const jobId = (vi.mocked(api.invoke).mock.calls[0][1] as { jobId: string }).jobId
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.invoke).toHaveBeenCalledWith('figures.cancelRender', { jobId })
    expect(api.invoke).toHaveBeenCalledTimes(2)
  })
  it('no inicia un job para señal ya cancelada y permite reintento tras fallo', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(captureChartPng(scene, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.invoke).not.toHaveBeenCalled()
    vi.mocked(api.invoke).mockRejectedValueOnce(new Error('render failed')).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ data: new Uint8Array([4]), width: 600, height: 320 })
    await expect(captureChartPng(scene, new AbortController().signal)).rejects.toThrow('render failed')
    expect(await captureChartPng(scene, new AbortController().signal)).toEqual(new Uint8Array([4]))
    const calls = vi.mocked(api.invoke).mock.calls
    expect((calls[0][1] as { jobId: string }).jobId).not.toBe((calls[2][1] as { jobId: string }).jobId)
  })
})

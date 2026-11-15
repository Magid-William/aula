import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FigureSvg } from '@shared/figures'
import { serializeFigureSvg } from '@engine/figures/svg'
import { figurePng } from './png'

const figure: FigureSvg = { width: 120, height: 80, viewBox: [-5, -2, 120, 80], children: [{ tag: 'rect', attrs: { x: -5, y: -2, width: 120, height: 80, fill: '#fcfaf5' } }] }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function browser(mode: 'ok' | 'decode-error' | 'encode-error' | 'pending' = 'ok') {
  let source: Blob | undefined
  const revoked = vi.fn()
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { source = blob as Blob; return 'blob:figure-test' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoked)
  const remove = vi.fn()
  class ImageFixture {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) { if (mode !== 'pending') queueMicrotask(() => mode === 'decode-error' ? this.onerror?.() : this.onload?.()) }
    removeAttribute = remove
  }
  vi.stubGlobal('Image', ImageFixture)
  const draw = vi.fn()
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toBlob: (cb: (blob: Blob | null) => void) => cb(mode === 'encode-error' ? null : new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })) }
  vi.stubGlobal('document', { createElement: () => canvas })
  return { canvas, draw, revoked, remove, xml: async () => source?.text() }
}

describe('rasterización de la misma instantánea', () => {
  it('decodifica el SVG compartido, dibuja a sus dimensiones y libera todos los recursos', async () => {
    const env = browser()
    expect(await figurePng(figure, new AbortController().signal)).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(await env.xml()).toBe(serializeFigureSvg(figure))
    expect(env.draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 120, 80)
    expect(env.revoked).toHaveBeenCalledExactlyOnceWith('blob:figure-test')
    expect(env.remove).toHaveBeenCalledWith('src')
    expect(env.canvas.width).toBe(0)
    expect(env.canvas.height).toBe(0)
  })
  it.each(['decode-error', 'encode-error'] as const)('limpia al fallar %s', async (mode) => {
    const env = browser(mode)
    await expect(figurePng(figure, new AbortController().signal)).rejects.toThrow()
    expect(env.revoked).toHaveBeenCalledOnce()
    expect(env.canvas.width).toBe(0)
    expect(env.canvas.height).toBe(0)
  })
  it('cancela una carga pendiente y no mantiene vivo el BlobURL', async () => {
    const env = browser('pending')
    const controller = new AbortController()
    const promise = figurePng(figure, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(env.revoked).toHaveBeenCalledOnce()
    expect(env.remove).toHaveBeenCalledWith('src')
  })
  it('rechaza dimensiones excesivas antes de crear recursos', async () => {
    const env = browser()
    await expect(figurePng({ ...figure, width: 4097 }, new AbortController().signal)).rejects.toThrow()
    await expect(env.xml()).resolves.toBeUndefined()
    expect(env.revoked).not.toHaveBeenCalled()
  })
})

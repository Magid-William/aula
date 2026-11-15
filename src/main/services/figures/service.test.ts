import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setAILocale } from '@shared/ai/i18n'
import { FigureExports } from './service'
import { pngFixture } from './testing'

const svg = { width: 10, height: 20, viewBox: [0, 0, 10, 20], children: [{ tag: 'text', children: ['Molécula & carga'] }] }
const args = { format: 'svg', suggestedName: 'Molécula', svg }
let dir: string, service: FigureExports
const owner = {}, other = {}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aula-figure-test-')); service = new FigureExports(); setAILocale('es') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }); setAILocale('es') })

describe('guardado de figuras', () => {
  it('cancelar no escribe ni concede permiso; después permite guardar', async () => {
    const path = join(dir, 'elegida.svg')
    expect(await service.save(args, owner, async () => null)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
    expect(() => service.revealPath(owner, { path })).toThrow()
    expect(await service.save(args, owner, async () => path)).toEqual({ path })
    expect(readFileSync(path, 'utf8')).toContain('Molécula &amp; carga')
    expect(service.revealPath(owner, { path })).toBe(path)
    expect(() => service.revealPath(other, { path })).toThrow()
    service.forget(owner)
    expect(() => service.revealPath(owner, { path })).toThrow()
  })

  it('escribe únicamente donde el diálogo elige, incluso con un nombre que parece una ruta', async () => {
    const path = join(dir, 'seleccionado.svg'), choose = vi.fn(async () => path)
    writeFileSync(path, 'anterior')
    await service.save({ ...args, suggestedName: '../../otra/carpeta\\CON.png' }, owner, choose)
    expect(choose.mock.calls[0]).toEqual(['..-..-otra-carpeta-CON.svg', 'svg'])
    expect(readdirSync(dir)).toEqual(['seleccionado.svg'])
    expect(readFileSync(path, 'utf8')).toMatch(/^<svg/)
  })

  it('rechaza destino desde el renderer y payload activo antes del diálogo', async () => {
    const choose = vi.fn(async () => join(dir, 'no.svg'))
    for (const input of [
      { ...args, path: join(dir, 'arbitraria.svg') }, { ...args, data: pngFixture() },
      { ...args, svg: { ...svg, children: [{ tag: 'script' }] } }, { ...args, suggestedName: '' },
      { format: 'png', suggestedName: 'X', data: Buffer.alloc(100) }
    ]) await expect(service.save(input, owner, choose)).rejects.toMatchObject({ code: 'invalid_args' })
    expect(choose).not.toHaveBeenCalled()
    expect(readdirSync(dir)).toEqual([])
  })

  it('exige que la extensión elegida coincida con el contenido', async () => {
    for (const path of [join(dir, 'ejecutable.exe'), join(dir, 'sin-extension'), 'relativa.svg']) {
      await expect(service.save(args, owner, async () => path)).rejects.toMatchObject({ code: 'invalid_args' })
    }
    expect(readdirSync(dir)).toEqual([])
    const path = join(dir, 'imagen.PNG')
    await service.save({ format: 'png', suggestedName: 'CON', data: pngFixture() }, owner, async name => { expect(name).toBe('Aula-CON.png'); return path })
    expect(readFileSync(path)).toEqual(pngFixture())
  })

  it('bloquea operaciones simultáneas antes de validar y libera el turno al cancelar', async () => {
    let finish!: (value: null) => void
    const pending = service.save(args, owner, () => new Promise(resolve => { finish = resolve }))
    const choose = vi.fn(async () => null)
    await expect(service.save(null, other, choose)).rejects.toMatchObject({ code: 'busy' })
    expect(choose).not.toHaveBeenCalled()
    finish(null); await pending
    expect(await service.save(args, other, choose)).toBeNull()
  })

  it('no concede permiso cuando falla la escritura y traduce errores ES/EN', async () => {
    const path = join(dir, 'error.svg')
    const broken = new FigureExports(() => { throw new Error('internal details') })
    await expect(broken.save(args, owner, async () => path)).rejects.toThrow('No se pudo guardar la figura.')
    expect(() => broken.revealPath(owner, { path })).toThrow()
    setAILocale('en')
    await expect(broken.save(args, owner, async () => path)).rejects.toThrow('The figure could not be saved.')
    await expect(service.save(null, owner, async () => path)).rejects.toThrow('This figure cannot be exported.')
    expect(readdirSync(dir)).toEqual([])
  })
})

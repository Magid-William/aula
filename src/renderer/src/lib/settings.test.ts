import { describe, expect, it } from 'vitest'
import { mergePatch } from './settings'

describe('mergePatch', () => {
  it('mezcla los objetos anidados y deja lo demás', () => {
    const base = { version: 2, general: { theme: 'system', textScale: 1, language: 'en' }, list: [1, 2] }
    expect(mergePatch(base, { general: { theme: 'dark' } })).toEqual({ version: 2, general: { theme: 'dark', textScale: 1, language: 'en' }, list: [1, 2] })
  })
  it('reemplaza listas y valores sueltos, e ignora los undefined', () => {
    const base = { a: [1, 2], b: 1, c: { d: 1 } }
    expect(mergePatch(base, { a: [3], b: undefined, c: { d: undefined } })).toEqual({ a: [3], b: 1, c: { d: 1 } })
  })
  it('no toca el original', () => {
    const base = { general: { theme: 'light' } }
    mergePatch(base, { general: { theme: 'dark' } })
    expect(base.general.theme).toBe('light')
  })
})

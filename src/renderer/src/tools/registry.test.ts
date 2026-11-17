// La galería de herramientas: las fijadas, en su grupo y arriba.
import { describe, expect, it } from 'vitest'
import { pinnedGroups } from './registry'

describe('galería de herramientas', () => {
  const tools = [{ id: 'calculator' }, { id: 'grapher' }, { id: 'units' }, { id: 'timer' }]
  const ids = (g: { pinned: { id: string }[]; rest: { id: string }[] }) => ({ pinned: g.pinned.map((t) => t.id), rest: g.rest.map((t) => t.id) })
  it('las fijadas van aparte, en el orden en que se fijaron, y el resto como en el catálogo', () => {
    expect(ids(pinnedGroups(tools, ['timer', 'calculator']))).toEqual({ pinned: ['timer', 'calculator'], rest: ['grapher', 'units'] })
  })
  it('sin fijadas (o con ids que ya no existen) es el catálogo tal cual', () => {
    expect(ids(pinnedGroups(tools, []))).toEqual({ pinned: [], rest: ['calculator', 'grapher', 'units', 'timer'] })
    expect(ids(pinnedGroups(tools, ['gone']))).toEqual({ pinned: [], rest: ['calculator', 'grapher', 'units', 'timer'] })
  })
})

// El orden de la galería de herramientas: las fijadas arriba.
import { describe, expect, it } from 'vitest'
import { pinnedFirst } from './registry'

describe('galería de herramientas', () => {
  const tools = [{ id: 'calculator' }, { id: 'grapher' }, { id: 'units' }, { id: 'timer' }]
  it('pone arriba las fijadas, en el orden en que se fijaron, y deja el resto como en el catálogo', () => {
    expect(pinnedFirst(tools, ['timer', 'calculator']).map((t) => t.id)).toEqual(['timer', 'calculator', 'grapher', 'units'])
  })
  it('sin fijadas (o con ids que ya no existen) es el catálogo tal cual', () => {
    expect(pinnedFirst(tools, []).map((t) => t.id)).toEqual(['calculator', 'grapher', 'units', 'timer'])
    expect(pinnedFirst(tools, ['gone']).map((t) => t.id)).toEqual(['calculator', 'grapher', 'units', 'timer'])
  })
})

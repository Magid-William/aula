// El campo de fecha se lee en el idioma de la interfaz (no «mm/dd/yyyy»).
import { describe, expect, it } from 'vitest'
import { formatDateValue } from './Inputs'

describe('campo de fecha', () => {
  it('escribe la fecha en el idioma pedido, con el día de la semana', () => {
    const en = formatDateValue('2026-12-06', 'en-US')
    expect(en).toContain('Dec')
    expect(en).toContain('2026')
    expect(en).toMatch(/Sun/)
    const es = formatDateValue('2026-12-06', 'es')
    expect(es).toContain('dic')
    expect(es).toMatch(/dom/)
    expect(es).not.toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })
  it('vacío o mal formado: nada (sale la pista)', () => {
    expect(formatDateValue('', 'en')).toBe('')
    expect(formatDateValue('12/06/2026', 'en')).toBe('')
    expect(formatDateValue('2026-13-45', 'en')).toBe('')
  })
})

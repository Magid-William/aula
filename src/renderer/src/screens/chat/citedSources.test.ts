import { describe, expect, it } from 'vitest'
import { stripCitedSources } from './citedSources'

const notes = { title: 'Unit 3 lecture notes', page: 3 }

describe('la fuente, una sola vez (en la píldora, no en el texto)', () => {
  it('quita la línea de la cita que ya está en las píldoras', () => {
    const text = 'Here’s what they say:\n\n> cos 210° is negative.\n\n(Source: Unit 3 lecture notes, p. 3)\n\nYou can see it on the graph.'
    expect(stripCitedSources(text, [notes])).toBe('Here’s what they say:\n\n> cos 210° is negative.\n\nYou can see it on the graph.')
  })

  it('dentro de una frase se va con su espacio, en cualquier idioma', () => {
    expect(stripCitedSources('El coseno es negativo (Fuente: Apuntes del tema 3, p. 12).', [{ title: 'Apuntes del tema 3', page: 12 }])).toBe('El coseno es negativo.')
    expect(stripCitedSources('Siehe Kapitel 2 (Quelle: Skript, S. 4).', [{ title: 'Skript', page: 4 }])).toBe('Siehe Kapitel 2.')
  })

  it('varias citas: solo si todas están en las píldoras', () => {
    const both = 'Sí (Fuente: A uno, p. 3; B dos, p. 5).'
    expect(stripCitedSources(both, [{ title: 'A uno', page: 3 }, { title: 'B dos', page: 5 }])).toBe('Sí.')
    expect(stripCitedSources(both, [{ title: 'A uno', page: 3 }])).toBe(both)
  })

  it('no toca una cita sin píldora, otra página, el código ni las respuestas sin citas', () => {
    const other = 'Yes (Source: Unit 3 lecture notes, p. 4).'
    expect(stripCitedSources(other, [notes])).toBe(other)
    const code = 'Write `(Source: Unit 3 lecture notes, p. 3)` like this.'
    expect(stripCitedSources(code, [notes])).toBe(code)
    const fenced = '```text\n(Source: Unit 3 lecture notes, p. 3)\n```'
    expect(stripCitedSources(fenced, [notes])).toBe(fenced)
    expect(stripCitedSources('Yes (Source: Unit 3 lecture notes, p. 3).', [])).toBe('Yes (Source: Unit 3 lecture notes, p. 3).')
    expect(stripCitedSources('Yes (Source: Unit 3 lecture notes, p. 3).', undefined)).toBe('Yes (Source: Unit 3 lecture notes, p. 3).')
  })

  it('al final del texto no deja un salto colgando; sin página también vale', () => {
    expect(stripCitedSources('Done.\n\n(Source: Formula sheet)', [{ title: 'Formula sheet' }])).toBe('Done.')
  })
})

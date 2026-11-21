// Resaltado de código: alias, escapado y lenguaje adivinado (la misma lógica para el bloque y para el Markdown).
import { describe, expect, it } from 'vitest'
import { CODE_LANGUAGE_NAMES, codeLanguage, escapeHtml, highlightCode, languageLabel } from './code'

describe('lenguajes del código', () => {
  it('entiende el nombre y los alias que escriben los cursos', () => {
    expect(codeLanguage('py')).toBe('python')
    expect(codeLanguage('Python')).toBe('python')
    expect(codeLanguage('ts')).toBe('typescript')
    expect(codeLanguage('html')).toBe('xml')
    expect(codeLanguage('c++')).toBe('cpp')
    expect(codeLanguage('pseudocódigo')).toBe('plaintext')
    expect(codeLanguage('??')).toBeUndefined()
    expect(codeLanguage('')).toBeUndefined()
  })
  it('la lista que se le da al agente son nombres registrados', () => {
    for (const name of CODE_LANGUAGE_NAMES) expect(codeLanguage(name), name).toBe(name)
  })
})

describe('resaltado', () => {
  it('colorea las palabras clave', () => {
    const r = highlightCode('const x = 1', 'ts')
    expect(r.lang).toBe('typescript')
    expect(r.label).toBe('TypeScript')
    expect(r.html).toContain('hljs-keyword')
  })
  it('escapa el HTML del código (también sin lenguaje)', () => {
    const r = highlightCode('<script>alert(1)</script>', 'plaintext')
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&lt;script&gt;')
  })
  it('sin lenguaje adivina, y con uno inventado no rompe', () => {
    expect(highlightCode('print(1)', 'python').lang).toBe('python')
    expect(highlightCode('SELECT 1 FROM t', 'nope').html).toBeTruthy()
  })
  it('el texto en prosa no se inventa un lenguaje', () => {
    expect(highlightCode('hola que tal', undefined).html).toBe('hola que tal')
  })
  it('en vivo deja el texto sin colores pero escapado', () => {
    expect(highlightCode('a < b', 'python', true)).toEqual({ html: 'a &#60; b', label: 'Python' })
  })
  it('la etiqueta es la del lenguaje, o lo que escribió el curso', () => {
    expect(languageLabel('cpp')).toBe('C++')
    expect(languageLabel(undefined, 'Brainfuck')).toBe('Brainfuck')
    expect(escapeHtml('"x"')).toBe('&#34;x&#34;')
  })
})

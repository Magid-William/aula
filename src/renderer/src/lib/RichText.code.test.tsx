// Código escrito dentro de Markdown: el bloque ``` se pinta con la misma tarjeta que el bloque `code`; el `código` en línea no.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RichText } from './RichText'
import '@renderer/i18n'

describe('código en Markdown', () => {
  it('un bloque ``` se pinta como tarjeta de código, resaltado y con su lenguaje', () => {
    const html = renderToStaticMarkup(<RichText text={'```ts\nconst x: number = 1;\n```'} />)
    expect(html).toContain('blk-code')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('TypeScript')
  })

  it('sin lenguaje lo adivina', () => {
    const html = renderToStaticMarkup(<RichText text={'```\ndef add(a, b):\n    return a + b\n```'} />)
    expect(html).toContain('hljs-title')
    expect(html).toContain('Python')
  })

  it('el código en línea sigue siendo una píldora', () => {
    const html = renderToStaticMarkup(<RichText text={'Usa `const` aquí'} />)
    expect(html).toContain('<code>const</code>')
    expect(html).not.toContain('blk-code')
  })

  it('una opción de test con un bloque ``` también lleva su tarjeta (inline)', () => {
    const html = renderToStaticMarkup(<RichText text={'```ts\nconst x = 1;\n```'} inline />)
    expect(html).toContain('blk-code')
    expect(html).toContain('hljs-keyword')
  })

  it('un trozo de bloque ``` partido por un hueco de cloze no monta una tarjeta a medias', () => {
    const html = renderToStaticMarkup(<RichText text={'const x = 1;\n```'} inline />)
    expect(html).not.toContain('blk-code')
  })

  it('en vivo (streaming) no resalta, pero deja la tarjeta', () => {
    const html = renderToStaticMarkup(<RichText text={'```ts\nconst x = 1;\n```'} streaming />)
    expect(html).toContain('blk-code')
    expect(html).not.toContain('hljs-keyword')
    expect(html).toContain('TypeScript')
  })

  it('no deja HTML del código sin escapar', () => {
    const html = renderToStaticMarkup(<RichText text={'```html\n<script>alert(1)</script>\n```'} />)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;')
    expect(html).toContain('hljs-name')
  })
})

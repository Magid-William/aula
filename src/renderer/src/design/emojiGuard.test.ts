// Nada de emojis en la interfaz (decisión del dueño): ni en los textos (es/en) ni en el código que pinta. Hay que contar
// también los símbolos que iOS y Android dibujan como emoji de color cuando la fuente no los tiene (↩, ▶, ↔…): para una
// tecla o un icono, los iconos a tinta de Aula (design/icons). Un símbolo que deba quedarse lleva U+FE0E (forma de texto).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findEmoji } from '@engine/base/emoji'

const RENDERER = join(__dirname, '..')

function* files(dir: string, ext: RegExp): Generator<string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* files(p, ext)
    else if (ext.test(f) && !/\.test\.tsx?$/.test(f) && !/\.testutil\.ts$/.test(f)) yield p
  }
}

/** El código sin sus comentarios (los comentarios pueden hablar de «↩»: no se pintan). */
function withoutComments(src: string): string {
  // los de bloque se cambian por sus saltos de línea: así los números de línea siguen valiendo
  return src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:\\])\/\/.*$/gm, '$1')
}

describe('sin emojis en la interfaz', () => {
  it('los textos de la interfaz (es y en) no llevan emojis', () => {
    const problems: string[] = []
    for (const p of files(join(RENDERER, 'i18n', 'locales'), /\.json$/)) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        const e = findEmoji(line)
        if (e) problems.push(`${relative(RENDERER, p)}:${i + 1} ${e}`)
      })
    }
    expect(problems).toEqual([])
  })

  it('el código de la interfaz no pinta emojis ni símbolos que se vuelven emoji', () => {
    const problems: string[] = []
    for (const p of files(RENDERER, /\.tsx?$/)) {
      withoutComments(readFileSync(p, 'utf8')).split('\n').forEach((line, i) => {
        const e = findEmoji(line)
        if (e) problems.push(`${relative(RENDERER, p)}:${i + 1} ${e}`)
      })
    }
    expect(problems).toEqual([])
  })
})

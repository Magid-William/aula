// La fuente, una sola vez: si la respuesta ya trae sus citas como píldoras («Apuntes del tema 3 · p. 12», que abren el lector),
// el paréntesis «(Fuente: …, p. N)» / «(Source: …)» que las nombra se quita del texto. Solo se quita si TODO lo que cita está en
// las píldoras; lo demás (una cita sin material encontrado, el código, «Basado en:») queda igual.
import { normTitle, parseCitation } from '@engine/assistant/citations'

export interface CitedSource {
  title: string
  page?: number
}

const PAREN = /\((?:fuentes?|sources?|fontes?|quellen?)\s*:\s*([^()[\]\n]{2,240}?)\)/gi

const keyOf = (c: CitedSource): string => `${normTitle(c.title)}#${c.page ?? ''}`

/** ¿Está entre backticks (código en línea o un bloque ```)? Cuenta los ` que hay antes, como el lector de citas. */
const inCode = (text: string, at: number): boolean => text.slice(0, at).split('`').length % 2 === 0

export function stripCitedSources(markdown: string, citations: readonly CitedSource[] | undefined): string {
  if (!citations?.length || !PAREN.test(markdown)) return markdown
  const known = new Set(citations.map(keyOf))
  PAREN.lastIndex = 0
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = PAREN.exec(markdown))) {
    if (inCode(markdown, m.index)) continue
    const parts = m[1].split(';').map((p) => parseCitation(p.trim()))
    if (!parts.length || parts.some((c) => !c || !known.has(keyOf(c)))) continue
    let from = m.index
    let to = m.index + m[0].length
    const lineStart = markdown.lastIndexOf('\n', from - 1) + 1
    const nl = markdown.indexOf('\n', to)
    const lineEnd = nl < 0 ? markdown.length : nl
    if (!markdown.slice(lineStart, from).trim() && !markdown.slice(to, lineEnd).trim()) {
      // la cita era la línea entera: se va la línea (y la línea en blanco que la separaba, para no dejar dos seguidas)
      from = lineStart
      to = nl < 0 ? lineEnd : nl + 1
      if (markdown[to] === '\n' && (from === 0 || markdown.slice(from - 2, from) === '\n\n')) to++
    } else {
      // dentro de una frase: se va también el espacio de delante («… negativo (Fuente: …).» → «… negativo.»)
      while (from > lineStart && /[ \t]/.test(markdown[from - 1])) from--
    }
    out += markdown.slice(last, from)
    last = to
  }
  const text = out + markdown.slice(last)
  // si la cita era lo último, no deja un salto colgando
  return /\s$/.test(markdown) ? text : text.trimEnd()
}

// Una fila de ecuaciones escrita como una sola fórmula («180° = π rad \qquad 1° = π/180 rad \qquad …»): se parte por los
// espacios grandes de arriba del todo (fuera de llaves, de \left…\right y de entornos) para que, en una pantalla estrecha,
// cada ecuación vaya en su línea en lugar de quedar oculta en una fila que se desplaza de lado.

const letter = (c: string | undefined): boolean => !!c && /[a-zA-Z]/.test(c)

/** ¿Empieza en `i` la orden `name` (y no otra más larga, como \leftarrow para \left)? */
const command = (tex: string, i: number, name: string): boolean => tex.startsWith(name, i) && !letter(tex[i + name.length])

/** Las ecuaciones de una fila separadas con \qquad. Sin separadores (o si todo quedaría vacío), la fórmula tal cual. */
export function splitEquations(tex: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i]
    if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
    if (c !== '\\') continue
    if (command(tex, i, '\\begin') || command(tex, i, '\\left')) depth++
    else if (command(tex, i, '\\end') || command(tex, i, '\\right')) depth = Math.max(0, depth - 1)
    else if (depth === 0 && command(tex, i, '\\qquad')) {
      parts.push(tex.slice(from, i))
      from = i + '\\qquad'.length
      i = from - 1
      continue
    }
    // lo escapado (\{ \} \\) no abre ni cierra nada
    if (!letter(tex[i + 1])) i++
  }
  parts.push(tex.slice(from))
  const out = parts.map((p) => p.trim()).filter(Boolean)
  return out.length > 1 ? out : [tex]
}

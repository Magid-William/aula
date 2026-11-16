// Las reglas del arte (README del diseño, «Una sola mano»), fijadas leyendo las fuentes de la interfaz: un solo estilo de dibujo
// (sin pegatinas ni sprites que solo adornan), el pigmento solo para el examen, solo flota lo que se dice y las gotas de pintura
// solo en los logros de verdad.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = join(__dirname, '..')

/** Las fuentes .ts/.tsx de la interfaz (sin tests), con su ruta relativa a `src/renderer/src` y con «/». */
function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push({ file: relative(RENDERER, p).split(sep).join('/'), text: readFileSync(p, 'utf8') })
    }
  }
  walk(RENDERER)
  return out
}

/** Las etiquetas JSX que abren `<Nombre …>` en un texto, enteras (respeta llaves y comillas: `=>` no cierra la etiqueta). */
function openTags(text: string, name: string): string[] {
  const tags: string[] = []
  const re = new RegExp(`<${name}(?=[\\s/>])`, 'g')
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 0
    let quote: string | null = null
    let i = m.index + m[0].length
    for (; i < text.length; i++) {
      const c = text[i]
      if (quote) {
        if (c === quote && text[i - 1] !== '\\') quote = null
      } else if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push(text.slice(m.index, i + 1))
  }
  return tags
}

/** La etiqueta sin lo que va entre llaves ni entre comillas: quedan solo los nombres de sus atributos. */
function attrsOnly(tag: string): string {
  let out = ''
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < tag.length; i++) {
    const c = tag[i]
    if (quote) {
      if (c === quote && tag[i - 1] !== '\\') quote = null
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (depth === 0 && (c === '"' || c === "'" || c === '`')) quote = c
    else if (depth === 0) out += c
  }
  return out
}

/** ¿La etiqueta lleva ese atributo (`mark={…}`, `floating`)? */
const hasAttr = (tag: string, attr: string): boolean => new RegExp(`\\s${attr}(?=[\\s=/>])`).test(attrsOnly(tag))

const files = sources()
const outsideDesign = files.filter((f) => !f.file.startsWith('design/'))
const where = (pred: (f: { file: string; text: string }) => boolean): string[] => files.filter(pred).map((f) => f.file).sort()

describe('las reglas del arte', () => {
  it('el lector de etiquetas no corta en un «=>» ni en las comillas', () => {
    const [tag] = openTags(`<Card onClick={() => go('a>b')} mark={ink} className="x>y">hola</Card>`, 'Card')
    expect(tag).toBe(`<Card onClick={() => go('a>b')} mark={ink} className="x>y">`)
    expect(hasAttr(tag, 'mark')).toBe(true)
    expect(hasAttr('<Card floating elevation={2}>', 'floating')).toBe(true)
    expect(hasAttr(`<Card className={floating ? 'a' : 'b'}>`, 'floating')).toBe(false)
    expect(openTags('<CardList /><Card/>', 'Card')).toEqual(['<Card/>'])
  })

  it('un solo estilo de dibujo: ni pegatinas ni sprites que solo adornan (ni importados, ni pintados, ni exportados)', () => {
    const gone = ['Companion', 'PixelFlame', 'PixelSky', 'PixelEnvelope', 'PixelMedal', 'FannedDeck']
    for (const name of gone) {
      const used = where(({ text }) =>
        new RegExp(`import\\s*(type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}`).test(text) ||
        new RegExp(`<${name}(?=[\\s/>])`).test(text) ||
        new RegExp(`export\\s+(const|function|class)\\s+${name}\\b`).test(text)
      )
      expect(used, name).toEqual([])
    }
  })

  it('el pigmento es el examen: `<PigmentMark` solo dentro del diseño', () => {
    expect(where((f) => !f.file.startsWith('design/') && /<PigmentMark(?=[\s/>])/.test(f.text))).toEqual([])
  })

  it('`mark` en una tarjeta solo en «El examen» del Resumen y en la portada del simulacro; en una fila, en ninguna', () => {
    const cards = outsideDesign.filter((f) => openTags(f.text, 'Card').some((t) => hasAttr(t, 'mark'))).map((f) => f.file).sort()
    expect(cards).toEqual(['screens/course/Overview.tsx', 'screens/study/exam/ExamStart.tsx'])
    expect(outsideDesign.filter((f) => openTags(f.text, 'Row').some((t) => hasAttr(t, 'mark'))).map((f) => f.file)).toEqual([])
  })

  it('solo flotan los exámenes y la semana de Hoy, la tarjeta del examen del curso y el mes y la semana del calendario', () => {
    const floats = where((f) => !f.file.startsWith('design/') && (/<Floating(?=[\s/>])/.test(f.text) || /\buseFloat\(/.test(f.text) || openTags(f.text, 'Card').some((t) => hasAttr(t, 'floating'))))
    expect(floats).toEqual(['screens/calendar/MonthView.tsx', 'screens/calendar/WeekView.tsx', 'screens/course/Overview.tsx', 'screens/home/Exams.tsx', 'screens/home/Week.tsx'])
  })

  it('las gotas de pintura (`pixelBurst`) solo en los logros de verdad (y en los choques de la física, que son otra cosa)', () => {
    const bursts = where((f) => !f.file.startsWith('design/') && /\bpixelBurst\(/.test(f.text))
    expect(bursts).toEqual(['app/shell/AchievementToast.tsx', 'screens/study/Summary.tsx', 'screens/study/exam/ExamReport.tsx', 'tools/physics/sims/Collisions.tsx'])
  })
})

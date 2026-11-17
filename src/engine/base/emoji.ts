// Emojis en lo que lee el estudiante: Aula dibuja sus propios iconos a tinta y no usa emojis. Un símbolo que tiene forma de
// texto (↔, ▶, ↩, ✔) se queda, pero obligado a dibujarse como texto (U+FE0E); un emoji de verdad (😀, 🚀, banderas,
// secuencias con ZWJ o tono de piel) se quita. Puro: lo usan el validador del contenido y la interfaz.

/** Una secuencia de emoji: pictograma con selector o tono, cadenas con ZWJ, teclas «1️⃣» y banderas (dos indicadores). */
const SEQUENCE = /(?:\p{Extended_Pictographic}[︎️]?\p{Emoji_Modifier}?(?:‍\p{Extended_Pictographic}[︎️]?\p{Emoji_Modifier}?)*|[#*0-9]️?⃣|\p{Regional_Indicator}{1,2})/gu

/** Símbolos de siempre que ninguna fuente pinta como emoji. */
const PLAIN = new Set(['©', '®', '™'])

const single = (s: string): boolean => Array.from(s).length === 1

/** El primer emoji del texto (para avisar), o `null`. Un símbolo ya forzado a texto (con U+FE0E) no cuenta. */
export function findEmoji(text: string): string | null {
  for (const m of text.matchAll(SEQUENCE)) {
    const seq = m[0]
    const base = Array.from(seq)[0]
    if (PLAIN.has(base) && !seq.includes('️')) continue
    if (seq.length === base.length + 1 && seq.endsWith('︎')) continue
    return seq
  }
  return null
}

/**
 * Doma los emojis de un texto: los símbolos con forma de texto se quedan como texto (U+FE0E) y los emojis se quitan, con el
 * espacio que los separaba («🚀 Empieza» → «Empieza»). Lo demás no cambia.
 */
export function tameEmoji(text: string): string {
  if (!text) return text
  SEQUENCE.lastIndex = 0
  if (!SEQUENCE.test(text)) return text
  SEQUENCE.lastIndex = 0
  return text.replace(SEQUENCE, (seq: string, offset: number, all: string) => {
    if (/^[#*0-9]/.test(seq)) return seq[0]
    const bare = seq.replace(/[︎️]/g, '')
    // un solo símbolo que se puede escribir como texto: se queda, sin color
    if (single(bare) && !/\p{Emoji_Presentation}/u.test(bare) && !/\p{Regional_Indicator}/u.test(bare)) return PLAIN.has(bare) ? bare : bare + '︎'
    // un emoji: fuera, y con él un espacio que quede doble o al principio
    const before = offset === 0 ? '\n' : all[offset - 1]
    const after = all[offset + seq.length] ?? ''
    return /\s/.test(before) && after === ' ' ? '\u0000' : ''
  }).replace(/\u0000 /g, '').replace(/\u0000/g, '')
}

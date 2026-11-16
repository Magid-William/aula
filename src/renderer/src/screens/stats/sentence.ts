// Frases con las cifras dentro: el texto traducido se pide con una marca invisible en lugar de cada cifra y luego se parte
// en trozos de texto y huecos, para pintar cada cifra aparte (en serif, contando hacia arriba).

const MARK = '⁣'

/** La marca de un hueco: se pasa como valor de la interpolación ({{time}} → slot('time')). */
export function slot(name: string): string {
  return `${MARK}${name}${MARK}`
}

export type SentencePart = { kind: 'text'; text: string } | { kind: 'slot'; name: string }

/** Parte una frase en texto y huecos (en orden; sin trozos vacíos). */
export function splitSlots(text: string): SentencePart[] {
  const out: SentencePart[] = []
  const pieces = text.split(MARK)
  pieces.forEach((piece, i) => {
    // las marcas van de dos en dos: lo que queda entre una pareja es el nombre del hueco
    if (i % 2 === 1 && i < pieces.length - 1) out.push({ kind: 'slot', name: piece })
    else if (piece) out.push({ kind: 'text', text: piece })
  })
  return out
}

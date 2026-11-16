// Lógica pura de los temas en la pantalla del curso: por cuál seguir («Sigue aquí»), el dominio que se enseña (sin ver: nada,
// ni un «0 %») y el primer trozo de un resumen (una frase entera, nunca cortada con «…» a media frase).

export interface TopicMastery {
  mastery: number
  seen: boolean
}

/**
 * El tema por el que seguir: el que propone aprender el plan de hoy si lo hay; si no, el primero en el orden del curso que
 * aún no se domina (sin ver o por debajo del 85 %) y se puede abrir. Sin ninguno, nada (todo dominado).
 */
export function nextTopicId(order: readonly string[], mastery: ReadonlyMap<string, TopicMastery>, opens: (id: string) => boolean, planned?: string): string | undefined {
  if (planned && order.includes(planned) && opens(planned)) return planned
  return order.find((id) => {
    const m = mastery.get(id)
    return opens(id) && (!m?.seen || m.mastery < MASTERED)
  })
}

/** A partir de aquí un tema cuenta como dominado (la marca de visto del mapa). */
export const MASTERED = 0.85

/** El dominio que se enseña de un tema: sin verlo, ninguno (una barra vacía con contorno, sin cifra). */
export function shownMastery(m: TopicMastery | undefined): number | undefined {
  return m?.seen ? Math.max(0, Math.min(1, m.mastery)) : undefined
}

/** La primera frase de un resumen (con su punto); si no hay frases claras, el texto entero. */
export function firstSentence(text: string | undefined): string {
  const s = (text ?? '').trim()
  if (!s) return ''
  // un punto (o ? !) seguido de espacio y mayúscula: ahí acaba la frase (no corta «p. ej.», «3.5» ni «s = rθ.»)
  const m = /^(.+?[.!?])\s+(?=[\p{Lu}¿¡])/u.exec(s)
  return m ? m[1] : s
}

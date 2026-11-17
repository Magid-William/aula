// Dos dedos sobre una gráfica (teléfono, tableta): la distancia entre ellos acerca o aleja, y el punto medio la arrastra,
// como en un mapa. Un dedo solo la mueve en horizontal; en vertical desplaza la página (`touch-action: pan-y`).

export interface Spot {
  x: number
  y: number
}

/** Distancia entre dos dedos (px). */
export function spread(a: Spot, b: Spot): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Punto medio entre dos dedos (px). */
export function middle(a: Spot, b: Spot): Spot {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Factor de zoom de un pellizco, como el de la rueda (< 1 acerca), acotado: un salto del sensor no lo dispara. */
export function pinchFactor(startSpread: number, nowSpread: number): number {
  if (!(startSpread > 0) || !(nowSpread > 0)) return 1
  return Math.min(8, Math.max(1 / 8, startSpread / nowSpread))
}

/** Los dedos que tocan una gráfica: dónde está cada uno y, con dos, el pellizco de partida. */
export class Fingers<T> {
  private at = new Map<number, Spot>()
  /** El pellizco en curso: distancia y punto medio iniciales, y la vista de entonces. */
  pinch: { spread: number; mid: Spot; from: T } | null = null

  get count(): number {
    return this.at.size
  }

  /** Un dedo más. Devuelve `true` si con él empieza un pellizco (dos dedos). */
  down(id: number, p: Spot, view: T): boolean {
    this.at.set(id, p)
    if (this.at.size !== 2) return false
    const [a, b] = [...this.at.values()]
    this.pinch = { spread: spread(a, b), mid: middle(a, b), from: view }
    return true
  }

  /** Un dedo se mueve. Con un pellizco en curso devuelve la distancia y el punto medio de ahora. */
  move(id: number, p: Spot): { spread: number; mid: Spot } | null {
    if (!this.at.has(id)) return null
    this.at.set(id, p)
    if (!this.pinch || this.at.size < 2) return null
    const [a, b] = [...this.at.values()]
    return { spread: spread(a, b), mid: middle(a, b) }
  }

  /** Un dedo se levanta. Devuelve el que queda si acaba de terminar un pellizco (para seguir arrastrando con él). */
  up(id: number): Spot | null {
    this.at.delete(id)
    if (this.at.size >= 2 || !this.pinch) return null
    this.pinch = null
    return this.at.size === 1 ? [...this.at.values()][0] : null
  }
}

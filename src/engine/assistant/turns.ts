// Turnos de una conversación (port de AssistantTurns de AssistantErrors.swift): cada respuesta tiene un número y lo que llega de
// una vieja (detenida, o de otra conversación) se ignora; lo que el estudiante escribe mientras Aula responde espera en cola y
// nunca se pierde.
import type { AssistantMessage } from '@shared/assistant/types'
import { refID } from './refs'

export class AssistantTurns {
  private _current = 0
  private _queued: AssistantMessage[] = []

  get current(): number {
    return this._current
  }

  get queued(): readonly AssistantMessage[] {
    return this._queued
  }

  /** Empieza un turno nuevo (los anteriores dejan de contar). */
  begin(): number {
    return ++this._current
  }

  /** Detiene el turno en curso: lo que aún llegue de él se ignora. */
  invalidate(): void {
    this._current++
  }

  isCurrent(turn: number): boolean {
    return turn === this._current
  }

  enqueue(m: AssistantMessage): void {
    this._queued.push(m)
  }

  remove(id: string): AssistantMessage | undefined {
    const i = this._queued.findIndex((m) => m.id === id)
    if (i < 0) return undefined
    return this._queued.splice(i, 1)[0]
  }

  /** Todo lo que esperaba (al detener). */
  drain(): AssistantMessage[] {
    const out = this._queued
    this._queued = []
    return out
  }

  /** Lo que esperaba, en UN mensaje (como lo leería una persona: varios mensajes seguidos son una sola idea). */
  takeMerged(): AssistantMessage | undefined {
    // Una figura conserva su contexto (p. ej. ejercicio sin resolver); no se mezcla con preguntas de otra pantalla.
    const marked = this._queued.findIndex((m) => !!m.context?.markedFigure || !!m.context?.blockID)
    if (marked === 0) return this._queued.shift()
    const queued = this._queued.splice(0, marked < 0 ? this._queued.length : marked)
    const first = queued[0]
    if (!first) return undefined
    const merged: AssistantMessage = { ...first }
    if (queued.length > 1) {
      merged.text = queued.map((m) => m.text).filter((t) => t).join('\n\n')
      const seen = new Set<string>()
      merged.mentions = queued.flatMap((m) => m.mentions).filter((r) => {
        const k = refID(r)
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      merged.attachments = queued.flatMap((m) => m.attachments)
    }
    return merged
  }
}

// Fechas del calendario (lunes primero) con el idioma de la interfaz.
import { addDays, endOfMonth, endOfWeek, isSameDay, startOfMonth, startOfWeek } from 'date-fns'
import type { IconName } from '@renderer/design'
import type { CalEvent, CalKind } from './data'

/** El icono de cada tipo de evento. */
export const KIND_ICON: Record<CalKind, IconName> = { exam: 'exam', quiz: 'checklist', assignment: 'upload', lecture: 'users', study: 'learn', event: 'calendar' }

export const weekOpts = { weekStartsOn: 1 as const }

export function monthGrid(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), weekOpts)
  const end = endOfWeek(endOfMonth(month), weekOpts)
  const days: Date[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return days
}

export function eventsOn(events: CalEvent[], day: Date): CalEvent[] {
  return events
    .filter((e) => isSameDay(e.start, day) || (e.end && e.start < day && e.end > addDays(day, 1) && e.allDay))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
}

export const isAssessment = (e: CalEvent) => e.kind === 'exam' || e.kind === 'quiz'

/** Alto de una ficha de evento del mes en una línea y en dos (≥ 24 px para poder pulsarla) y la separación entre fichas. */
export const CHIP = { line: 24, wrap: 39, gap: 2 } as const

/**
 * Cuántas fichas caben en un día de `avail` px con `count` eventos, y cuántas de ellas (las primeras) pueden ir en dos líneas
 * para que el título se lea entero. Si no caben todos, van en una línea y la última lleva «+N»; si no cabe ninguna, 0 (puntos).
 */
export function fitChips(avail: number, count: number): { shown: number; wrap: number } {
  if (count <= 0 || !(avail > 0)) return { shown: 0, wrap: 0 }
  const cap = Math.floor((avail + CHIP.gap) / (CHIP.line + CHIP.gap))
  if (cap <= 0) return { shown: 0, wrap: 0 }
  if (count > cap) return { shown: cap, wrap: 0 }
  const spare = avail - (count * CHIP.line + (count - 1) * CHIP.gap)
  return { shown: count, wrap: Math.min(count, Math.max(0, Math.floor(spare / (CHIP.wrap - CHIP.line)))) }
}

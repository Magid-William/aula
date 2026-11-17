// Qué hace «atrás» del sistema en un dispositivo (deviceBack.ts), sin tocar la página: para probarlo solo.
import type { Route } from '../router'

export type BackAction = 'overlay' | 'back' | 'home' | null

/** Cerrar lo de encima, volver a la pantalla anterior, ir a «Hoy» (en el teléfono, la primera pestaña) o nada (salir). */
export function backAction(s: { overlay: boolean; canBack: boolean; compact: boolean; route: Route['name'] }): BackAction {
  if (s.overlay) return 'overlay'
  if (s.canBack) return 'back'
  if (s.compact && s.route !== 'home') return 'home'
  return null
}

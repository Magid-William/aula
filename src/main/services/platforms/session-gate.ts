// Las sesiones guardadas de las plataformas (particiones `persist:platform-<id>`) solo se abren si el llavero deja cifrar.
// En macOS las cookies se cifran con una clave del llavero: si el estudiante deniega el aviso, Chromium no las puede
// descifrar y, al cargar el almacén de cookies, BORRA los grupos que no lee. Así que en macOS, antes de arrancar el
// navegador de plataformas, se comprueba el llavero y, si no deja, no se toca ninguna partición en toda la ejecución (ni
// para leer, ni para la copia de las cookies al salir): solo reabrir Aula vuelve a preguntar. En Linux y Windows no cambia
// nada. La copia propia de Aula (secrets.enc) sigue igual: repone las sesiones en el siguiente arranque bueno.
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'
import { log } from '../log'

/** open = se pueden usar; checking = esperando al llavero (macOS, al arrancar); paused = no hasta reabrir Aula. */
export type SessionGate = 'open' | 'checking' | 'paused'

let gate: SessionGate = 'open'
const listeners = new Set<(g: SessionGate) => void>()

export function sessionGate(): SessionGate {
  return gate
}

export function setSessionGate(next: SessionGate): void {
  if (next === gate) return
  gate = next
  for (const fn of listeners) fn(next)
}

export function onSessionGateChange(fn: (g: SessionGate) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** El error de usar una sesión guardada mientras no se puede (lo ven la interfaz y la IA). */
export function sessionGateError(g: Exclude<SessionGate, 'open'>): AulaError {
  if (g === 'checking') {
    return new AulaError('platforms_keychain_wait', tr(
      'Aula está esperando al llavero del sistema para abrir tus sesiones de las plataformas. Contesta al aviso del sistema y vuelve a intentarlo.',
      'Aula is waiting for the system keychain to open your platform sessions. Answer your system’s prompt and try again.'
    ), { aiReason: 'The platform sessions are waiting for the system keychain prompt. Ask the student to answer it, then try again.' })
  }
  return new AulaError('platforms_keychain_restart', tr(
    'Tus sesiones de las plataformas están en pausa porque el sistema no dejó a Aula abrir el llavero (así no se borran). Reabre Aula desde el aviso de la barra lateral y, cuando el sistema lo pida, permite el acceso.',
    'Your platform sessions are paused because your system didn’t let Aula open the keychain (so they aren’t erased). Reopen Aula from the notice in the sidebar and allow access when your system asks.'
  ), { aiReason: 'The platform sessions are paused until Aula is reopened (the system keychain was denied). Do not retry; tell the student to reopen Aula from the sidebar notice.' })
}

/** Lanza si ahora no se puede tocar una sesión guardada. */
export function assertSessionsOpen(): void {
  if (gate !== 'open') throw sessionGateError(gate)
}

export interface PlatformStartDeps {
  platform: NodeJS.Platform
  /** ¿Hay cuentas? Sin cuentas no hay sesiones que proteger (ni se pregunta al llavero). */
  hasAccounts: () => boolean
  /** ¿Deja el llavero cifrar con la clave de las cookies? (puede esperar a que se conteste el aviso). */
  probe: () => Promise<boolean>
  /** Arranca el navegador de plataformas (reposición de cookies y mantener las sesiones). */
  start: () => Promise<void>
}

/**
 * Arranque protegido del navegador de plataformas. En macOS con cuentas, primero se pregunta al llavero (mientras, las
 * sesiones esperan): si no deja, quedan en pausa toda la ejecución y no se arranca. Fuera de macOS, como siempre.
 */
export async function startPlatformSessions(deps: PlatformStartDeps): Promise<'started' | 'paused'> {
  if (deps.platform === 'darwin' && deps.hasAccounts()) {
    setSessionGate('checking')
    const ok = await deps.probe().catch(() => false)
    if (!ok) {
      setSessionGate('paused')
      log.warn('[platforms] el llavero no deja descifrar las cookies: las sesiones quedan en pausa hasta reabrir Aula (no se tocan)')
      return 'paused'
    }
  }
  setSessionGate('open')
  await deps.start()
  return 'started'
}

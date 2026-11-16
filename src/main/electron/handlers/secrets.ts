// Estado del almacén de secretos para la interfaz (nunca valores): bloqueado si el llavero no deja leerlo o cifrar, y si
// las sesiones de las plataformas están en pausa por lo mismo. En macOS el sistema pregunta al llavero una sola vez por
// ejecución (también tras «Denegar»), así que ahí «Reintentar» reabre Aula: es lo único que vuelve a mostrar el aviso.
import { app } from 'electron'
import type { SecretsState } from '@shared/ipc/secrets'
import { secrets } from '@main/services/secrets'
import { FileSecretStore } from '@main/services/secrets-file'
import { onSessionGateChange } from '@main/services/platforms/session-gate'
import { isServerMode } from '@main/services/remote/server-mode'
import { log } from '@main/services/log'
import { currentSecretsState, keychainNeedsRelaunch, secretsStateOf } from '../secrets'
import { emit, handle } from '../rpc'

function store(): FileSecretStore | null {
  const s = secrets()
  return s instanceof FileSecretStore ? s : null
}

let relaunching = false

/** Reabre Aula (un momento después, para que la respuesta llegue a la interfaz). Una sola vez: dos `app.relaunch()` abrirían
 *  dos Aulas. */
function relaunch(): void {
  if (relaunching) return
  relaunching = true
  log.info('[secretos] Aula se reabre para volver a preguntar al llavero')
  setTimeout(() => {
    app.relaunch()
    app.quit()
  }, 150)
}

export function register(): void {
  handle('secrets.status', (): SecretsState => currentSecretsState())
  handle('secrets.retry', (): SecretsState => {
    const s = secretsStateOf(store()?.retry() ?? { locked: false })
    // macOS: reintentar dentro de la misma ejecución nunca vuelve a preguntar al llavero (sin ventana, como servidor, no)
    if (s.needsRestart && keychainNeedsRelaunch() && !isServerMode()) {
      relaunch()
      return s
    }
    emit('secrets.changed', s)
    return s
  })
  handle('secrets.reset', (): SecretsState => {
    const st = store()
    if (!st) return currentSecretsState()
    const r = st.reset()
    if (r.movedTo) log.warn('[secretos] se empezó de cero (archivo anterior apartado)')
    const out: SecretsState = { ...secretsStateOf(r.status), ...(r.movedTo ? { movedTo: r.movedTo.split(/[\\/]/).pop() } : {}) }
    emit('secrets.changed', out)
    return out
  })
  // las sesiones de las plataformas pasan a pausa (macOS, llavero denegado): la interfaz lo avisa igual que el almacén
  onSessionGateChange((gate) => {
    if (gate === 'paused') emit('secrets.changed', currentSecretsState())
  })
}

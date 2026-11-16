// Secretos cifrados con safeStorage (Llavero en macOS, DPAPI en Windows, libsecret/kwallet en Linux) en secrets.enc.
// Solo en Linux sin llavero se guardan en claro (permisos 0600, con aviso en Ajustes). En macOS y Windows, si el sistema no
// deja cifrar (en macOS: «Denegar» en el aviso del llavero), no se guarda nada hasta que se pueda: nunca en claro.
// La lógica (y lo que pasa si el llavero no deja leer el archivo: bloqueo sin perder nada) está en services/secrets-file.ts.
import { safeStorage } from 'electron'
import { paths } from '@main/services/paths'
import { secrets } from '@main/services/secrets'
import { FileSecretStore, type SecretCipher, type SecretProtection, type SecretsStatus } from '@main/services/secrets-file'
import { sessionGate } from '@main/services/platforms/session-gate'
import type { SecretsState } from '@shared/ipc/secrets'

const cipher: SecretCipher = {
  protection: () => secretProtection(),
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data)
}

/** macOS lee el llavero una sola vez por proceso (también tras «Denegar»): solo reabrir Aula vuelve a preguntar. */
export function keychainNeedsRelaunch(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin'
}

export class SafeStorageSecretStore extends FileSecretStore {
  constructor(onChange?: (state: SecretsState) => void) {
    super(() => paths.secrets(), cipher, {
      onChange: onChange && ((status) => onChange(secretsStateOf(status))),
      restartToRetry: keychainNeedsRelaunch()
    })
  }
}

/**
 * Lo que ve la interfaz: el estado del almacén y, si las sesiones de las plataformas están en pausa porque el llavero no
 * deja descifrar sus cookies (macOS, ver session-gate.ts), eso también (y solo reabrir Aula lo arregla).
 */
export function secretsStateOf(status: SecretsStatus): SecretsState {
  if (sessionGate() !== 'paused') return status
  return { ...status, platformsPaused: true, needsRestart: true }
}

/** El estado actual para la interfaz (sin almacén en archivo, como en las pruebas: abierto). */
export function currentSecretsState(): SecretsState {
  const s = secrets()
  return secretsStateOf(s instanceof FileSecretStore ? s.status() : { locked: false })
}

/**
 * ¿Cómo se protegen los secretos? 'os' = cifrado del sistema; 'basic' = Linux sin llavero (safeStorage usa una clave fija:
 * eso no protege nada, así que se trata como sin cifrar y se avisa en Ajustes); 'unavailable' = macOS o Windows sin
 * cifrado ahora mismo (llavero denegado o bloqueado): no se escribe nada, ni en claro.
 */
export function secretProtection(platform: NodeJS.Platform = process.platform): SecretProtection {
  if (platform !== 'linux') return safeStorage.isEncryptionAvailable() ? 'os' : 'unavailable'
  if (!safeStorage.isEncryptionAvailable()) return 'basic'
  try {
    const backend = safeStorage.getSelectedStorageBackend()
    if (backend === 'basic_text' || backend === 'unknown') return 'basic'
  } catch {
    return 'basic'
  }
  return 'os'
}

/**
 * macOS: ¿deja el llavero cifrar con la clave que usan las cookies de Chromium (OSCryptAsync, la misma instancia)? Si el
 * estudiante deniega el aviso, esa clave falta toda la ejecución y `encryptStringAsync` lo rechaza. Puede tardar lo que
 * tarde en contestar al aviso.
 */
export async function cookieEncryptionAvailable(): Promise<boolean> {
  try {
    const out = await safeStorage.encryptStringAsync('probe')
    return out.length > 0
  } catch {
    return false
  }
}

// El almacén de secretos (claves de API, sesiones de las plataformas) visto por la interfaz: solo su ESTADO, nunca valores.
// Si el llavero del sistema no deja leer secrets.enc, el almacén queda bloqueado (nada se escribe ni se pierde) y la
// interfaz ofrece «Reintentar» o, si sirve (`canReset`), «Empezar de cero» (aparta el archivo, no lo borra). En macOS el
// sistema solo pregunta al llavero una vez por ejecución: tras «Denegar», «Reintentar» reabre Aula (`needsRestart`).

declare module './contract' {
  interface RpcMethods {
    'secrets.status': { args: void; result: SecretsState }
    /** Vuelve a intentar abrir el llavero ahora (con `needsRestart`, en macOS, reabre Aula). */
    'secrets.retry': { args: void; result: SecretsState }
    /** Aparta el archivo que no se puede leer (secrets.unreadable-<fecha>.enc) y empieza con el almacén vacío. */
    'secrets.reset': { args: void; result: SecretsState }
  }
  interface RpcEvents {
    'secrets.changed': SecretsState
  }
}

export interface SecretsState {
  /** true = el almacén no se puede leer o no se puede escribir (nada se guarda ni se borra). */
  locked: boolean
  /**
   * decrypt = el llavero no lo descifra (denegado, bloqueado o clave distinta); corrupt = archivo dañado; io = no se lee;
   * unavailable = el sistema no deja cifrar (macOS o Windows): no se guarda nada, nunca en claro.
   */
  reason?: 'decrypt' | 'corrupt' | 'io' | 'unavailable'
  checkedAt?: string
  /** Tras «Empezar de cero»: nombre del archivo apartado. */
  movedTo?: string
  /** Solo reabrir Aula lo arregla (macOS tras «Denegar»: lee el llavero una vez por ejecución): «Reintentar» reabre la app. */
  needsRestart?: boolean
  /** Se ofrece «Empezar de cero»: el archivo no se lee y después se podrá cifrar (tras «Denegar» en macOS, no: al reabrir
   *  Aula el archivo se lee bien, y apartarlo perdería las claves). */
  canReset?: boolean
  /** Las sesiones de las plataformas quedan en pausa hasta reabrir Aula (sin tocarlas, para que el sistema no las borre). */
  platformsPaused?: boolean
}

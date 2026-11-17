// Desde dónde se usa Aula (su ventana, un dispositivo de una Aula en un Mac o de un servidor) y qué se arregla desde aquí.
// Lógica pura, sin `window`: api.ts la aplica a lo que dice la página (window.aula). Probada en device.test.ts.

/** Lo que la página sabe de sí misma (lo pone el puente de un dispositivo; en la ventana, todo falso). */
export interface DeviceFlags {
  remote: boolean
  owner: boolean
  server: boolean
}

/**
 * - 'window': la ventana de Aula en el ordenador: lo lleva todo.
 * - 'owner': un dispositivo propietario de Aula como servidor: hace de ventana (la IA y sus claves, el presupuesto,
 *   la privacidad, las plataformas), salvo los datos y las actualizaciones, que se llevan en el servidor.
 * - 'macDevice': un dispositivo de una Aula en un Mac: solo lo de uso diario; lo demás se hace en el Mac.
 * - 'serverDevice': un dispositivo NO propietario de un servidor: solo lo de uso diario; lo demás lo hace el propietario.
 */
export type DeviceRole = 'window' | 'owner' | 'macDevice' | 'serverDevice'

export function deviceRole(f: DeviceFlags): DeviceRole {
  if (!f.remote) return 'window'
  // solo hay propietarios en un servidor; si la página dijera «propietario» sin «servidor», manda lo que puede hacer
  if (f.owner) return 'owner'
  return f.server ? 'serverDevice' : 'macDevice'
}

/**
 * Dónde se cambian la IA (y sus claves), el presupuesto y la privacidad cuando no es aquí: en el Mac ('mac') o desde
 * el dispositivo propietario ('owner'). `null`: aquí mismo (la ventana o el propietario).
 */
export function settingsElsewhere(role: DeviceRole): 'mac' | 'owner' | null {
  if (role === 'macDevice') return 'mac'
  if (role === 'serverDevice') return 'owner'
  return null
}

/** Las notas posibles bajo las claves de IA (claves de `settings:ai.*`). */
export type KeySafeNote = 'keySafe' | 'keySafeBasic' | 'keySafeServer' | 'keySafeServerBasic'

/**
 * La nota bajo las claves de IA: dónde queda una clave pegada desde aquí y si va cifrada. Las claves se guardan donde
 * corre Aula: en este ordenador (la ventana) o en el servidor (el propietario, que las pega desde su móvil). Con
 * `protection` 'basic' (Linux sin llavero; un servidor arranca con `--password-store=basic`) se guardan sin cifrar.
 * `undefined` mientras no se sabe cómo se protegen: `null`, sin nota, para no prometer un cifrado que quizá no hay; lo
 * mismo con 'unavailable' (macOS o Windows sin llavero ahora: no se guarda nada y lo explica el aviso de la barra lateral).
 * Solo guardan claves la ventana y el propietario: los demás dispositivos eligen entre lo ya listo (`null`).
 */
export function keySafeNote(role: DeviceRole, protection: 'os' | 'basic' | 'unavailable' | undefined): KeySafeNote | null {
  if (!protection || protection === 'unavailable' || settingsElsewhere(role)) return null
  const basic = protection === 'basic'
  if (role === 'owner') return basic ? 'keySafeServerBasic' : 'keySafeServer'
  return basic ? 'keySafeBasic' : 'keySafe'
}

/**
 * Lo que un dispositivo no puede pedir (remote/policy.ts lo niega): 'window', solo desde la ventana del ordenador (también
 * lo niega a un propietario: abre un diálogo o una carpeta allí, exporta todo); 'owner', también desde un dispositivo
 * propietario. Esas acciones no se ofrecen donde no se pueden hacer: antes se rellenaba un diálogo para acabar en «Esto solo
 * se puede hacer desde Aula en tu Mac». device.test.ts comprueba que la tabla dice lo mismo que la política.
 */
export const ONLY_FROM = {
  'courses.export': 'window',
  'courses.delete': 'owner',
  'calendar.exportICS': 'window',
  'calendar.importICS': 'window',
  'calendar.subscribe': 'owner',
  'calendar.unsubscribe': 'owner',
  'calendar.renameSubscription': 'owner',
  'calendar.refreshSubscription': 'owner',
  'documents.pick': 'window',
  'documents.reveal': 'window',
  'documents.remove': 'owner',
  'documents.renderPDF': 'owner',
  'documents.save': 'window',
  'documents.revealSaved': 'window',
  'figures.save': 'window',
  'platforms.approvals': 'owner',
  'platforms.approve': 'owner'
} as const satisfies Record<string, 'window' | 'owner'>

export type DeviceGatedMethod = keyof typeof ONLY_FROM

/** ¿Se puede pedir `method` desde aquí? (la ventana, siempre; un propietario, lo suyo; los demás dispositivos, nada de esto). */
export function canFrom(role: DeviceRole, method: DeviceGatedMethod): boolean {
  if (role === 'window') return true
  return role === 'owner' && ONLY_FROM[method] === 'owner'
}

/**
 * El teclado de la pantalla para un número que puede ser negativo (una respuesta, −5 °C, una matriz): el numérico, salvo en
 * iOS, cuyo teclado decimal no tiene «−» (allí, el entero, con su capa de números). `platform`: `api.platform`.
 */
export function signedNumberKeyboard(platform: string): 'decimal' | 'text' {
  return platform === 'ios' || platform === 'ipados' ? 'text' : 'decimal'
}

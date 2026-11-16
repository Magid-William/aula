// «Reanudar» y «Quedarme con lo que hay» del monitor de una creación parada. Si el proceso principal lo rechaza (sin
// proveedor, sin clave, otra creación en marcha, ejecución borrada) se avisa con su mensaje: antes «Reanudar» se lo
// tragaba y el botón parecía roto (R4).
import i18n from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { toast } from '@renderer/design/Toast'

export type StoppedAction = 'resume' | 'keep'

const METHOD = { resume: 'generation.resume', keep: 'generation.keep' } as const
const FAILED = { resume: 'run:resumeFailed', keep: 'run:keepFailed' } as const

/** Pide la acción al proceso principal; true si salió bien. Nunca rechaza: un fallo acaba en un aviso con su mensaje. */
export async function runStoppedAction(kind: StoppedAction, id: string): Promise<boolean> {
  try {
    await api.invoke(METHOD[kind], { id })
    return true
  } catch (e) {
    toast.error(i18n.t(FAILED[kind]), e instanceof Error ? e.message : undefined)
    return false
  }
}

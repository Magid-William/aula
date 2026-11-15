import type { AssistantMessage } from '@shared/assistant/types'
import type { RpcArgs } from '@shared/ipc'

/** Sólo se reintenta el último fallo de una pregunta del estudiante, incluidas las preguntas que son sólo imagen. */
export function retryableFailure(messages: readonly AssistantMessage[], unavailable = false): string | undefined {
  const failed = messages.at(-1)
  if (unavailable || !failed || failed.role !== 'assistant' || !failed.failed || failed.interrupted || failed.origin) return undefined
  const asked = messages.slice(0, -1).findLast((m) => m.role === 'user')
  if (!asked || asked.origin || (!asked.text.trim() && !asked.mentions.length && !asked.attachments.length)) return undefined
  return failed.id
}

export interface PendingRetry extends RpcArgs<'chat.retry'> { since: string }

/** Guarda la petición en vuelo antes del primer await: dos clics no envían dos reintentos. Los hilos son independientes. */
export function createRetryRequest(options: {
  send: (request: RpcArgs<'chat.retry'>) => Promise<unknown>
  changed: (request: RpcArgs<'chat.retry'>, pending: PendingRetry | null) => void
  failed: (request: RpcArgs<'chat.retry'>, error: unknown) => void
}): (threadId: string, failedMessageId: string) => Promise<boolean> {
  const requests = new Map<string, { failedMessageId: string; promise: Promise<boolean> }>()
  return (threadId, failedMessageId) => {
    const active = requests.get(threadId)
    if (active) return active.failedMessageId === failedMessageId ? active.promise : Promise.resolve(false)
    const request = { threadId, failedMessageId }
    const promise = Promise.resolve()
      .then(() => options.send(request))
      .then(() => true, (error: unknown) => { options.failed(request, error); return false })
      .finally(() => {
        requests.delete(threadId)
        options.changed(request, null)
      })
    requests.set(threadId, { failedMessageId, promise })
    options.changed(request, { ...request, since: new Date().toISOString() })
    return promise
  }
}

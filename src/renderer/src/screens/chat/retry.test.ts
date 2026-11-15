import { describe, expect, it, vi } from 'vitest'
import type { AssistantMessage } from '@shared/assistant/types'
import { createRetryRequest, retryableFailure, type PendingRetry } from './retry'

function message(id: string, role: AssistantMessage['role'], changes: Partial<AssistantMessage> = {}): AssistantMessage {
  return { id, role, text: '', date: '2026-11-15T00:00:00Z', mentions: [], attachments: [], cards: [], steps: [], notices: [], failed: false, interrupted: false, ...changes }
}
const image = { id: 'stored-image', kind: 'image' as const, name: 'geometry.png', bytes: 100, status: 'ready' as const, pages: 1, characters: 0, imageAssets: ['stored-image.png'] }
const user = message('original-user', 'user', { attachments: [image] })
const failed = message('failed-reply', 'assistant', { text: 'Connection failed', failed: true })
const origin = { kind: 'automation' as const, title: 'Fixture automation' }

describe('qué fallo puede reintentar el estudiante', () => {
  it('permite una imagen sin texto ni menciones y devuelve el ID del fallo, no una copia del usuario', () => {
    expect(retryableFailure([user, failed])).toBe(failed.id)
    expect(user.text).toBe('')
    expect(user.attachments).toEqual([image])
  })
  it('conserva preguntas de texto y menciones, también después de un reintento fallido', () => {
    expect(retryableFailure([message('u', 'user', { text: 'Pregunta' }), failed])).toBe(failed.id)
    expect(retryableFailure([message('u', 'user', { mentions: [{ kind: 'course', courseID: 'course', title: 'Course' }] }), failed])).toBe(failed.id)
    expect(retryableFailure([user, failed, { ...failed, id: 'retry-failed' }])).toBe('retry-failed')
  })
  it('no salta una automatización para reintentar una pregunta humana anterior', () => {
    expect(retryableFailure([user, message('automatic', 'user', { origin, text: 'Do something' }), failed])).toBeUndefined()
    expect(retryableFailure([user, { ...failed, origin }])).toBeUndefined()
  })
  it('no ofrece reintentar mientras está ocupado, enviando o con cola', () => {
    expect(retryableFailure([user, failed], true)).toBeUndefined()
  })
  it('rechaza vacíos, respuestas interrumpidas, fallos antiguos y mensajes que no son respuestas', () => {
    for (const messages of [[], [failed], [message('empty', 'user'), failed], [user, { ...failed, interrupted: true }], [user, { ...failed, failed: false }], [user, failed, message('later', 'user', { text: 'Otra pregunta' })], [user, { ...failed, role: 'user' as const }]]) {
      expect(retryableFailure(messages)).toBeUndefined()
    }
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}

describe('solicitud de reintento', () => {
  it('un doble clic usa una sola operación y sólo transmite los dos identificadores', async () => {
    const rpc = deferred<unknown>()
    const send = vi.fn(() => rpc.promise)
    const changed = vi.fn()
    const failed = vi.fn()
    const retry = createRetryRequest({ send, changed, failed })
    const first = retry('thread', 'failed')
    const second = retry('thread', 'failed')
    expect(second).toBe(first)
    expect(changed).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread', failedMessageId: 'failed' }, expect.objectContaining({ threadId: 'thread', failedMessageId: 'failed', since: expect.any(String) }))
    await Promise.resolve()
    expect(send).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread', failedMessageId: 'failed' })
    await expect(retry('thread', 'other-failed')).resolves.toBe(false)
    rpc.resolve({ messageId: 'original-user', replyId: 'retry-reply', queued: false })
    await expect(first).resolves.toBe(true)
    expect(changed).toHaveBeenLastCalledWith({ threadId: 'thread', failedMessageId: 'failed' }, null)
    expect(failed).not.toHaveBeenCalled()
  })
  it('libera el estado y muestra el error si el store no puede recuperar la imagen; permite volver a intentarlo', async () => {
    const error = new Error('The saved image is missing')
    const send = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce({ queued: false })
    const changed = vi.fn(), failed = vi.fn()
    const retry = createRetryRequest({ send, changed, failed })
    await expect(retry('thread', 'failed')).resolves.toBe(false)
    expect(failed).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread', failedMessageId: 'failed' }, error)
    expect(changed).toHaveBeenLastCalledWith({ threadId: 'thread', failedMessageId: 'failed' }, null)
    await expect(retry('thread', 'failed')).resolves.toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('un recibo idempotente que no emite eventos termina la solicitud', async () => {
    const changed = vi.fn()
    const retry = createRetryRequest({ send: async () => ({ messageId: 'existing-user', replyId: 'existing-reply', queued: false }), changed, failed: vi.fn() })
    await expect(retry('thread', 'failed')).resolves.toBe(true)
    expect(changed).toHaveBeenLastCalledWith({ threadId: 'thread', failedMessageId: 'failed' }, null)
  })
  it.each(['constructor', '__proto__', 'toString'])('trata %s como un ID, sin colisiones con propiedades heredadas', async (threadId) => {
    const send = vi.fn().mockResolvedValue({ queued: false })
    const changed = vi.fn()
    const retry = createRetryRequest({ send, changed, failed: vi.fn() })
    await expect(retry(threadId, 'failed')).resolves.toBe(true)
    expect(send).toHaveBeenCalledExactlyOnceWith({ threadId, failedMessageId: 'failed' })
    expect(changed).toHaveBeenLastCalledWith({ threadId, failedMessageId: 'failed' }, null)
  })
  it('terminar una petición de otro hilo no borra el estado del visible', async () => {
    const first = deferred<unknown>(), second = deferred<unknown>()
    const states = new Map<string, PendingRetry>()
    const retry = createRetryRequest({ send: ({ threadId }) => threadId === 'a' ? first.promise : second.promise,
      changed: ({ threadId }, pending) => { if (pending) states.set(threadId, pending); else states.delete(threadId) }, failed: vi.fn() })
    const a = retry('a', 'failed-a'), b = retry('b', 'failed-b')
    first.resolve({})
    await a
    expect([...states.keys()]).toEqual(['b'])
    second.resolve({})
    await b
    expect(states.size).toBe(0)
  })
})

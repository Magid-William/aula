import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import '@renderer/i18n'
import type { AssistantMessage, AssistantThread } from '@shared/assistant/types'
import type { Conversation as ConversationData } from './data'
import { retryableFailure } from './retry'
import { Conversation } from './Conversation'

const replies = vi.hoisted(() => [] as Array<{ id: string; retry?: () => void }>)
vi.mock('./Message', () => ({
  Message: ({ m, onRetry }: { m: AssistantMessage; onRetry?: () => void }) => { replies.push({ id: m.id, retry: onRetry }); return null },
  PendingReply: () => null,
  QueuedMessage: () => null
}))
beforeEach(() => { replies.length = 0 })

function conversation(busy = false): ConversationData {
  const base = { text: '', date: '2026-11-15T00:00:00Z', mentions: [], attachments: [], cards: [], steps: [], notices: [], failed: false, interrupted: false }
  const messages: AssistantMessage[] = [
    { ...base, id: 'image-only', role: 'user', attachments: [{ id: 'image', name: 'stored.png', kind: 'image', bytes: 100, status: 'ready', pages: 1, characters: 0, imageAssets: ['stored.png'] }] },
    { ...base, id: 'failed-image-reply', role: 'assistant', text: 'Connection failed', failed: true }
  ]
  const thread: AssistantThread = { id: 'owned-thread', title: 'Test', created: base.date, updated: base.date, messages, pinned: false }
  return { thread, setThread: vi.fn(), adopt: vi.fn(), busy: { busy }, queued: [], awaiting: false, missing: false, send: vi.fn(), cancel: vi.fn(), stop: vi.fn(), retry: vi.fn().mockResolvedValue(true), retryableId: retryableFailure(messages, busy) }
}

describe('Reintentar en chat y tutor', () => {
  it('un fallo de imagen sola llama a retry por ID y nunca al compositor/send', () => {
    const conv = conversation()
    renderToStaticMarkup(<Conversation conv={conv} language="es" onCancelQueued={vi.fn()} empty={null} />)
    const action = replies.find((m) => m.id === 'failed-image-reply')?.retry
    expect(action).toBeTypeOf('function')
    action!()
    expect(conv.retry).toHaveBeenCalledExactlyOnceWith('owned-thread', 'failed-image-reply')
    expect(conv.send).not.toHaveBeenCalled()
    expect(conv.thread?.messages).toHaveLength(2)
    expect(conv.thread?.messages[0].attachments[0].imageAssets).toEqual(['stored.png'])
  })
  it('no conecta el botón de reintento mientras el hilo está ocupado', () => {
    renderToStaticMarkup(<Conversation conv={conversation(true)} language="es" onCancelQueued={vi.fn()} empty={null} />)
    expect(replies.every((m) => m.retry === undefined)).toBe(true)
  })
})

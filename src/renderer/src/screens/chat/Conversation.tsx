// La conversación en vivo (la usan el chat y el tutor del estudio): los mensajes, la respuesta que aún no existe (la línea de
// «pensando» aparece en cuanto envías), lo que espera en cola y el desplazamiento que sigue a lo que llega sin pelear contigo
// (si subes a leer, te deja y aparece «Ir al final», en la esquina de arriba a la derecha de la caja de escribir: no en medio
// de lo que estás leyendo).
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Icon, cx, spring } from '@renderer/design'
import type { AssistantMessage } from '@shared/assistant/types'
import type { Conversation as Conv } from './data'
import { Message, PendingReply, QueuedMessage } from './Message'
import { useStickToBottom } from './scroll'

export interface ConversationProps {
  conv: Conv
  language: string
  onCancelQueued: (id: string) => void
  /** Lo que se enseña sin mensajes. */
  empty: ReactNode
  className?: string
  /** Clases del contenido (ancho de lectura, márgenes). */
  contentClassName?: string
  gapClassName?: string
  /** El ancho de la caja de escribir de debajo (el «Ir al final» se alinea con su borde derecho). */
  jumpClassName?: string
}

export function Conversation({ conv, language, onCancelQueued, empty, className, contentClassName, gapClassName = 'gap-7', jumpClassName = 'px-4' }: ConversationProps) {
  const { t } = useTranslation('chat')
  const { thread, busy, queued, liveId, pendingSince } = conv
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const { stuck, held, toBottom } = useStickToBottom(scroller, content, thread?.id)
  const messages = thread?.messages ?? []
  const isEmpty = messages.length === 0 && queued.length === 0 && !pendingSince

  // al enviar (un mensaje tuyo nuevo, o a la cola), de vuelta al final; la respuesta crece debajo sin cortar tu pregunta
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.id
  const sentCount = useRef({ user: lastUser, queued: queued.length })
  useEffect(() => {
    const before = sentCount.current
    sentCount.current = { user: lastUser, queued: queued.length }
    const sent = !!lastUser && lastUser !== before.user && lastUser.startsWith('local-')
    if (sent || queued.length > before.queued) toBottom(true, sent)
  }, [lastUser, queued.length, toBottom])

  return (
    <div className={cx('relative flex min-h-0 flex-1 flex-col', className)}>
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ overflowAnchor: 'none' }}>
        <div ref={content} className={contentClassName}>
          <AnimatePresence mode="wait" initial={false}>
            {isEmpty ? (
              <motion.div key="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                {empty}
              </motion.div>
            ) : (
              <motion.div key={thread?.id ?? 'thread'} className={cx('flex flex-col', gapClassName)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                {messages.map((m) =>
                  m.id !== liveId && isBlankReply(m) ? null : (
                    <Message key={m.id} m={m} threadId={thread!.id} streaming={m.id === liveId} label={busy.label} language={language}
                      onRetry={m.id === conv.retryableId ? () => void conv.retry(thread!.id, m.id) : undefined} />
                  )
                )}
                <AnimatePresence initial={false}>
                  {pendingSince && <PendingReply key="pending" since={pendingSince} label={busy.label} />}
                </AnimatePresence>
                <AnimatePresence initial={false}>
                  {queued.map((m) => (
                    <QueuedMessage key={m.id} m={m} onCancel={() => onCancelQueued(m.id)} />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {/* subiste a leer (o la respuesta sigue debajo de tu pregunta): volver al final (con un punto de sol si Aula sigue
          escribiendo), pegado a la esquina de la caja */}
      <div className={cx('pointer-events-none absolute inset-x-0 bottom-0 z-10 mx-auto flex w-full justify-end', jumpClassName)}>
        <AnimatePresence>
          {(!stuck || held) && !isEmpty && (
            <motion.button
              key="jump"
              type="button"
              onClick={() => toBottom()}
              className="pointer-events-auto mb-2 mr-3 flex h-7 items-center gap-1.5 rounded-full border-[0.5px] border-line bg-raised pl-2 pr-2.5 t-ui text-text2 shadow-[var(--e2)] hover:text-text"
              initial={{ opacity: 0, y: 6, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.94 }}
              transition={spring.snappy}
              data-testid="chat-jump"
            >
              {liveId || pendingSince ? <span className="h-1.5 w-1.5 rounded-full bg-sun" aria-hidden /> : null}
              <Icon name="arrow-down" size={13} />
              {liveId || pendingSince ? t('jumpLive') : t('jump')}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Una respuesta de Aula que terminó sin nada (p. ej. un intento que falló antes de escribir): no se enseña una «Aula» vacía. */
export function isBlankReply(m: AssistantMessage): boolean {
  return m.role === 'assistant' && !m.failed && !m.interrupted && !m.text.trim() && !m.cards.length && !m.steps.length && !m.notices.length
}

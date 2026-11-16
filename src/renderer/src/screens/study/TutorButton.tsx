// La puerta fija al tutor al estudiar (en la cápsula de arriba; nunca en el simulacro): abre el tutor con lo que se está
// mirando (`usePublishTutorContext`), sin pregunta (sale el vacío con las preguntas rápidas), y lo vuelve a cerrar. Es la
// marca de Aula, redonda como el resto de la cápsula; mientras Aula responde, su sol cruza el arco. Sin nada publicado no se
// pinta. Su nombre no es «Tu tutor»: ese es el título del panel, que sale una sola vez.
import { useTranslation } from 'react-i18next'
import { AulaMark, IconButton, Tooltip, cx } from '@renderer/design'
import { routeKey, useRoute } from '@renderer/app/router'
import { useAulaMarkState } from '../chat/liveStatus'
import { tutorVisibleFor, useTutor } from './tutorStore'

export function TutorButton({ className }: { className?: string }) {
  const { t } = useTranslation('chat')
  const key = routeKey(useRoute())
  const published = useTutor((s) => s.published)
  const open = useTutor((s) => tutorVisibleFor(s, key))
  const mark = useAulaMarkState()
  if (!published) return null
  const toggle = () => {
    const tutor = useTutor.getState()
    if (open) tutor.close()
    else tutor.show(published, undefined, key, tutor.publishedPosition ?? undefined)
  }
  return (
    <Tooltip label={t('tutorAsk')} side="bottom">
      <IconButton label={t('tutorAsk')} size="sm" active={open} aria-pressed={open} data-tutor-button className={cx('rounded-full!', className)} onClick={toggle}>
        <AulaMark size={18} state={mark} />
      </IconButton>
    </Tooltip>
  )
}

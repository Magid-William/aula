// La puerta fija al tutor al estudiar (en la cápsula de arriba; nunca en el simulacro): abre el tutor con lo que se está
// mirando (`usePublishTutorContext`), sin pregunta, y lo vuelve a cerrar. Sin nada publicado no se pinta.
import { useTranslation } from 'react-i18next'
import { AulaMark, IconButton } from '@renderer/design'
import { routeKey, useRoute } from '@renderer/app/router'
import { tutorVisibleFor, useTutor } from './tutorStore'

export function TutorButton({ className }: { className?: string }) {
  const { t } = useTranslation('chat')
  const key = routeKey(useRoute())
  const published = useTutor((s) => s.published)
  const open = useTutor((s) => tutorVisibleFor(s, key))
  if (!published) return null
  const toggle = () => {
    const tutor = useTutor.getState()
    if (open) tutor.close()
    else tutor.show(published, undefined, key)
  }
  return (
    <IconButton label={t('tutorAsk')} size="sm" active={open} aria-pressed={open} className={className} onClick={toggle}>
      <AulaMark size={18} />
    </IconButton>
  )
}

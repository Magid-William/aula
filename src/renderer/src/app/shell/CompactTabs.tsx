// Aula en una pantalla de teléfono (el del estudiante, a distancia): sin barra lateral, con cuatro pestañas abajo. «Hoy» va
// primero y es donde se abre la app: lo que toca estudiar hoy, a un toque de cada curso; luego hablar con Aula, el calendario
// y las novedades (lo que hizo por ti y lo pendiente).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx, Icon, type IconName } from '@renderer/design'
import { navigate, useNav, type Route } from '../router'
import { useInboxCount } from './inboxCount'

/** Pantalla de teléfono: estrecha, o baja y táctil (un teléfono girado; si no, cabría la barra lateral en 360 px de alto). */
export const COMPACT_QUERY = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)'

/** ¿La ventana es de teléfono? (se entera si cambia: girar el dispositivo, partir la pantalla del iPad). */
export function useCompact(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches)
  useEffect(() => {
    const m = window.matchMedia(COMPACT_QUERY)
    const on = (): void => setCompact(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return compact
}

export const TABS: ReadonlyArray<{ route: Route; icon: IconName; label: string }> = [
  { route: { name: 'home' }, icon: 'today', label: 'nav.home' },
  { route: { name: 'chat' }, icon: 'tutor', label: 'nav.chat' },
  { route: { name: 'calendar' }, icon: 'calendar', label: 'nav.calendar' },
  { route: { name: 'inbox' }, icon: 'inbox', label: 'nav.inbox' }
]

export function CompactTabs() {
  const { t } = useTranslation()
  const current = useNav((s) => s.route.name)
  const unread = useInboxCount()
  return (
    // mientras se escribe con el teclado de la pantalla las pestañas se apartan (styles.css: html.kb-open), para dejar sitio
    <nav aria-label="Aula" data-compact-tabs className="shrink-0 border-t-[0.5px] border-line bg-surface" style={{ paddingBottom: 'var(--safe-bottom)' }}>
      <ul className="m-0 flex list-none items-stretch p-0">
        {TABS.map((tab) => {
          const on = current === tab.route.name
          return (
            <li key={tab.route.name} className="flex-1">
              <button
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => navigate(tab.route)}
                className={cx('relative flex h-[56px] w-full flex-col items-center justify-center gap-0.5 outline-none focus-visible:bg-fill1', on ? 'text-accent-text' : 'text-text3')}
              >
                <span className="relative">
                  <Icon name={tab.icon} size={22} />
                  {tab.route.name === 'inbox' && unread > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-accent px-1 text-[10.5px] font-semibold leading-none text-on-accent">{unread > 99 ? '99+' : unread}</span>
                  )}
                </span>
                <span className="text-[10.5px] font-medium leading-none">{t(tab.label)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

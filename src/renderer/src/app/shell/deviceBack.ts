// «Atrás» del sistema en un dispositivo: el gesto o el botón de Android (y el botón atrás del navegador). Aula navega sin
// historial del navegador (la dirección solo se reescribe, routeHash.ts), así que la WebView creía que no había adónde
// volver y Android cerraba la app. Mientras Aula tenga algo que deshacer (una capa abierta encima, una pantalla anterior o,
// en el teléfono, una pestaña que no es «Hoy») deja UNA entrada de guarda en el historial: «atrás» la consume, Aula
// retrocede y, si aún queda adónde volver, la pone otra vez. Sin nada que deshacer no hay guarda y «atrás» sale de la app.
// La app nativa también puede preguntar antes con `window.__aulaBack()` (devuelve si lo atendió).
import { navigate, useNav } from '../router'
import { routeToHash } from '../routeHash'
import { usePalette } from './CommandPalette'
import { backAction, type BackAction } from './backAction'

/** Capas que se cierran con Esc: diálogos y paneles, menús, listas desplegadas. */
const OVERLAY = '[role="dialog"][aria-modal="true"], [role="menu"][data-aula-menu], [role="listbox"][data-aula-select]'

function overlayOpen(): boolean {
  return usePalette.getState().isOpen || document.querySelector(OVERLAY) !== null
}

function current(compact: () => boolean): BackAction {
  const { canBack, route } = useNav.getState()
  return backAction({ overlay: overlayOpen(), canBack, compact: compact(), route: route.name })
}

/** Atiende «atrás» dentro de Aula; `false` si no hay nada que deshacer. */
export function handleDeviceBack(compact: () => boolean): boolean {
  const action = current(compact)
  if (action === 'overlay') {
    if (usePalette.getState().isOpen) usePalette.getState().close()
    else {
      // cada capa ya se cierra con Esc (y solo la de más arriba): se le manda uno
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    }
  } else if (action === 'back') useNav.getState().back()
  else if (action === 'home') navigate({ name: 'home' })
  return action !== null
}

/** Engancha la guarda del historial y `window.__aulaBack` (solo en un dispositivo). Devuelve cómo quitarlo. */
export function installDeviceBack(compact: () => boolean): () => void {
  let guarded = false
  let unwinding = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const here = (): string => routeToHash(useNav.getState().route) || window.location.pathname
  const sync = (): void => {
    timer = null
    const want = current(compact) !== null
    try {
      if (want && !guarded) {
        window.history.pushState(null, '', here())
        guarded = true
      } else if (!want && guarded && !unwinding) {
        // ya no hay nada que deshacer: fuera la guarda, para que el próximo «atrás» salga de la app a la primera
        unwinding = true
        window.history.back()
      }
    } catch {
      /* sin historial: «atrás» sigue como estaba */
    }
  }
  // las capas se abren y se cierran con animación: se mira cuando ya se asentó
  const later = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(sync, 120)
  }
  const onPop = (): void => {
    guarded = false
    if (unwinding) unwinding = false
    else handleDeviceBack(compact)
    try {
      window.history.replaceState(null, '', here())
    } catch {
      /* sin historial */
    }
    later()
  }
  window.addEventListener('popstate', onPop)
  const offNav = useNav.subscribe(later)
  const offPalette = usePalette.subscribe((s, prev) => s.isOpen !== prev.isOpen && later())
  // los diálogos, paneles y menús se pintan en un portal, como hijos directos de <body>
  const portals = new MutationObserver(later)
  portals.observe(document.body, { childList: true })
  const host = window as unknown as { __aulaBack?: () => boolean }
  host.__aulaBack = () => handleDeviceBack(compact)
  later()
  return () => {
    window.removeEventListener('popstate', onPop)
    offNav()
    offPalette()
    portals.disconnect()
    if (timer) clearTimeout(timer)
    delete host.__aulaBack
  }
}

// «Atrás» del sistema en un dispositivo: el gesto o el botón de Android (y el botón atrás del navegador). Aula navega sin
// historial del navegador (la dirección solo se reescribe, routeHash.ts), así que la WebView creía que no había adónde
// volver y Android cerraba la app. Mientras Aula tenga algo que deshacer (una capa abierta encima, una pantalla anterior o,
// en el teléfono, una pestaña que no es «Hoy») deja UNA entrada de guarda en el historial: «atrás» la consume, Aula
// retrocede y, si aún queda adónde volver, la pone otra vez. Sin nada que deshacer no hay guarda y «atrás» sale de la app.
// La app nativa también puede preguntar antes con `window.__aulaBack()` (devuelve si lo atendió) y, para que la página siga
// al dedo al deslizar desde el borde (iPhone), qué haría con `window.__aulaBackKind()` ('overlay', 'back', 'home' o null).
import { hideLive, useLive } from '@renderer/lib/live'
import { navigate, useNav } from '../router'
import { routeToHash } from '../routeHash'
import { usePalette } from './CommandPalette'
import { backAction, type BackAction } from './backAction'

/** Capas que se cierran con Esc: diálogos y paneles, menús, listas desplegadas. */
const OVERLAY = '[role="dialog"][aria-modal="true"], [role="menu"][data-aula-menu], [role="listbox"][data-aula-select]'

/** Cuántas capas hay abiertas encima (el buscador no es un portal, pero también cuenta). */
function overlays(): number {
  return (usePalette.getState().isOpen ? 1 : 0) + document.querySelectorAll(OVERLAY).length
}

/** Una capa que no se cerró con «atrás» (no atiende Esc) no lo atrapa: pasado este rato, se mira lo que hay debajo. */
const SETTLE_MS = 450
let tried: { count: number; at: number } | null = null

function current(compact: () => boolean, skipOverlay = false): BackAction {
  const { canBack, route } = useNav.getState()
  return backAction({ overlay: !skipOverlay && overlays() > 0, canBack, compact: compact(), route: route.name })
}

/** Atiende «atrás» dentro de Aula; `false` si no hay nada que deshacer. */
export function handleDeviceBack(compact: () => boolean): boolean {
  const action = current(compact)
  if (action === 'overlay') {
    tried = { count: overlays(), at: Date.now() }
    if (usePalette.getState().isOpen) usePalette.getState().close()
    // el navegador en vivo se queda con las teclas (Esc iría a su página): se cierra el panel
    else if (useLive.getState().state) hideLive()
    else {
      // cada capa ya se cierra con Esc (y solo la de más arriba): se le manda uno
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    }
  } else if (action === 'back') useNav.getState().back()
  // «Hoy» como raíz: el siguiente «atrás» ya sale de la app
  else if (action === 'home') navigate({ name: 'home' }, { root: true })
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
    // ¿la capa que se intentó cerrar sigue ahí, ya asentada? entonces no cuenta (si no, «atrás» no saldría nunca)
    const settled = tried !== null && Date.now() - tried.at >= SETTLE_MS
    const stuck = settled && tried !== null && overlays() >= tried.count
    if (settled) tried = null
    const want = current(compact, stuck) !== null
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
    setTimeout(later, SETTLE_MS)
  }
  window.addEventListener('popstate', onPop)
  const offNav = useNav.subscribe(later)
  const offPalette = usePalette.subscribe((s, prev) => s.isOpen !== prev.isOpen && later())
  const offLive = useLive.subscribe((s, prev) => !s.state !== !prev.state && later())
  // los diálogos, paneles y menús se pintan en un portal, como hijos directos de <body>
  const portals = new MutationObserver(later)
  portals.observe(document.body, { childList: true })
  const host = window as unknown as { __aulaBack?: () => boolean; __aulaBackKind?: () => BackAction }
  host.__aulaBack = () => handleDeviceBack(compact)
  host.__aulaBackKind = () => current(compact)
  later()
  return () => {
    window.removeEventListener('popstate', onPop)
    offNav()
    offPalette()
    offLive()
    portals.disconnect()
    if (timer) clearTimeout(timer)
    delete host.__aulaBack
    delete host.__aulaBackKind
  }
}

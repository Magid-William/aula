// El teclado de la pantalla (teléfono, tableta). En iOS tapa la parte de abajo sin cambiar el tamaño de la página; en
// Android la WebView encoge. Se publica en la raíz:
//  - `--kb`: cuánto tapa el teclado de la página (px; 0 si la página ya encogió), para medir capas y diálogos;
//  - `html.kb-open`: el teclado está abierto (para quitar de en medio las pestañas de abajo mientras se escribe).
// La app nativa puede avisar ella misma con la clase `ime-open` en la raíz; también cuenta.

/** Lo que hay que encoger la altura para decir que el teclado está abierto (una barra de dirección es menos). */
const OPEN_PX = 150

const editing = (): boolean => {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement) return !el.readOnly
  if (el instanceof HTMLInputElement) return !el.readOnly && !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'].includes(el.type)
  return false
}

/** ¿Teclado abierto? `base`: la altura de la ventana sin teclado; `visible`: lo que se ve ahora. */
export function keyboardOpen(base: number, visible: number, typing: boolean): boolean {
  return typing && base - visible > OPEN_PX
}

/** Empieza a vigilar el teclado; devuelve cómo parar. */
export function installKeyboardWatch(): () => void {
  const root = document.documentElement
  const vv = window.visualViewport
  let width = window.innerWidth
  let base = window.innerHeight
  let frame = 0
  const update = (): void => {
    frame = 0
    // al girar o partir la pantalla cambia el ancho: la altura de referencia vuelve a empezar
    if (window.innerWidth !== width) {
      width = window.innerWidth
      base = window.innerHeight
    }
    const typing = editing()
    if (!typing) base = Math.max(base, window.innerHeight)
    const visible = vv ? vv.height : window.innerHeight
    const covered = vv ? Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height)) : 0
    const open = keyboardOpen(base, visible, typing) || root.classList.contains('ime-open')
    root.style.setProperty('--kb', `${covered}px`)
    root.classList.toggle('kb-open', open)
  }
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  // el foco cambia antes de que el teclado acabe de subir o bajar: se mira otra vez un poco después
  const onFocus = (): void => {
    schedule()
    setTimeout(schedule, 350)
  }
  vv?.addEventListener('resize', schedule)
  vv?.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  document.addEventListener('focusin', onFocus)
  document.addEventListener('focusout', onFocus)
  update()
  return () => {
    vv?.removeEventListener('resize', schedule)
    vv?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('focusout', onFocus)
    if (frame) cancelAnimationFrame(frame)
    root.classList.remove('kb-open')
    root.style.removeProperty('--kb')
  }
}

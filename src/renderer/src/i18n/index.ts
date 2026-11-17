// i18n de la interfaz: es (base) y en. Cada pantalla tiene su espacio de nombres en locales/<idioma>/<espacio>.json.
// Variantes por dispositivo: en un teléfono o una tableta, una clave `<clave>_device` sustituye a `<clave>` (lo que
// depende de la ventana del Mac) y, si se maneja con el dedo, `<clave>_touch` también (sin «haz clic», «pasa el ratón»,
// teclas ni rueda). Es el mismo sufijo que el «contexto» de i18next: `t(clave, { context: 'touch' })` también vale.
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { isTouchOnly } from '@renderer/design/input'

const files = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<string, { default: Record<string, unknown> }>
const resources: Record<string, Record<string, Record<string, unknown>>> = {}
for (const [path, mod] of Object.entries(files)) {
  const m = /\.\/locales\/([\w-]+)\/([\w-]+)\.json$/.exec(path)
  if (!m) continue
  const [, lang, ns] = m
  ;(resources[lang] ??= {})[ns] = mod.default
}

/** Cambia en el árbol de textos cada `<clave>` que tenga variante `<clave><sufijo>` por esa variante. */
export function applyVariants(node: Record<string, unknown>, suffix: string): void {
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) applyVariants(v as Record<string, unknown>, suffix)
    else if (typeof v === 'string' && k.endsWith(suffix) && k.length > suffix.length) node[k.slice(0, -suffix.length)] = v
  }
}

const device = typeof window !== 'undefined' && (window.aula as { remote?: boolean } | undefined)?.remote === true
const touch = isTouchOnly()
if (device || touch) {
  for (const lang of Object.keys(resources)) {
    for (const ns of Object.keys(resources[lang])) {
      const copy = structuredClone(resources[lang][ns])
      if (device) applyVariants(copy, '_device')
      if (touch) applyVariants(copy, '_touch')
      resources[lang][ns] = copy
    }
  }
}

export const SUPPORTED = ['es', 'en'] as const
export type UILang = (typeof SUPPORTED)[number]

export function pickLanguage(pref: string | undefined, system: string): UILang {
  if (pref === 'es' || pref === 'en') return pref
  const s = (system || 'en').toLowerCase()
  return s.startsWith('es') ? 'es' : 'en'
}

void i18n.use(initReactI18next).init({
  resources,
  lng: pickLanguage(undefined, navigator.language),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: Object.keys(resources.es ?? {}),
  interpolation: { escapeValue: false },
  returnNull: false
})

export function setLanguage(lang: UILang): void {
  if (i18n.language !== lang) void i18n.changeLanguage(lang)
  document.documentElement.lang = lang
}

export default i18n

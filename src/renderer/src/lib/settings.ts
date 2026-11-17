// Ajustes en la interfaz: copia viva de settings.json (se actualiza con el evento 'settings.changed').
import { create } from 'zustand'
import type { AppSettings, SettingsPatch } from '@shared/settings'
import { api, isAulaError } from './api'

interface SettingsState {
  settings: AppSettings | null
  load: () => Promise<void>
  update: (patch: SettingsPatch) => Promise<void>
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,
  load: async () => {
    const s = await api.invoke('settings.get')
    set({ settings: s })
  },
  update: async (patch) => {
    try {
      const s = await api.invoke('settings.update', patch)
      set({ settings: s })
    } catch (err) {
      // la demostración de las apps (sin Mac) no guarda nada: el cambio (tema, tamaño del texto…) vale para esta visita
      if (!isAulaError(err) || err.code !== 'demo') throw err
      set((st) => ({ settings: st.settings ? mergePatch(st.settings, patch) : st.settings }))
    }
  }
}))

/** Un cambio parcial de ajustes sobre los de ahora (objetos anidados se mezclan; lo demás se reemplaza). */
export function mergePatch<T>(base: T, patch: unknown): T {
  const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!plain(base) || !plain(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? base[k] : mergePatch(base[k], v)
  return out as T
}

let wired = false
export function wireSettings(): void {
  if (wired) return
  wired = true
  api.on('settings.changed', (s) => useSettings.setState({ settings: s }))
  void useSettings.getState().load()
}

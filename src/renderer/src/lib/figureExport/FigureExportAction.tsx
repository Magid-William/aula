import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FigureSvg } from '@shared/figures'
import { Icon, IconButton, Menu, Spinner, toast } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { figurePng } from './png'

/** Acción común: la figura aporta una instantánea, no rutas ni datos ocultos del bloque. */
export function FigureExportAction({ capture, kind }: { capture: (signal: AbortSignal) => Promise<FigureSvg>; kind: string }) {
  const { t } = useTranslation('visual')
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const save = async (format: 'svg' | 'png'): Promise<void> => {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      const svg = await capture(controller.signal)
      const request = format === 'svg'
        ? { format, suggestedName: kind, svg }
        : { format, suggestedName: kind, data: await figurePng(svg, controller.signal) }
      if (controller.signal.aborted) return
      const result = await api.invoke('figures.save', request)
      if (result && !controller.signal.aborted) toast.success(t('figureExport.saved'))
    } catch {
      if (!controller.signal.aborted) toast.error(t('figureExport.failed'))
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  // El guardado nativo pertenece al equipo que muestra la figura, nunca al servidor de una sesión remota.
  if (api.remote) return null
  return (
    <span className="inline-flex print:hidden" data-figure-export={kind} aria-busy={busy}>
      <Menu
        trigger={(open, expanded) => <IconButton size="sm" label={t(busy ? 'figureExport.saving' : 'figureExport.label')}
          // No se deshabilita nativamente: perdería el foco al cancelar el diálogo. Tab sigue libre durante la captura.
          aria-disabled={busy} className="aria-disabled:opacity-35" aria-haspopup="menu" aria-expanded={expanded}
          onClick={() => { if (!pending.current) open() }}
          onKeyDown={(event) => {
            // Menu escucha estas teclas en su contenedor; tampoco debe abrirse mientras se guarda.
            if (pending.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}>
          {busy ? <Spinner size={14} /> : <Icon name="download" size={15} />}
        </IconButton>}
        items={(['svg', 'png'] as const).map((format) => ({ label: t(`figureExport.${format}`), disabled: busy, onSelect: () => void save(format) }))}
      />
      <span className="sr-only" role="status">{busy ? t('figureExport.saving') : ''}</span>
    </span>
  )
}

// Soltar archivos sobre la ventana (Documentos y los Materiales del curso, igual en las dos): mientras pasan por encima, una
// capa de papel cubre la pantalla con la hoja pixel encendida y qué pasará al soltarlos; al soltarlos, se añaden. Solo en la
// pantalla de delante.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useScreenActive } from '@renderer/app/router'
import { api } from '@renderer/lib/api'
import { PaperSprite } from './PaperSprite'

/** Archivos arrastrados sobre la ventana: `true` mientras pasan por encima; al soltarlos, `onFiles`. */
export function useFileDrop(onFiles: (files: FileList | null) => void): boolean {
  const active = useScreenActive()
  const [over, setOver] = useState(false)
  const handler = useRef(onFiles)
  handler.current = onFiles
  useEffect(() => {
    if (!active) return
    let timer = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    // mientras se arrastra por encima llegan «dragover» seguidos: si dejan de llegar (salió de la ventana), se quita la capa
    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setOver(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setOver(false), 250)
    }
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      window.clearTimeout(timer)
      setOver(false)
      handler.current(e.dataTransfer?.files ?? null)
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      setOver(false)
    }
  }, [active])
  return over
}

/** Las rutas de los archivos soltados o elegidos (los que no se pueden leer se quedan fuera). */
export function filePaths(files: FileList | null): string[] {
  return [...(files ?? [])]
    .map((f) => {
      try {
        return api.pathForFile(f)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
}

/** La capa que cubre la ventana mientras se arrastran archivos: la hoja encendida, lo que pasará y, debajo, qué se puede soltar. */
export function FileDropOverlay({ show, title, body }: { show: boolean; title: string; body?: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: 'color-mix(in oklab, var(--paper) 86%, transparent)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="grid h-full w-full place-items-center rounded-[28px] border-2 border-dashed border-accent-line">
            <div className="flex max-w-[440px] flex-col items-center gap-3 text-center">
              <PaperSprite lit size={48} />
              <span className="t-title2 text-text text-balance">{title}</span>
              {body && <span className="t-callout text-text2 text-pretty">{body}</span>}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// La superficie única del código: cabecera con el lenguaje y el botón de copiar, el texto resaltado, los números de línea y la
// salida del programa. La usan el bloque `code` de las lecciones y el código escrito dentro de Markdown (chat, enunciados,
// soluciones, documentos), para que un listado se vea igual en todas partes.
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx, Icon, IconButton, toast } from '@renderer/design'
import { highlightCode } from './code'

export interface CodeSurfaceProps {
  code: string
  language?: string
  /** Lo que imprime el programa, tal cual. */
  output?: string
  /** Texto corrido y chat: 12,5 px, sin números de línea. */
  compact?: boolean
  /** Sin botón de copiar (impresión y exportación). */
  copyable?: boolean
  /** Mientras el texto llega en vivo: sin resaltar (se reharía en cada carácter). */
  streaming?: boolean
  onCopy?: () => void
  className?: string
}

export const CodeSurface = memo(function CodeSurface({ code, language, output, compact = false, copyable = true, streaming = false, onCopy, className }: CodeSurfaceProps) {
  const { t } = useTranslation('blocks')
  const [copied, setCopied] = useState(false)
  const clean = code.replace(/\s+$/, '')
  const { html, label } = useMemo(() => highlightCode(clean, language, streaming), [clean, language, streaming])
  const lines = useMemo(() => clean.split('\n').length, [clean])
  const numbered = lines > 3 && !compact
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      onCopy?.()
      setTimeout(() => setCopied(false), 1400)
    } catch {
      toast.error(t('code.copyFailed'))
    }
  }
  return (
    <div className={cx('overflow-hidden border-[0.5px] border-line bg-sunken', compact ? 'rounded-[12px]' : 'rounded-[16px]', className)}>
      <div className="flex h-9 items-center gap-2 border-b-[0.5px] border-line-soft pl-4 pr-1.5">
        <Icon name="code" size={14} className="text-text3" />
        <span className="t-caption uppercase tracking-[0.6px] text-text3">{label || t('code.code')}</span>
        {copyable && (
          <IconButton label={copied ? t('code.copied') : t('code.copy')} size="sm" onClick={() => void copy()} className={cx('ml-auto print:hidden', copied && 'text-success')}>
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </IconButton>
        )}
      </div>
      <div className="overflow-x-auto">
        <pre className={cx('blk-code m-0 flex t-mono text-text', compact ? 'px-3 py-2.5 text-[12.5px] leading-[19px]' : 'px-4 py-3.5 text-[13px] leading-[21px]')}>
          {numbered && (
            <span aria-hidden className="mr-4 select-none text-right text-text3/70 tabular">
              {Array.from({ length: lines }, (_, i) => (
                <span key={i} className="block">{i + 1}</span>
              ))}
            </span>
          )}
          <code className="block min-w-0 flex-1 whitespace-pre" dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
      {output?.trim() && (
        <div className="border-t-[0.5px] border-line-soft bg-surface/60 px-4 py-3">
          <div className="t-caption mb-1 flex items-center gap-1.5 uppercase tracking-[0.6px] text-text3">
            <Icon name="terminal" size={12} />
            {t('code.output')}
          </div>
          <pre className="m-0 whitespace-pre-wrap t-mono text-[12.5px] leading-[19px] text-text2">{output.replace(/\s+$/, '')}</pre>
        </div>
      )}
    </div>
  )
})

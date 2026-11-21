// Bloque `code` de la lección: la superficie común de código (resaltado, copiar, números de línea y salida) más su pie.
import type { BlockOf } from '@shared/schema/blocks'
import { CodeSurface } from '@renderer/lib/CodeSurface'
import type { BlockProps } from './types'
import { Caption } from './shared'

export function CodeBlockView({ block, ctx }: BlockProps<BlockOf<'code'>>) {
  const chat = ctx.mode === 'chat'
  return (
    <div>
      <CodeSurface
        code={block.code}
        language={block.language}
        output={block.output}
        compact={chat}
        copyable={ctx.mode !== 'print'}
        onCopy={() => ctx.onInteract?.(block.id, 'code.copy')}
      />
      <Caption text={block.caption} className="mt-2 px-1" />
    </div>
  )
}

// La loseta de una herramienta: dibujada a mano, en tinta sobre papel (un solo estilo de dibujo: sin pasteles por
// herramienta ni color al pasar el ratón). La herramienta se reconoce por su glifo y su nombre.
import { DrawnTile, useTheme } from '@renderer/design'
import type { ToolDef } from './registry'

export function ToolTile({ tool, size = 48 }: { tool: ToolDef; size?: number }) {
  const { dark } = useTheme()
  const Icon = tool.icon
  return (
    <DrawnTile seed={`herramienta:${tool.id}`} size={size} radius={Math.round(size * 0.29)} fill="var(--paper)" ink="var(--ink)" inkAlpha={dark ? 0.55 : 0.6}>
      <span className="relative grid h-full w-full place-items-center text-[var(--ink)]">
        <Icon size={Math.round(size * 0.46)} strokeWidth={1.6} />
      </span>
    </DrawnTile>
  )
}

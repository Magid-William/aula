// Herramientas: la galería es un cajón a dos columnas (la loseta a tinta, el nombre en serif y una línea de qué hace, con
// filetes entre filas). Las fijadas van aparte, en su grupo, arriba; la chincheta de las que se pueden fijar sale al pasar por
// encima (fija, solo en las fijadas; con el dedo, siempre). Al abrir una, ocupa toda la pantalla (y se puede fijar flotante;
// en el teléfono no hay herramientas flotantes, así que tampoco chinchetas).
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { Spinner, cx, enter } from '@renderer/design'
import { useRoute, navigate, useNav } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { useCompact } from '@renderer/app/shell/CompactTabs'
import { TOOLS, pinnedGroups, toolById, type ToolDef } from '@renderer/tools/registry'
import { PinToolButton, usePinnedTools } from '@renderer/tools/floating'
import { ToolTile } from '@renderer/tools/ToolTile'

export default function ToolsScreen() {
  const { t } = useTranslation('tools')
  const route = useRoute()
  const toolId = route.name === 'tools' ? route.tool : undefined
  const tool = toolById(toolId)
  const compact = useCompact()
  const canBack = useNav((s) => s.canBack)
  useScreenTitle(tool ? t(`${tool.id}.name`) : t('title'), tool?.floating && !compact ? <PinToolButton id={tool.id} onPinned={() => navigate({ name: 'tools' })} /> : null, [tool?.id, compact])

  // sus comandos de ⌘K los registra el armazón (app/shell/commands.tsx), no esta pantalla

  if (tool) {
    const Comp = tool.component
    // en el teléfono, la que lo pide ocupa la pantalla sin desplazarse (la calculadora: visor y teclas a la vez)
    const fill = compact && !!tool.phoneFill
    return (
      <div className={cx('@container flex-1 min-h-0', fill ? 'flex flex-col px-4 pb-3' : 'overflow-y-auto px-6 pb-24')}>
        {/* en el teléfono la barra de arriba ya trae «atrás» */}
        {!(compact && canBack) && (
          <button className="relative touch-target mb-3 inline-flex shrink-0 items-center gap-1.5 self-start t-ui font-medium text-text2 hover:text-text" onClick={() => navigate({ name: 'tools' })}>
            <ArrowLeft size={15} /> {t('back')}
          </button>
        )}
        <Suspense fallback={<div className="grid place-items-center h-80"><Spinner size={22} /></div>}>
          <Comp phone={fill} />
        </Suspense>
      </div>
    )
  }

  return <Gallery />
}

/** La galería: el título visible es el de la barra de arriba (aquí, solo para lectores de pantalla). */
function Gallery() {
  const { t } = useTranslation('tools')
  const compact = useCompact()
  // las fijadas, en su grupo y en el orden de al llegar (fijar una no la hace saltar bajo el ratón)
  const [{ pinned, rest }] = useState(() => pinnedGroups(TOOLS, usePinnedTools.getState().pinned))
  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-24">
      <div className="mx-auto max-w-[1080px]">
        <h1 className="sr-only">{t('title')}</h1>
        <p className="t-callout text-text2 max-w-[640px] text-pretty">{t('subtitle', { context: compact ? 'phone' : undefined })}</p>
        {pinned.length > 0 && <ToolGroup label={t('pinnedGroup')} tools={pinned} className="mt-7" />}
        <ToolGroup label={pinned.length > 0 ? t('allGroup') : undefined} tools={rest} className={pinned.length > 0 ? 'mt-8' : 'mt-6'} />
      </div>
    </div>
  )
}

/** Un grupo del cajón: su nombre (si hay más de uno) y las filas a dos columnas, con filetes. */
function ToolGroup({ label, tools, className }: { label?: string; tools: ToolDef[]; className?: string }) {
  return (
    <section className={className}>
      {label && <h2 className="mb-2 t-footnote font-semibold text-text2">{label}</h2>}
      <motion.ul
        className="grid grid-cols-1 gap-x-10 border-t border-rule @3xl:grid-cols-2"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
      >
        {tools.map((x) => <ToolRow key={x.id} tool={x} />)}
      </motion.ul>
    </section>
  )
}

/** Una herramienta del cajón: la fila entera la abre (Intro o Espacio) y, si puede flotar, su chincheta va al lado (a la vista
 *  al pasar por encima o al enfocarla; siempre, si ya está fijada). */
function ToolRow({ tool }: { tool: ToolDef }) {
  const { t } = useTranslation('tools')
  const pinned = usePinnedTools((s) => s.pinned.includes(tool.id))
  const compact = useCompact()
  return (
    <motion.li variants={enter} className="group/tool flex items-center gap-1 border-b border-rule py-1.5">
      <button type="button" onClick={() => navigate({ name: 'tools', tool: tool.id })} className="-ml-2.5 flex min-w-0 flex-1 items-center gap-4 rounded-[14px] px-2.5 py-2.5 text-left transition-colors hover:bg-fill1">
        <ToolTile tool={tool} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-[calc(18rem/15)] leading-[calc(23rem/15)] font-medium tracking-[-0.1px] text-text">{t(`${tool.id}.name`)}</span>
          <span className="block t-callout text-text2">{t(`${tool.id}.desc`)}</span>
        </span>
      </button>
      {tool.floating && !compact && (
        <span className={cx('transition-opacity', !pinned && 'opacity-0 group-hover/tool:opacity-100 focus-within:opacity-100 touch:opacity-100')}>
          <PinToolButton id={tool.id} look="icon" />
        </span>
      )}
    </motion.li>
  )
}

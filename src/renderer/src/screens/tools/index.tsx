// Herramientas: la galería es un cajón a dos columnas (la loseta a tinta, el nombre en serif y una línea de qué hace, con
// filetes entre filas y las fijadas arriba); al abrir una, ocupa toda la pantalla (y se puede fijar flotante).
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { Spinner, enter } from '@renderer/design'
import { useRoute, navigate } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { TOOLS, pinnedFirst, toolById, type ToolDef } from '@renderer/tools/registry'
import { PinToolButton, usePinnedTools } from '@renderer/tools/floating'
import { ToolTile } from '@renderer/tools/ToolTile'

export default function ToolsScreen() {
  const { t } = useTranslation('tools')
  const route = useRoute()
  const toolId = route.name === 'tools' ? route.tool : undefined
  const tool = toolById(toolId)
  useScreenTitle(tool ? t(`${tool.id}.name`) : t('title'), tool?.floating ? <PinToolButton id={tool.id} onPinned={() => navigate({ name: 'tools' })} /> : null, [tool?.id])

  // sus comandos de ⌘K los registra el armazón (app/shell/commands.tsx), no esta pantalla

  if (tool) {
    const Comp = tool.component
    return (
      <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pb-24">
        <button className="mb-3 inline-flex items-center gap-1.5 t-ui font-medium text-text2 hover:text-text" onClick={() => navigate({ name: 'tools' })}>
          <ArrowLeft size={15} /> {t('back')}
        </button>
        <Suspense fallback={<div className="grid place-items-center h-80"><Spinner size={22} /></div>}>
          <Comp />
        </Suspense>
      </div>
    )
  }

  return <Gallery />
}

/** La galería: el título visible es el de la barra de arriba (aquí, solo para lectores de pantalla). */
function Gallery() {
  const { t } = useTranslation('tools')
  // las fijadas arriba, en el orden de al llegar (fijar una no la hace saltar bajo el ratón)
  const [order] = useState(() => pinnedFirst(TOOLS, usePinnedTools.getState().pinned))
  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-24">
      <div className="mx-auto max-w-[1080px]">
        <h1 className="sr-only">{t('title')}</h1>
        <p className="t-body text-text2 max-w-[640px]">{t('subtitle')}</p>
        <motion.ul
          className="mt-5 grid grid-cols-1 gap-x-10 border-t border-rule @3xl:grid-cols-2"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
        >
          {order.map((x) => <ToolRow key={x.id} tool={x} />)}
        </motion.ul>
      </div>
    </div>
  )
}

/** Una herramienta del cajón: la fila entera la abre (Intro o Espacio) y, si puede flotar, su chincheta va al lado. */
function ToolRow({ tool }: { tool: ToolDef }) {
  const { t } = useTranslation('tools')
  return (
    <motion.li variants={enter} className="flex items-center gap-1 border-b border-rule py-1.5">
      <button type="button" onClick={() => navigate({ name: 'tools', tool: tool.id })} className="-ml-2.5 flex min-w-0 flex-1 items-center gap-4 rounded-[14px] px-2.5 py-2.5 text-left transition-colors hover:bg-fill1">
        <ToolTile tool={tool} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-[calc(18rem/15)] leading-[calc(23rem/15)] font-medium tracking-[-0.1px] text-text">{t(`${tool.id}.name`)}</span>
          <span className="block t-callout text-text2">{t(`${tool.id}.desc`)}</span>
        </span>
      </button>
      {tool.floating && <PinToolButton id={tool.id} look="icon" />}
    </motion.li>
  )
}

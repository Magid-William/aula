// Sugerencias para empezar (el chat vacío, el tutor vacío): una lista de frases con filetes, no chips. Al pasar el ratón o con
// el foco, la frase se enciende en ladrillo y asoma una flecha; el foco lleva además el anillo de toda la app (--focus), con
// un poco de aire a los lados para que no roce el texto (el texto sigue alineado con los filetes).
import { motion } from 'motion/react'
import { Icon, cx } from '@renderer/design'

export function IdeaList({ ideas, onPick, label, className }: { ideas: string[]; onPick: (idea: string) => void; label?: string; className?: string }) {
  if (!ideas.length) return null
  return (
    <ul className={cx('m-0 list-none border-t border-rule p-0', className)} aria-label={label}>
      {ideas.map((s, i) => (
        <motion.li key={s} className="border-b border-line-soft" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05 }}>
          <button type="button" onClick={() => onPick(s)} className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-[6px] px-2 py-3 text-left">
            <span className="min-w-0 flex-1 t-body text-text transition-colors group-hover:text-accent-text group-focus-visible:text-accent-text">{s}</span>
            <Icon name="arrow-right" size={15} className="shrink-0 -translate-x-1 text-text3 opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
          </button>
        </motion.li>
      ))}
    </ul>
  )
}

// Cabecera del curso, compacta: su icono pixel-art se enciende píxel a píxel sobre una losa dibujada a mano, el título en
// serif en una línea y, debajo, una sola línea de datos (asignatura, código, el examen y lo que tiene el curso). A la
// derecha, «Estudiar ahora» (solo en el Resumen: una sola acción en ladrillo por vista) y el menú «⋯», que también pide
// cambios a Aula. En una columna estrecha (un teléfono) se reparte en filas: icono, título (hasta dos líneas) y «⋯»; los
// datos debajo, a todo el ancho; y «Estudiar ahora», un botón ancho al final.
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, DrawnTile, Icon, IconButton, Menu, PixelIcon, cx, toneForHue, useTheme } from '@renderer/design'
import type { Pack } from '@shared/schema/pack'
import { daysUntil, fmtDate, fmtTime } from '@renderer/lib/format'
import { navigate, type CourseView } from '@renderer/app/router'
import { CourseActions, COURSE_EDIT_EVENT, type CourseAction } from './Actions'
import { RequestChangesDialog } from './RequestChanges'
import { SampleTag, showsAsSample } from '@renderer/lib/sample'
import { api } from '@renderer/lib/api'
import { canFrom } from '@renderer/lib/device'

export function CourseHeader({ pack, view }: { pack: Pack; view: CourseView }) {
  const { t } = useTranslation(['course', 'common'])
  const [action, setAction] = useState<CourseAction>(null)
  const [changes, setChanges] = useState(false)
  const { dark } = useTheme()
  const tone = toneForHue(pack.hue)
  // «Añadir fecha de examen» desde el resumen abre el mismo diálogo de editar
  useEffect(() => {
    const open = () => setAction('edit')
    window.addEventListener(COURSE_EDIT_EVENT, open)
    return () => window.removeEventListener(COURSE_EDIT_EVENT, open)
  }, [])
  const facts = useCourseFacts(pack)
  return (
    // estrecha: una rejilla con sus zonas (el texto y las acciones se deshacen en ella con `contents`); ancha, una fila
    <div className={cx('flex items-center gap-4', view === 'overview' ? NARROW_GRID_CTA : NARROW_GRID)}>
      {/* el icono, sobre una losa dibujada a mano: relleno plano del tono y su contorno de tinta, algo fuera de registro */}
      <motion.div className="shrink-0 @max-xl:[grid-area:icon]" whileHover={{ y: -1.5 }} transition={{ type: 'spring', stiffness: 439, damping: 20 }}>
        <DrawnTile seed={pack.id} size={56} radius={17} fill={`color-mix(in oklab, ${dark ? tone.fillDark : tone.fillLight} ${dark ? 24 : 16}%, var(--paper))`} ink={dark ? tone.inkDark : tone.inkLight} inkAlpha={dark ? 0.8 : 0.75}>
          <PixelIcon icon={pack.icon} hue={pack.hue} size={36} title={pack.title} animation="dissolve" celebrate />
        </DrawnTile>
      </motion.div>
      <div className="min-w-0 flex-1 @max-xl:contents">
        <motion.h1 className="t-title1 truncate @max-xl:[grid-area:title] @max-xl:line-clamp-2 @max-xl:whitespace-normal @max-xl:[overflow-wrap:anywhere]" title={pack.title} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
          {pack.title}
        </motion.h1>
        {/* cada dato lleva su «·» delante, en su margen: la línea se corre ese margen a la izquierda y lo recorta, así que el
            punto del primero de cada línea no se ve. Al partirse, ninguna línea empieza ni acaba en «·» */}
        <div className="t-callout text-text2 mt-0.5 -ml-4 flex flex-wrap items-center gap-y-0.5 [clip-path:inset(0_0_0_1rem)] @max-xl:mt-0 @max-xl:[grid-area:facts]">
          {/* un curso de ejemplo lo dice (A4-P1-1) */}
          {showsAsSample(pack.id) && <span className="inline-flex pl-4"><SampleTag /></span>}
          {facts.map((f, i) => (
            <span key={i} className={cx('relative pl-4', i > 0 && "before:absolute before:left-0 before:w-4 before:text-center before:text-text3 before:content-['·']")}>
              {f}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 @max-xl:contents">
        {view === 'overview' && (
          <Button variant="primary" size="lg" className="@max-xl:mt-1 @max-xl:w-full @max-xl:[grid-area:cta]" onClick={() => navigate({ name: 'study', id: pack.id, mode: 'plan', start: true })}>
            {t('studyNow')}
          </Button>
        )}
        <span className="inline-flex @max-xl:self-start @max-xl:[grid-area:menu]">
        <Menu
          trigger={(open) => (
            <IconButton label={t('common:actions.more')} variant="filled" onClick={open}>
              <Icon name="more" size={16} />
            </IconButton>
          )}
          items={[
            { label: t('common:actions.edit'), icon: <Icon name="edit" size={15} />, onSelect: () => setAction('edit') },
            { label: t('refineMenu'), icon: <Icon name="refine" size={15} />, onSelect: () => setChanges(true) },
            // exportar y eliminar, solo donde se puede (un dispositivo los tiene negados: remote/policy.ts)
            ...(canFrom(api.role, 'courses.export') ? [{ label: t('export'), icon: <Icon name="share" size={15} />, onSelect: () => setAction('export') }] : []),
            { label: t('history.title'), icon: <Icon name="history" size={15} />, onSelect: () => setAction('history') },
            ...(canFrom(api.role, 'courses.delete') ? [{ label: t('common:actions.delete'), icon: <Icon name="trash" size={15} />, danger: true, separatorBefore: true, onSelect: () => setAction('delete') }] : [])
          ]}
        />
        </span>
        <CourseActions pack={pack} action={action} onClose={() => setAction(null)} />
        <RequestChangesDialog pack={pack} open={changes} onClose={() => setChanges(false)} />
      </div>
    </div>
  )
}

/** Las zonas de la cabecera en una columna estrecha: icono, título y «⋯»; los datos; y, en el Resumen, «Estudiar ahora». */
const NARROW = '@max-xl:grid @max-xl:grid-cols-[auto_minmax(0,1fr)_auto] @max-xl:gap-x-3 @max-xl:gap-y-2.5'
const NARROW_GRID = `${NARROW} @max-xl:[grid-template-areas:'icon_title_menu'_'facts_facts_facts']`
const NARROW_GRID_CTA = `${NARROW} @max-xl:[grid-template-areas:'icon_title_menu'_'facts_facts_facts'_'cta_cta_cta']`

/** La línea de datos: asignatura, código, el examen (en ladrillo si faltan tres días o menos) y lo que tiene el curso. */
function useCourseFacts(pack: Pack): ReactNode[] {
  const { t } = useTranslation(['course', 'run'])
  const counts = pack.skills.reduce((a, s) => ({ ex: a.ex + (s.counts?.exercises ?? 0) + (s.counts?.templates ?? 0), cards: a.cards + (s.counts?.cards ?? 0) }), { ex: 0, cards: 0 })
  const facts: ReactNode[] = [pack.subject, pack.courseCode].filter((x): x is string => !!x)
  const date = pack.exam?.date
  const days = date ? daysUntil(date) : null
  if (date && days != null && days >= 0) {
    const day = fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
    const text = days === 0 ? t('examLineToday', { time: fmtTime(date) }) : days === 1 ? t('examLineTomorrow', { date: day }) : t('examLine', { date: day, count: days })
    facts.push(<span className={days <= 3 ? 'text-accent-text' : undefined}>{text}</span>)
  }
  facts.push(t('run:summary.topics', { count: pack.skills.length }))
  if (counts.ex) facts.push(t('run:summary.exercises', { count: counts.ex }))
  if (counts.cards) facts.push(t('run:summary.cards', { count: counts.cards }))
  return facts
}

// Tarjeta principal de Hoy: la fecha, el saludo en serif subrayado a pincel, una frase con lo que toca, la racha en una línea
// y la acción principal (la única en ladrillo de la pantalla) con la meta del día al lado. A la derecha, el arco de Aula con
// la luz de la hora que es (tinta y acuarela). Sin ceros: antes de estudiar se dice la meta; después, cuánto llevas.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, Card, Chip, Icon, BrushUnderline, ArchLight, archLightFor } from '@renderer/design'
import type { HomeSummary } from '@shared/ipc/home'
import { capitalize, fmtDate } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { StreakLine } from './Streak'

function greetingKey(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 20 ? 'afternoon' : 'evening'
}

/** Lo que dice el saludo y adónde lleva su botón: sin cursos, crear uno; con solo cursos de ejemplo, crear el tuyo (o probar
 *  el ejemplo); con cursos, la sesión guiada del plan de hoy. */
export type HeroMode = 'empty' | 'firstRun' | 'study'

export function Hero({ data, mode }: { data: HomeSummary; mode: HeroMode }) {
  const { t } = useTranslation(['home', 'common'])
  const g = t(`common:greeting.${greetingKey()}`)
  const pending = data.plan.filter((p) => !p.done)
  const minutes = pending.reduce((a, p) => a + p.minutes, 0)
  // el curso por el que empieza la sesión: el del primer paso pendiente (o el primero de la lista)
  const courseId = pending[0]?.courseId ?? data.plan[0]?.courseId ?? data.courses[0]?.id
  const startPlan = () => courseId && navigate({ name: 'study', id: courseId, mode: 'plan', start: true })
  const scene = archLightFor(new Date().getHours())
  const subtitle = mode === 'empty' ? t('subtitleEmpty') : mode === 'firstRun' ? t('firstRun.subtitle') : pending.length ? t('subtitle', { count: pending.length, minutes }) : t('subtitleDone')

  return (
    <Card enterAnim padded={false} className="relative h-full min-h-[280px] overflow-hidden">
      <div className="relative grid h-full grid-cols-1 @3xl:grid-cols-[1fr_auto] gap-6 p-7 @3xl:p-8">
        <div className="flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="t-eyebrow">{capitalize(fmtDate(new Date()))}</span>
              {/* en pantallas estrechas (el teléfono), el arco en pequeño a la derecha de la fecha: en su sitio, sin tapar nada */}
              <ArchLight scene={scene} className="@3xl:hidden ml-auto -my-1 -mr-1 h-[60px] w-[72px]" />
            </div>
            <motion.h1 className="t-display mt-2.5 text-text" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05 }}>
              {/* el saludo, subrayado a pincel: lo primero que se lee del día */}
              <BrushUnderline seed="greeting" delay={550}>{data.name ? t('common:greeting.withName', { greeting: g, name: data.name }) : g}</BrushUnderline>
            </motion.h1>
            <p className="t-body text-text2 mt-3 max-w-[540px] text-pretty">{subtitle}</p>
            {mode === 'study' && <StreakLine streak={data.streak} />}
          </div>
          <div className="mt-6">
            {mode === 'empty' ? (
              <>
                <Button variant="primary" size="lg" icon={<Icon name="create" size={16} />} onClick={() => navigate({ name: 'create' })}>
                  {t('createFirst')}
                </Button>
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {(['chem', 'english', 'calc', 'history'] as const).map((k) => (
                    <Chip key={k} onClick={() => navigate({ name: 'create', prefill: { title: t(`suggestions.${k}`) } })}>
                      {t(`suggestions.${k}`)}
                    </Chip>
                  ))}
                </div>
              </>
            ) : mode === 'firstRun' ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <Button variant="primary" size="lg" icon={<Icon name="create" size={16} />} onClick={() => navigate({ name: 'create' })}>
                  {t('firstRun.create')}
                </Button>
                {/* probar con el ejemplo: un enlace de texto, no otro botón */}
                <button type="button" className="t-callout font-medium text-accent-text hover:underline underline-offset-4 outline-none focus-visible:underline" onClick={startPlan}>
                  {t('firstRun.tryExample')}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <Button variant="primary" size="lg" onClick={() => (courseId ? startPlan() : navigate({ name: 'create' }))}>
                  {t('continue')}
                </Button>
                <GoalLine done={data.today.minutesDone} goal={data.today.minutesGoal} />
              </div>
            )}
          </div>
        </div>

        {/* el arco de Aula: dentro, la luz de la hora que es (amanece, mediodía, atardece, noche); con el ratón encima, se mueve despacio */}
        <div className="hidden @3xl:flex w-[248px] items-center justify-center">
          <ArchLight live scene={scene} className="h-[190px] w-[228px]" />
        </div>
      </div>
    </Card>
  )
}

/** La meta de hoy en una línea: «Meta de hoy: 60 min» antes de empezar y «12 de 60 min hoy» después (nunca «0 / 60»). */
function GoalLine({ done, goal }: { done: number; goal: number }) {
  const { t } = useTranslation('home')
  const target = goal > 0 ? goal : 30
  const minutes = Math.round(done)
  return <span className="t-callout text-text2 tabular">{minutes > 0 ? t('goalProgress', { done: minutes, goal: target }) : t('goal', { goal: target })}</span>
}

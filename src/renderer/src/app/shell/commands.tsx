// Comandos fijos de la paleta: estudiar (el curso del examen más cercano), acciones, ir a, herramientas y apariencia.
import { useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Brain, CalendarDays, FileText, FolderInput, House, Inbox, MessageCircleHeart, Moon, MousePointer2, Settings, Shapes, Sun, SunMedium, LineChart } from 'lucide-react'
import { AulaMark, Icon, toast } from '@renderer/design'
import { api } from '@renderer/lib/api'
import i18next from '@renderer/i18n'
import { TOOLS } from '@renderer/tools/registry'
import { useCourses } from '@renderer/lib/courses'
import { daysUntil } from '@renderer/lib/format'
import { showsAsSample } from '@renderer/lib/sample'
import { registerCommands } from './CommandPalette'
import { toolCommandSpecs } from './toolCommands'
import { studyCommandSpecs, studyCourse, type StudyCommandId } from './studyCommands'
import { navigate } from '../router'
import { useSettings } from '@renderer/lib/settings'
import type { AppSettings } from '@shared/settings'

/** Icono y palabras de búsqueda (en los dos idiomas) de cada acción de estudio. */
const STUDY: Record<StudyCommandId, { icon: () => ReactNode; keywords: string[] }> = {
  continue: { icon: () => <Icon name="plan" size={17} />, keywords: ['plan', 'hoy', 'today', 'estudiar', 'study', 'seguir'] },
  review: { icon: () => <Icon name="practice" size={17} />, keywords: ['repasar', 'review', 'practice', 'práctica', 'tarjetas', 'cards', 'errores', 'mistakes'] },
  exam: { icon: () => <Icon name="exam" size={17} />, keywords: ['simulacro', 'mock', 'exam', 'examen', 'test'] },
  materials: { icon: () => <Icon name="sources" size={17} />, keywords: ['materiales', 'materials', 'apuntes', 'notes', 'pdf', 'subir', 'upload'] },
  ask: { icon: () => <AulaMark size={17} />, keywords: ['chat', 'preguntar', 'ask', 'tutor'] }
}

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e))

/** Importar un curso (.aulapack), como en el menú Archivo. */
function importCourse(): void {
  void (api.invoke as unknown as (m: string) => Promise<{ id?: string } | null>)('courses.import')
    .then((r) => r?.id && navigate({ name: 'course', id: r.id }))
    .catch(fail)
}

/** Lo que se escribiría para buscar el cursor, en los dos idiomas (sale en los dos comandos del cursor). */
const CURSOR_KEYWORDS = ['cursor', 'ratón', 'raton', 'mouse', 'puntero', 'pointer', 'flecha', 'arrow', 'estela', 'cola', 'trail']

/** Cambia el cursor como Ajustes → Apariencia → Cursor (se aplica al momento). */
const setCursor = (cursor: AppSettings['general']['cursor']) => () => void useSettings.getState().update({ general: { cursor } })

/** «Exportar todo», como en Ajustes → Datos. */
function exportEverything(): void {
  void api
    .invoke('data.exportAll')
    .then((r) => r && toast.success(i18next.t('settings:data.exported'), r.path))
    .catch(fail)
}

export function useBuiltinCommands(): void {
  const { t, i18n } = useTranslation()
  const courses = useCourses((s) => s.courses)
  // el curso del examen más cercano (el de ejemplo no cuenta) o, si no hay, el primero
  const target = useMemo(() => studyCourse(courses.map((c) => ({ ...c, sample: showsAsSample(c.id) })), (d) => daysUntil(d)), [courses])
  useEffect(
    () =>
      registerCommands('study', () =>
        studyCommandSpecs(target).map((c) => ({
          id: `study-${c.id}`,
          group: 'study' as const,
          label: t(`palette:study.${c.id}`, { course: target?.title ?? '' }),
          keywords: STUDY[c.id].keywords,
          icon: STUDY[c.id].icon(),
          run: () => navigate(c.route)
        }))
      ),
    [t, i18n.language, target]
  )
  // las herramientas, siempre (no solo con la pantalla Herramientas abierta)
  useEffect(
    () =>
      registerCommands('tools', () =>
        toolCommandSpecs((id) => t(`tools:${id}.name`), (id) => t(`tools:${id}.desc`)).map((c) => {
          const ToolIcon = TOOLS.find((x) => x.id === c.toolId)!.icon
          return { id: c.id, group: 'tools' as const, label: c.label, hint: c.hint, keywords: c.keywords, icon: <ToolIcon size={17} />, run: () => navigate({ name: 'tools', tool: c.toolId }) }
        })
      ),
    [t, i18n.language]
  )
  useEffect(
    () =>
      registerCommands('builtin', () => [
        { id: 'new-course', group: 'actions', label: t('nav.newCourse'), icon: <Icon name="create" size={17} className="text-accent-text" />, keywords: ['crear', 'create', 'nuevo', 'new', 'curso', 'course'], run: () => navigate({ name: 'create' }) },
        // importar un curso y exportar todo abren diálogos del Mac: desde un dispositivo no se ofrecen (ni se pueden pedir)
        ...(api.remote
          ? []
          : [
              { id: 'import-course', group: 'actions' as const, label: t('palette:actions.importCourse'), icon: <FolderInput size={17} />, keywords: ['aulapack', 'importar', 'import', 'curso', 'course'], run: importCourse },
              { id: 'export-all', group: 'actions' as const, label: t('settings:data.exportAll'), icon: <Archive size={17} />, keywords: ['exportar', 'export', 'copia', 'backup', 'datos', 'data'], run: exportEverything }
            ]),
        // en el orden de la barra lateral
        { id: 'go-home', group: 'navigate', label: t('nav.home'), icon: <House size={17} />, run: () => navigate({ name: 'home' }) },
        { id: 'go-chat', group: 'navigate', label: t('nav.chat'), icon: <MessageCircleHeart size={17} />, run: () => navigate({ name: 'chat' }) },
        { id: 'go-inbox', group: 'navigate', label: t('nav.inbox'), icon: <Inbox size={17} />, run: () => navigate({ name: 'inbox' }) },
        { id: 'go-calendar', group: 'navigate', label: t('nav.calendar'), icon: <CalendarDays size={17} />, run: () => navigate({ name: 'calendar' }) },
        { id: 'go-docs', group: 'navigate', label: t('nav.documents'), icon: <FileText size={17} />, run: () => navigate({ name: 'documents' }) },
        { id: 'go-tools', group: 'navigate', label: t('nav.tools'), icon: <Shapes size={17} />, run: () => navigate({ name: 'tools' }) },
        { id: 'go-stats', group: 'navigate', label: t('nav.stats'), icon: <LineChart size={17} />, run: () => navigate({ name: 'stats' }) },
        { id: 'go-settings', group: 'navigate', label: t('nav.settings'), icon: <Settings size={17} />, run: () => navigate({ name: 'settings' }) },
        { id: 'memory', group: 'navigate', label: t('palette:actions.memory'), icon: <Brain size={17} />, keywords: ['memoria', 'memory', 'recuerda', 'remembers'], run: () => navigate({ name: 'settings', section: 'memory' }) },
        { id: 'theme-dark', group: 'appearance', label: t('palette:actions.themeDark'), icon: <Moon size={17} />, keywords: ['tema', 'theme', 'oscuro', 'dark'], run: () => void useSettings.getState().update({ general: { theme: 'dark' } }) },
        { id: 'theme-light', group: 'appearance', label: t('palette:actions.themeLight'), icon: <Sun size={17} />, keywords: ['tema', 'theme', 'claro', 'light'], run: () => void useSettings.getState().update({ general: { theme: 'light' } }) },
        // el cursor es de la ventana del Mac (como en Ajustes → Apariencia): un dispositivo táctil no tiene
        ...(api.remote
          ? []
          : [
              { id: 'cursor-system', group: 'appearance' as const, label: t('palette:actions.cursorSystem'), icon: <MousePointer2 size={17} />, keywords: [...CURSOR_KEYWORDS, 'sistema', 'system'], run: setCursor('system') },
              { id: 'cursor-sun', group: 'appearance' as const, label: t('palette:actions.cursorSun'), icon: <SunMedium size={17} />, keywords: [...CURSOR_KEYWORDS, 'sol', 'sun'], run: setCursor('sun') }
            ])
      ]),
    [t, i18n.language]
  )
}

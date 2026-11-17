// Materiales: las fuentes del curso (apuntes, libro, exámenes de repaso, web…) en una lista con su tipo, páginas y
// procedencia; abrir el original o leer el texto que extrajo Aula (por páginas). La primera fila añade más (o se sueltan los
// archivos encima de la ventana): se leen al instante y pasan al curso en cuanto están leídos (aunque se salga de la
// pestaña); «Ampliar el curso con ellos» es un paso opcional (J2-7).
import { timecode } from '@shared/ingest'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { Pack, SourceChunk, SourceMeta } from '@shared/schema'
import { decodeSourceChunk } from '@shared/schema'
import type { MaterialView } from '@shared/generation/types'
import { Button, Card, cx, Drawer, EmptyState, Icon, SectionTitle, Spinner, Stagger, TextField, toast, type IconName } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { api, packAssetUrl } from '@renderer/lib/api'
import { isDemo } from '@renderer/lib/demo'
import { fmtDate } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { openCourseSource } from '@renderer/screens/documents/lib'
import { FileDropOverlay, filePaths, useFileDrop } from '@renderer/screens/documents/FileDrop'
import { searchKey } from '@renderer/screens/study/tabs'
import { ResearchNote } from './ResearchNote'
import { RULED_ROW } from './sections'

const invoke = api.invoke as unknown as (m: string, a?: unknown) => Promise<unknown>
const demoChunks = import.meta.glob<unknown>('../../../../../resources/demo-course/Packs/*/sources/*/chunks.json', { import: 'default' })

const KIND_ICON: Record<string, IconName> = { pdf: 'file-text', docx: 'file-text', doc: 'file-text', pptx: 'layers', ppt: 'layers', image: 'image', web: 'globe', url: 'globe', text: 'note', canvas: 'browser', video: 'video', audio: 'audio', epub: 'book' }
const TRUST_TONE: Record<string, string> = { official: 'var(--accent-text)', book: 'var(--text2)', notes: 'var(--text2)', web: 'var(--text2)', canvas: 'var(--text2)', other: 'var(--text3)' }

/** Lee el texto extraído de un material (`sources/<id>/chunks.json`), en orden. */
async function loadChunks(packId: string, sourceId: string): Promise<SourceChunk[]> {
  let raw: unknown
  const demo = Object.entries(demoChunks).find(([p]) => p.includes(`/Packs/${packId}/sources/${sourceId}/`))
  if (demo && isDemo()) raw = await demo[1]()
  else {
    const res = await fetch(packAssetUrl(packId, `sources/${sourceId}/chunks.json`))
    if (!res.ok) throw new Error(String(res.status))
    raw = await res.json()
  }
  const list = Array.isArray(raw) ? raw : []
  return list.map(decodeSourceChunk).filter((c): c is SourceChunk => !!c).sort((a, b) => a.ordinal - b.ordinal)
}

/** Los fragmentos agrupados por página (los que no la tienen, juntos al principio). */
export function chunksByPage(chunks: SourceChunk[]): { page?: number; chunks: SourceChunk[] }[] {
  const out: { page?: number; chunks: SourceChunk[] }[] = []
  for (const c of chunks) {
    const last = out[out.length - 1]
    if (last && last.page === c.page) last.chunks.push(c)
    else out.push({ page: c.page, chunks: [c] })
  }
  return out
}

export function MaterialsTab({ pack }: { pack: Pack }) {
  const { t } = useTranslation(['course', 'study'])
  const [reading, setReading] = useState<SourceMeta | null>(null)
  const [added, setAdded] = useState<MaterialView[]>([])
  const [draftId, setDraftId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const sources = pack.sources
  const saved = useMemo(() => new Set(sources.map((x) => x.id)), [sources])

  useEffect(() => {
    if (!draftId) return
    return api.on('create.material', (e) => {
      if (e.draftId !== draftId) return
      setAdded((list) => (list.some((m) => m.id === e.material.id) ? list.map((m) => (m.id === e.material.id ? e.material : m)) : [...list, e.material]))
    })
  }, [draftId])

  const addPaths = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    setAdding(true)
    try {
      const r = (await invoke('create.addFiles', { paths, draftId: draftId ?? undefined })) as { draftId: string; materials: MaterialView[] }
      setDraftId(r.draftId)
      setAdded(r.materials)
      // al curso en cuanto se lean (lo hace el proceso principal, también si nos vamos de aquí)
      await invoke('create.attachToCourse', { packId: pack.id, draftId: r.draftId }).catch(() => undefined)
    } catch {
      toast.error(t('study:tab.materials.addFailed'))
    } finally {
      setAdding(false)
    }
  }
  const addFiles = (files: FileList | null): void => {
    if (files?.length) void addPaths(filePaths(files))
  }
  const dragging = useFileDrop(addFiles)
  const useForCourse = async (): Promise<void> => {
    const titles = added.filter((m) => m.status === 'ready').map((m) => `«${m.title}»`).join(', ')
    try {
      const r = (await invoke('generation.extend', { packId: pack.id, instruction: t('study:tab.materials.extendInstruction', { titles, draft: draftId ?? '' }) })) as { runId: string }
      navigate({ name: 'run', id: r.runId })
    } catch {
      navigate({ name: 'chat', prompt: t('study:tab.materials.extendInstruction', { titles, draft: draftId ?? '' }) })
    }
  }
  const openOriginal = async (s: SourceMeta): Promise<void> => {
    try {
      if (s.url && /^https?:/i.test(s.url)) return void (await api.invoke('app.openExternal', { url: s.url }))
      // el original se abre en el lector de Aula (PDF con marcas, Aula al lado)
      openCourseSource(pack.id, s.id)
    } catch {
      toast.warning(t('study:tab.materials.openFailed'))
    }
  }

  return (
    <>
      <Stagger gap={0.05}>
        <Card enterAnim padded="lg">
          <SectionTitle title={t('study:tab.materials.title')} detail={sources.length ? t('study:tab.materials.count', { count: sources.length }) : undefined} />
          <div className="-mx-3 flex flex-col">
            {/* la primera fila añade: abre el selector de archivos (o se sueltan encima de la ventana) */}
            <button type="button" onClick={() => file.current?.click()} className={cx(RULED_ROW, 'group flex items-center gap-3.5 rounded-[14px] px-3 py-3 text-left transition-colors hover:bg-fill1')}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] border border-dashed border-line-strong/50 text-accent-text">
                {adding ? <Spinner size={16} /> : <Icon name="plus" size={18} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block t-callout font-medium text-accent-text">{t('materials.add')}</span>
                <span className="block t-footnote mt-0.5">{t('study:tab.materials.kinds')}</span>
              </span>
            </button>
            {added.map((m) => (
              <div key={m.id} className={cx(RULED_ROW, 'flex items-center gap-3.5 px-3 py-2.5 t-callout')}>
                <span className="grid h-11 w-11 shrink-0 place-items-center">
                  {m.status === 'processing' ? <Spinner size={14} /> : <Icon name={m.status === 'ready' ? 'check-circle' : 'alert-circle'} size={16} className={m.status === 'ready' ? 'text-text2' : 'text-danger'} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{m.title}</span>
                {saved.has(m.id) ? (
                  <span className="t-footnote text-text2">{t('study:tab.materials.saved')}</span>
                ) : m.status === 'processing' ? (
                  <span className="t-footnote">{t('study:tab.materials.reading')}</span>
                ) : (
                  m.pages > 0 && <span className="t-footnote">{t('study:tab.materials.pages', { count: m.pages })}</span>
                )}
              </div>
            ))}
            {sources.map((s, i) => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.04 }} className={cx(RULED_ROW, 'group flex items-center gap-3.5 px-3 py-3')}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-tile text-text2">
                  <Icon name={KIND_ICON[s.kind.toLowerCase()] ?? 'file'} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block t-callout font-medium truncate">{s.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1 t-footnote">
                    <span className="uppercase tracking-wide">{s.kind}</span>
                    {/* una grabación dice cuánto dura, no cuántas páginas tiene */}
                    {s.duration ? <span>· {timecode(s.duration)}</span> : s.pages > 0 && <span>· {t('study:tab.materials.pages', { count: s.pages })}</span>}
                    <span>· <span style={{ color: TRUST_TONE[s.trust] }}>{t(`study:tab.materials.trust.${s.trust}`)}</span></span>
                    <span>· {fmtDate(s.addedAt, { day: 'numeric', month: 'short' })}</span>
                    {s.status === 'processing' && <span className="inline-flex items-center gap-1 text-text2">· <Spinner size={10} /> {t('study:tab.materials.reading')}</span>}
                    {s.status === 'failed' && <span className="text-danger">· {t('study:tab.materials.failed')}</span>}
                    {s.warnings.length > 0 && <span className="text-warning">· {s.warnings[0]}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="secondary" icon={<Icon name="book" size={13} />} disabled={s.status !== 'ready'} onClick={() => setReading(s)}>{t('study:tab.materials.read')}</Button>
                  {(s.filename || s.url) && (
                    <Button size="sm" variant="ghost" icon={<Icon name={s.url ? 'external' : 'folder-open'} size={13} />} onClick={() => void openOriginal(s)}>{t('study:tab.materials.original')}</Button>
                  )}
                </span>
              </motion.div>
            ))}
          </div>
          {sources.length === 0 && !added.length && (
            <>
              <p className="t-callout text-text2 mt-3">{t('study:tab.materials.none')}</p>
              <ResearchNote packId={pack.id} />
            </>
          )}
          {/* lo añadido ya está en el curso; ampliarlo con ello es un paso aparte (J2-7) */}
          {added.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              <p className="min-w-0 flex-1 t-callout text-text2">{t('study:tab.materials.addBody')}</p>
              <Button variant="primary" disabled={!added.some((m) => m.status === 'ready')} onClick={() => void useForCourse()}>{t('study:tab.materials.use')}</Button>
            </div>
          )}
          <input ref={file} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </Card>
      </Stagger>
      <FileDropOverlay show={dragging} title={t('materials.dropHere')} body={t('study:tab.materials.kinds')} />
      <ReaderDrawer pack={pack} source={reading} onClose={() => setReading(null)} />
    </>
  )
}

/** El texto que leyó Aula de un material, por páginas, con búsqueda. */
function ReaderDrawer({ pack, source, onClose }: { pack: Pack; source: SourceMeta | null; onClose: () => void }) {
  const { t } = useTranslation('study')
  const [chunks, setChunks] = useState<SourceChunk[] | null>(null)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!source) return
    setChunks(null)
    setError(false)
    setQ('')
    loadChunks(pack.id, source.id).then(setChunks).catch(() => setError(true))
  }, [pack.id, source])
  const key = searchKey(q.trim())
  const pages = useMemo(() => chunksByPage((chunks ?? []).filter((c) => !key || searchKey(`${c.heading ?? ''} ${c.text}`).includes(key))), [chunks, key])
  return (
    <Drawer open={!!source} onClose={onClose} width={560} title={source?.title}>
      <div className="flex flex-col gap-4 px-5 pb-8">
        <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tab.materials.search')} icon={<Icon name="search" size={15} />} />
        {error ? (
          <EmptyState art="books" title={t('tab.materials.noText')} body={t('tab.materials.noTextBody')} />
        ) : !chunks ? (
          <div className="grid place-items-center py-10 text-text3"><Spinner size={16} /></div>
        ) : pages.length === 0 ? (
          <p className="t-callout text-text2">{key ? t('tab.materials.notFound', { q }) : t('tab.materials.empty')}</p>
        ) : (
          pages.map((p, i) => (
            <section key={i} className="flex flex-col gap-2">
              {/* en una grabación, el minuto en que se dice (y un toque lo abre ahí) */}
              {p.chunks[0]?.start !== undefined && source
                ? <button type="button" className="t-eyebrow self-start text-accent-text hover:underline underline-offset-2" onClick={() => openCourseSource(pack.id, source.id, undefined, p.chunks[0].start)}>{timecode(p.chunks[0].start)}</button>
                : p.page !== undefined && <div className="t-eyebrow">{t('tab.materials.page', { n: p.page })}</div>}
              {p.chunks.map((c) => (
                <div key={c.id}>
                  {c.heading && <div className="t-headline mb-1">{c.heading}</div>}
                  <div className="font-serif text-[16px] leading-[26px] text-text selectable"><RichText text={c.text} /></div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </Drawer>
  )
}

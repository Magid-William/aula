// Tus plataformas: entra una vez y la sesión queda guardada (cifrada) y refrescada en segundo plano.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Card, Icon, LiveDot, Menu, IconButton, Section, SectionTitle, Switch, TextField, cx, toast } from '@renderer/design'
import type { PlatformAccountView } from '@shared/platforms/types'
import { api } from '@renderer/lib/api'
import { useRpc } from '@renderer/lib/useRpc'
import { useSettings } from '@renderer/lib/settings'
import { isDemo } from '@renderer/lib/demo'
import { signInHere } from '@renderer/lib/live'

const DEMO: PlatformAccountView[] = [
  { id: 'p1', kind: 'canvas', label: 'Canvas · Universidad', baseURL: 'https://canvas.universidad.edu', kindName: 'Canvas', status: 'signedIn', calendarConnected: true, tokenMode: false, signingIn: false, lastCheckedAt: new Date().toISOString() },
  { id: 'p2', kind: 'moodle', label: 'Moodle · Ciencias', baseURL: 'https://moodle.ciencias.edu', kindName: 'Moodle', status: 'needsSignIn', statusDetail: 'La sesión caducó', calendarConnected: false, tokenMode: false, signingIn: false }
]

/** Plataformas conectadas, en una tarjeta (la bienvenida). `heading={false}` cuando la pantalla ya lo titula. */
/** `className` sustituye a «h-full» (p. ej. vacío para que tome su altura natural en una columna). */
export function PlatformsCard({ heading = true, className = 'h-full' }: { heading?: boolean; className?: string }) {
  const { t } = useTranslation('settings')
  return (
    <Card padded="lg" className={cx('flex flex-col', className)}>
      {heading && <SectionTitle title={t('platforms.title')} detail={t('platforms.hint')} />}
      <div className={cx(heading && 'mt-4')}>
        <PlatformsBody />
      </div>
    </Card>
  )
}

/** Ajustes → Tus plataformas: la misma lista sobre el papel. */
export function PlatformsSection() {
  const { t } = useTranslation('settings')
  return (
    <Section title={t('platforms.title')} detail={t('platforms.hint')} rule={false}>
      <PlatformsBody />
    </Section>
  )
}

function PlatformsBody() {
  const { t } = useTranslation('settings')
  const { data, error, reload } = useRpc('platforms.list', undefined, { events: ['platforms.status', 'platforms.signedIn'] })
  const accounts = data ?? (error && isDemo() ? DEMO : [])
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)

  // aviso claro en cuanto Aula detecta la sesión (desde aquí, desde el chat o desde una automatización)
  useEffect(() => api.on('platforms.signedIn', ({ account }) => toast.success(t('platforms.signedInAt', { name: account.label }), t('platforms.signedInDetail'))), [t])

  const add = async () => {
    if (!url.trim()) return
    setAdding(true)
    try {
      const acc = await api.invoke('platforms.add', { url: url.trim() })
      setUrl('')
      await reload()
      // desde un dispositivo (el propietario de Aula como servidor) la ventana del equipo no se ve: se inicia sesión en el
      // navegador de Aula en vivo, aquí mismo
      if (api.remote) await signInHere(acc.id)
      else await api.invoke('platforms.signIn', { accountId: acc.id })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2">
        {/* sin plataformas: con qué campus funciona, en una frase (sin logotipos ni nube de nombres) */}
        {accounts.length === 0 && (
          <p className="t-callout text-text2">
            {t('platforms.none')} <span className="text-text3">{t('platforms.worksWith')}</span>
          </p>
        )}
        <AnimatePresence initial={false}>
          {accounts.map((a) => (
            <AccountRow key={a.id} a={a} onChanged={() => void reload()} />
          ))}
        </AnimatePresence>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1">
          <TextField value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder={t('platforms.addPlaceholder')} icon={<Icon name="link" size={15} />} />
        </div>
        <Button variant="secondary" size="lg" loading={adding} onClick={() => void add()}>
          {t('platforms.add')}
        </Button>
      </div>
      <div className="mt-4 flex items-start justify-between gap-4 border-t-[0.5px] border-line-soft pt-3">
        <div>
          <div className="t-callout font-medium">{t('platforms.keepSignedIn')}</div>
          <div className="t-ui text-text3 mt-0.5">{t('platforms.keepSignedInHint')}</div>
        </div>
        <Switch checked={settings?.platforms.keepSignedIn ?? true} onChange={(v) => void update({ platforms: { keepSignedIn: v } })} label={t('platforms.keepSignedIn')} />
      </div>
    </div>
  )
}

function AccountRow({ a, onChanged }: { a: PlatformAccountView; onChanged: () => void }) {
  const { t } = useTranslation('settings')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const ok = a.status === 'signedIn' && !a.signingIn
  const signIn = async () => {
    setBusy(true)
    try {
      if (api.remote) {
        await signInHere(a.id)
        return
      }
      await api.invoke('platforms.signIn', { accountId: a.id })
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // respaldo: «Ya he iniciado sesión» vuelve a comprobar ya; si aún no, se trae la ventana al frente
  const confirm = async () => {
    setConfirming(true)
    try {
      const r = await api.invoke('platforms.confirmSignIn', { accountId: a.id })
      if (!r.signedIn) toast.info(t('platforms.notYet'), t('platforms.notYetHint'))
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setConfirming(false)
    }
  }
  const statusText = a.signingIn
    ? t('platforms.waiting')
    : ok ? t('platforms.signedIn') : a.status === 'needsSignIn' ? a.statusDetail ?? t('platforms.needsSignIn') : a.status === 'checking' ? t('platforms.checking') : t('platforms.notSignedIn')
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -10 }} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] bg-sunken p-3">
      <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-tile text-text2">
        <Icon name="plug" size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="t-callout font-medium truncate">{a.label}</div>
        <div className={cx('t-ui flex items-center gap-1.5', ok ? 'text-success' : a.signingIn ? 'text-text2' : a.status === 'needsSignIn' ? 'text-warning' : 'text-text3')} aria-live="polite">
          {ok && <LiveDot color="var(--success)" size={6} />}
          {a.signingIn && <LiveDot size={6} activity />}
          <span className="truncate" title={statusText}>{statusText}</span>
        </div>
      </div>
      {a.signingIn ? (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void signIn()}>
            {t('platforms.showWindow')}
          </Button>
          <Button size="sm" variant="primary" loading={confirming} onClick={() => void confirm()}>
            {t('platforms.alreadySignedIn')}
          </Button>
        </div>
      ) : (
        !ok && (
          <Button size="sm" variant="primary" loading={busy} onClick={() => void signIn()}>
            {t('platforms.signIn')}
          </Button>
        )
      )}
      <Menu
        trigger={(open) => (
          <IconButton label="…" size="sm" onClick={open}>
            <Icon name="more" size={15} />
          </IconButton>
        )}
        items={[
          { label: t('platforms.checkNow'), icon: <Icon name="refresh" size={14} />, onSelect: () => void api.invoke('platforms.check', { accountId: a.id }).then(onChanged).catch(() => {}) },
          { label: t('platforms.signOut'), icon: <Icon name="lock" size={14} />, onSelect: () => void api.invoke('platforms.signOut', { accountId: a.id }).then(onChanged).catch(() => {}) },
          { label: t('platforms.remove'), icon: <Icon name="trash" size={14} />, danger: true, onSelect: () => void api.invoke('platforms.remove', { accountId: a.id }).then(onChanged).catch(() => {}) }
        ]}
      />
    </motion.div>
  )
}

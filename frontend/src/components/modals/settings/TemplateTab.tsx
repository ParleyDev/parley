import { Copy, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { useT } from '../../../lib/i18n'

interface Template { code: string; name: string; description: string; usage_count: number; updated_at: string }

/** Server Settings › Server Template: snapshot this server's channels, roles and permissions as a shareable link. */
export default function TemplateTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const [tpl, setTpl] = useState<Template | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const t = useT()
  useEffect(() => { api.get<Template | null>(`/guilds/${guildId}/template`).then((x) => { setTpl(x); setName(x?.name ?? guild?.name ?? ''); setDescription(x?.description ?? '') }).catch(() => setTpl(null)) }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) } }
  const link = tpl ? `${location.origin}/template/${tpl.code}` : ''
  if (!guild || tpl === undefined) return null
  return (
    <div className="space-y-6" data-template-tab>
      <div>
        <h1 className="text-xl font-bold">{t('Server Template')}</h1>
        <p className="mt-1 text-sm text-text-2">{t('Share a link that creates a new server with this server\'s channels, roles, permissions and settings. Messages, members, emoji and member-specific permissions are never copied.')}</p>
      </div>
      <div className="space-y-3">
        <div><label className="label" htmlFor="tpl-title">{t('Template title')}</label><input id="tpl-title" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} data-template-title /></div>
        <div><label className="label" htmlFor="tpl-desc">{t('Description')}</label><textarea id="tpl-desc" className="input resize-none" rows={2} maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('What is this template for?')} data-template-desc /></div>
      </div>
      {!tpl ? (
        <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={() => run(async () => { setTpl(await api.post<Template>(`/guilds/${guildId}/template`, { name, description })); pushToast(t('Template created')) })} data-template-generate>{t('Generate Template')}</button>
      ) : (
        <>
          <div className="flex gap-2">
            <input readOnly className="input flex-1 font-mono text-sm" value={link} data-template-link />
            <button type="button" className="btn-primary flex items-center gap-1" onClick={() => { void navigator.clipboard?.writeText(link); pushToast(t('Link copied')) }}><Copy size={14} />{t('Copy')}</button>
          </div>
          <p className="text-xs text-text-2">{tpl.usage_count === 1 ? t('Used {n} time', { n: tpl.usage_count }) : t('Used {n} times', { n: tpl.usage_count })} · {t('last synced {time}', { time: new Date(tpl.updated_at).toLocaleString() })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(async () => { setTpl(await api.patch<Template>(`/guilds/${guildId}/template`, { name, description })); pushToast(t('Template saved')) })} data-template-save>{t('Save title')}</button>
            <button type="button" className="btn-ghost flex items-center gap-1" disabled={busy} onClick={() => run(async () => { setTpl(await api.put<Template>(`/guilds/${guildId}/template`)); pushToast(t('Template synced with the server')) })} data-template-sync><RefreshCw size={14} />{t('Sync Template')}</button>
            <button type="button" className="btn-ghost flex items-center gap-1 text-danger" disabled={busy} onClick={() => run(async () => { await api.delete(`/guilds/${guildId}/template`); setTpl(null) })} data-template-delete><Trash2 size={14} />{t('Delete Template')}</button>
          </div>
        </>
      )}
    </div>
  )
}

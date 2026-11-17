import { Copy, Download, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { useT } from '../../../lib/i18n'
import { downloadTemplate } from '../../../lib/templates'

interface Template { code: string; name: string; description: string; usage_count: number; updated_at: string }

/**
 * Server Settings › Server Template: this server's channels, roles, permissions and settings as a shareable link (kept
 * in sync on request) or a downloadable file, either of which Create Server → Use a Template turns into a new server.
 */
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
        <p className="mt-1 text-sm text-text-2">{t('Share a link or a file that creates a new server with this server\'s channels, roles, permissions and settings. Messages, members, emoji and member-specific permissions are never copied.')}</p>
      </div>
      <section className="rounded-xl border border-line bg-bg-0/40 p-4 space-y-2" data-template-file>
        <h2 className="font-semibold">{t('Download as a file')}</h2>
        <p className="text-sm text-text-2">{t('A template file of the server as it is right now, to keep as a backup or to share. Anyone can create a server from it with Create Server → Use a Template, on this Parley server or another one.')}</p>
        <button type="button" className="btn-ghost bg-bg-3 inline-flex items-center gap-1" disabled={busy} onClick={() => run(async () => { await downloadTemplate(`/guilds/${guildId}/template/export`, guild.name) })} data-template-download><Download size={14} />{t('Download template file')}</button>
      </section>
      <section className="rounded-xl border border-line bg-bg-0/40 p-4 space-y-4" data-template-share>
      <div>
        <h2 className="font-semibold">{t('Share a link')}</h2>
        <p className="mt-1 text-sm text-text-2">{t('A link that stays the same while you sync it with the server. People with it can preview the template, create a server from it, or download it as a file.')}</p>
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
      </section>
    </div>
  )
}

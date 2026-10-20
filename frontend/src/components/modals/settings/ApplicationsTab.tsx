import { Copy, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { Application } from '../../../lib/types'
import { publicOrigin } from '../../InviteCard'

const SCOPES: [string, string][] = [['identify', 'identify'], ['email', 'email'], ['guilds', 'guilds'], ['messages.read', 'messages.read'], ['messages.write', 'messages.write'], ['bot', 'bot']]

/** Settings → Developer → Applications: create OAuth2 apps, manage redirect URIs, secrets and the bot. */
export default function ApplicationsTab() {
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [list, setList] = useState<Application[] | null>(null)
  const [open, setOpen] = useState<Application | null>(null)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)
  const [uris, setUris] = useState('')
  const [desc, setDesc] = useState('')
  const [scopes, setScopes] = useState<string[]>(['identify'])
  const load = () => api.get<Application[]>('/applications').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  const copy = async (label: string, v: string) => { try { await navigator.clipboard.writeText(v); pushToast(`${label} copied`) } catch { pushToast('Clipboard unavailable', 'error') } }
  const create = async (e: FormEvent) => {
    e.preventDefault()
    try { const a = await api.post<Application>('/applications', { name }); setSecret({ label: `Client secret for ${a.name} (shown once)`, value: a.client_secret! }); setName(''); await load(); await show(a.id) } catch (err) { pushToast((err as Error).message, 'error') }
  }
  const show = async (id: string) => { try { const a = await api.get<Application>(`/applications/${id}`); setOpen(a); setUris(a.redirect_uris.join('\n')); setDesc(a.description) } catch (err) { pushToast((err as Error).message, 'error') } }
  const save = async () => { if (!open) return; try { const a = await api.patch<Application>(`/applications/${open.id}`, { description: desc, redirect_uris: uris.split('\n').map((x) => x.trim()).filter(Boolean) }); pushToast('Saved'); setOpen({ ...open, ...a }); await load() } catch (err) { pushToast((err as Error).message, 'error') } }
  const resetSecret = async () => { if (!open) return; try { const r = await api.post<{ client_secret: string }>(`/applications/${open.id}/reset-secret`, {}); setSecret({ label: 'New client secret (shown once)', value: r.client_secret }) } catch (err) { pushToast((err as Error).message, 'error') } }
  const createBot = async () => { if (!open) return; try { const r = await api.post<{ token: string }>(`/applications/${open.id}/bot`, {}); setSecret({ label: 'Bot token (shown once)', value: r.token }); await show(open.id) } catch (err) { pushToast((err as Error).message, 'error') } }
  const resetBot = async () => { if (!open) return; try { const r = await api.post<{ token: string }>(`/applications/${open.id}/bot/reset-token`, {}); setSecret({ label: 'New bot token (shown once)', value: r.token }) } catch (err) { pushToast((err as Error).message, 'error') } }
  const del = () => open && openModal({ kind: 'confirm', title: `Delete '${open.name}'`, body: 'Every token is revoked and its bot account removed. This cannot be undone.', danger: true, confirmLabel: 'Delete Application', action: async () => { try { await api.delete(`/applications/${open.id}`); setOpen(null); await load() } catch (err) { pushToast((err as Error).message, 'error') } } })
  const authUrl = open ? `${publicOrigin()}/oauth2/authorize?client_id=${open.client_id}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}${open.redirect_uris[0] ? `&redirect_uri=${encodeURIComponent(open.redirect_uris[0])}` : ''}` : ''
  return (
    <div className="space-y-6" data-applications-tab>
      <h2 className="text-xl font-bold">Applications</h2>
      {secret && (
        <div className="rounded-xl border border-warn/50 bg-warn/10 p-3 space-y-2" data-secret-reveal>
          <div className="text-sm font-semibold">{secret.label}</div>
          <code className="block break-all rounded bg-bg-0 px-2 py-1 text-xs" data-secret-value>{secret.value}</code>
          <div className="flex gap-2"><button type="button" className="btn-ghost text-xs" onClick={() => copy('Secret', secret.value)}><Copy size={12} /> Copy</button><button type="button" className="btn-ghost text-xs" onClick={() => setSecret(null)}>Done, I saved it</button></div>
        </div>
      )}
      {!open ? (
        <>
          <form onSubmit={create} className="flex gap-2"><input className="input flex-1" placeholder="New application name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required data-app-name /><button className="btn-primary" data-app-create><Plus size={16} /> Create</button></form>
          {list?.length === 0 && <p className="text-sm text-text-2">No applications yet. Create one to get a client ID and secret for OAuth2, and a bot account if you need one.</p>}
          <ul className="space-y-2">{list?.map((a) => <li key={a.id}><button type="button" onClick={() => show(a.id)} className="w-full text-left rounded-lg border border-line bg-bg-1 px-3 py-2.5 hover:bg-bg-3 flex items-center gap-3" data-app={a.id}><span className="h-9 w-9 rounded-md bg-bg-3 text-sm font-bold flex items-center justify-center">{a.name[0]}</span><span className="min-w-0 flex-1"><span className="block font-semibold truncate">{a.name}</span><span className="block text-xs text-text-2">{a.client_id}{a.bot_user_id ? ' · has a bot' : ''}</span></span></button></li>)}</ul>
        </>
      ) : (
        <div className="space-y-5" data-app-detail={open.id}>
          <button type="button" className="text-sm text-sky-400 hover:underline" onClick={() => setOpen(null)}>← All applications</button>
          <h3 className="text-lg font-bold">{open.name}</h3>
          <div className="rounded-lg border border-line bg-bg-1 p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="text-text-2 w-28">Client ID</span><code className="flex-1 truncate" data-app-client-id>{open.client_id}</code><button type="button" className="btn-ghost text-xs" onClick={() => copy('Client ID', open.client_id)}><Copy size={12} /></button></div>
            <div className="flex items-center gap-2"><span className="text-text-2 w-28">Client secret</span><span className="flex-1 text-text-2">hidden</span><button type="button" className="btn-ghost text-xs" onClick={resetSecret} data-app-reset-secret>Reset secret</button></div>
            <div className="flex items-center gap-2"><span className="text-text-2 w-28">Authorised users</span><span>{open.authorized_users ?? 0}</span></div>
          </div>
          <div><label className="label">Description</label><textarea className="input resize-none" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={400} /></div>
          <div><label className="label">Redirect URIs (one per line)</label><textarea className="input resize-none font-mono text-xs" rows={3} value={uris} onChange={(e) => setUris(e.target.value)} placeholder="https://example.com/callback" data-app-uris /></div>
          <button type="button" className="btn-primary" onClick={save} data-app-save>Save</button>
          <div className="rounded-lg border border-line bg-bg-1 p-3 space-y-2" data-app-bot>
            <div className="font-semibold">Bot</div>
            {open.bot ? (
              <div className="flex items-center gap-3 text-sm"><span className="rounded bg-accent px-1 py-px text-[10px] font-bold uppercase text-white">Bot</span><span className="font-semibold">{open.bot.display_name}</span><span className="text-text-2">@{open.bot.username}</span><button type="button" className="btn-ghost text-xs ml-auto" onClick={resetBot} data-app-reset-bot>Reset token</button></div>
            ) : (
              <><p className="text-sm text-text-2">A bot is a user that acts through a token (<code>Authorization: Bot …</code>). Add it to servers with the <code>bot</code> scope.</p><button type="button" className="btn-ghost bg-bg-3" onClick={createBot} data-app-create-bot>Create bot</button></>
            )}
          </div>
          <div className="rounded-lg border border-line bg-bg-1 p-3 space-y-2" data-app-oauth>
            <div className="font-semibold">OAuth2 URL generator</div>
            <div className="flex flex-wrap gap-2">{SCOPES.map(([id, label]) => <label key={id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={scopes.includes(id)} onChange={(e) => setScopes(e.target.checked ? [...scopes, id] : scopes.filter((s) => s !== id))} className="accent-accent" data-scope-pick={id} /> {label}</label>)}</div>
            <code className="block break-all rounded bg-bg-0 px-2 py-1 text-xs" data-app-auth-url>{authUrl}</code>
            <button type="button" className="btn-ghost text-xs" onClick={() => copy('URL', authUrl)}><Copy size={12} /> Copy URL</button>
            <p className="text-xs text-text-2">Exchange the code at <code>POST {publicOrigin()}/api/oauth2/token</code> (form: grant_type=authorization_code, code, client_id, client_secret, redirect_uri). Use the token as <code>Authorization: Bearer …</code>.</p>
          </div>
          <button type="button" className="rounded-md border border-danger/60 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10" onClick={del} data-app-delete><Trash2 size={14} className="inline mr-1" />Delete application</button>
        </div>
      )}
    </div>
  )
}

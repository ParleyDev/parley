import { Copy, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { has, P, PERMS } from '../../../lib/perms'
import { uploadImage } from '../../../lib/upload'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { Application } from '../../../lib/types'
import { publicOrigin } from '../../InviteCard'
import { useT } from '../../../lib/i18n'

const SCOPES: [string, string][] = [['identify', 'identify'], ['email', 'email'], ['guilds', 'guilds'], ['messages.read', 'messages.read'], ['messages.write', 'messages.write'], ['bot', 'bot']]

/** Settings → Developer → Applications: create OAuth2 apps, manage redirect URIs, secrets and the bot. */
export default function ApplicationsTab() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [list, setList] = useState<Application[] | null>(null)
  const [open, setOpen] = useState<Application | null>(null)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)
  const [uris, setUris] = useState('')
  const [desc, setDesc] = useState('')
  const [activityUrl, setActivityUrl] = useState('')
  const [scopes, setScopes] = useState<string[]>(['identify'])
  // Bot invite link: scopes and the permissions the bot asks for.
  const [botScopes, setBotScopes] = useState<string[]>(['bot', 'applications.commands'])
  const [botPerms, setBotPerms] = useState(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.EMBED_LINKS | P.READ_MESSAGE_HISTORY | P.ADD_REACTIONS)
  const load = () => api.get<Application[]>('/applications').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  const copy = async (label: string, v: string) => { try { await navigator.clipboard.writeText(v); pushToast(t('{label} copied', { label })) } catch { pushToast(t('Clipboard unavailable'), 'error') } }
  const create = async (e: FormEvent) => {
    e.preventDefault()
    try { const a = await api.post<Application>('/applications', { name }); setSecret({ label: t('Client secret for {name} (shown once)', { name: a.name }), value: a.client_secret! }); setName(''); await load(); await show(a.id) } catch (err) { pushToast((err as Error).message, 'error') }
  }
  const show = async (id: string) => { try { const a = await api.get<Application>(`/applications/${id}`); setOpen(a); setUris(a.redirect_uris.join('\n')); setDesc(a.description); setActivityUrl(a.activity_url ?? '') } catch (err) { pushToast((err as Error).message, 'error') } }
  const save = async () => { if (!open) return; try { const a = await api.patch<Application>(`/applications/${open.id}`, { description: desc, redirect_uris: uris.split('\n').map((x) => x.trim()).filter(Boolean), activity_url: activityUrl.trim() }); pushToast(t('Saved')); setOpen({ ...open, ...a }); await load() } catch (err) { pushToast((err as Error).message, 'error') } }
  const resetSecret = async () => { if (!open) return; try { const r = await api.post<{ client_secret: string }>(`/applications/${open.id}/reset-secret`, {}); setSecret({ label: t('New client secret (shown once)'), value: r.client_secret }) } catch (err) { pushToast((err as Error).message, 'error') } }
  const createBot = async () => { if (!open) return; try { const r = await api.post<{ token: string }>(`/applications/${open.id}/bot`, {}); setSecret({ label: t('Bot token (shown once)'), value: r.token }); await show(open.id) } catch (err) { pushToast((err as Error).message, 'error') } }
  const setIntents = async (v: number) => { if (!open) return; try { const a = await api.patch<Application>(`/applications/${open.id}`, { privileged_intents: v }); setOpen({ ...open, ...a }) } catch (err) { pushToast((err as Error).message, 'error') } }
  const resetBot = async () => { if (!open) return; try { const r = await api.post<{ token: string }>(`/applications/${open.id}/bot/reset-token`, {}); setSecret({ label: t('New bot token (shown once)'), value: r.token }) } catch (err) { pushToast((err as Error).message, 'error') } }
  const del = () => open && openModal({ kind: 'confirm', title: t("Delete '{name}'", { name: open.name }), body: t('Every token is revoked and its bot account removed. This cannot be undone.'), danger: true, confirmLabel: t('Delete Application'), action: async () => { try { await api.delete(`/applications/${open.id}`); setOpen(null); await load() } catch (err) { pushToast((err as Error).message, 'error') } } })
  const inviteUrl = open ? `${publicOrigin()}/oauth2/authorize?client_id=${open.client_id}&scope=${encodeURIComponent(botScopes.join(' '))}${botScopes.includes('bot') ? `&permissions=${botPerms}` : ''}` : ''
  const authUrl = open ? `${publicOrigin()}/oauth2/authorize?client_id=${open.client_id}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}${open.redirect_uris[0] ? `&redirect_uri=${encodeURIComponent(open.redirect_uris[0])}` : ''}` : ''
  return (
    <div className="space-y-6" data-applications-tab>
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold">{t('Applications')}</h2><a href="/developers" target="_blank" rel="noopener" className="text-sm text-sky-400 hover:underline" data-dev-docs>{t('API reference')}</a></div>
      {secret && (
        <div className="rounded-xl border border-warn/50 bg-warn/10 p-3 space-y-2" data-secret-reveal>
          <div className="text-sm font-semibold">{secret.label}</div>
          <code className="block break-all rounded bg-bg-0 px-2 py-1 text-xs" data-secret-value>{secret.value}</code>
          <div className="flex gap-2"><button type="button" className="btn-ghost text-xs" onClick={() => copy(t('Secret'), secret.value)}><Copy size={12} /> {t('Copy')}</button><button type="button" className="btn-ghost text-xs" onClick={() => setSecret(null)}>{t('Done, I saved it')}</button></div>
        </div>
      )}
      {!open ? (
        <>
          <form onSubmit={create} className="flex gap-2"><input className="input flex-1" placeholder={t('New application name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required data-app-name /><button className="btn-primary" data-app-create><Plus size={16} /> {t('Create')}</button></form>
          {list?.length === 0 && <p className="text-sm text-text-2">{t('No applications yet. Create one to get a client ID and secret for OAuth2, and a bot account if you need one.')}</p>}
          <ul className="space-y-2">{list?.map((a) => <li key={a.id}><button type="button" onClick={() => show(a.id)} className="w-full text-left rounded-lg border border-line bg-bg-1 px-3 py-2.5 hover:bg-bg-3 flex items-center gap-3" data-app={a.id}><span className="h-9 w-9 rounded-md bg-bg-3 text-sm font-bold flex items-center justify-center">{a.name[0]}</span><span className="min-w-0 flex-1"><span className="block font-semibold truncate">{a.name}</span><span className="block text-xs text-text-2">{a.client_id}{a.bot_user_id ? ` · ${t('has a bot')}` : ''}</span></span></button></li>)}</ul>
        </>
      ) : (
        <div className="space-y-5" data-app-detail={open.id}>
          <button type="button" className="text-sm text-sky-400 hover:underline" onClick={() => setOpen(null)}>{t('← All applications')}</button>
          <h3 className="text-lg font-bold">{open.name}</h3>
          <div className="rounded-lg border border-line bg-bg-1 p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="text-text-2 w-28">{t('Client ID')}</span><code className="flex-1 truncate" data-app-client-id>{open.client_id}</code><button type="button" className="btn-ghost text-xs" onClick={() => copy(t('Client ID'), open.client_id)}><Copy size={12} /></button></div>
            <div className="flex items-center gap-2"><span className="text-text-2 w-28">{t('Client secret')}</span><span className="flex-1 text-text-2">{t('hidden')}</span><button type="button" className="btn-ghost text-xs" onClick={resetSecret} data-app-reset-secret>{t('Reset secret')}</button></div>
            <div className="flex items-center gap-2"><span className="text-text-2 w-28">{t('Authorised users')}</span><span>{open.authorized_users ?? 0}</span></div>
          </div>
          <div><label className="label">{t('Description')}</label><textarea className="input resize-none" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={400} /></div>
          <div><label className="label">{t('Redirect URIs (one per line)')}</label><textarea className="input resize-none font-mono text-xs" rows={3} value={uris} onChange={(e) => setUris(e.target.value)} placeholder="https://example.com/callback" data-app-uris /></div>
          <div>
            <label className="label">{t('Activity URL')}</label>
            <input className="input font-mono text-xs" value={activityUrl} onChange={(e) => setActivityUrl(e.target.value)} placeholder="https://example.com/activity" data-app-activity-url />
            <p className="mt-1 text-xs text-text-2">{t('A page people can open together in calls (Activities). Load {sdk} in it to talk to the call; codes from {authorize} use this URL as their redirect URI.', { sdk: `${publicOrigin()}/activities/sdk.js`, authorize: 'ParleyActivity.authorize()' })}</p>
          </div>
          <button type="button" className="btn-primary" onClick={save} data-app-save>{t('Save')}</button>
          <div className="rounded-lg border border-line bg-bg-1 p-3 space-y-2" data-app-bot>
            <div className="font-semibold">{t('Bot')}</div>
            {open.bot ? (
              <div className="flex items-center gap-3 text-sm"><span className="rounded bg-accent px-1 py-px text-[10px] font-bold uppercase text-white">{t('Bot')}</span><span className="font-semibold">{open.bot.display_name}</span><span className="text-text-2">@{open.bot.username}</span><button type="button" className="btn-ghost text-xs ml-auto" onClick={resetBot} data-app-reset-bot>{t('Reset token')}</button></div>
            ) : null}
            {open.bot ? (
              <div className="space-y-1 border-t border-line pt-2" data-app-intents>
                <div className="text-xs font-semibold text-text-1">{t('Privileged gateway intents')}</div>
                {([[1 << 1, t('Server members'), t('Join, leave and member updates')], [1 << 8, t('Presence'), t('Who is online and what they are doing')], [1 << 15, t('Message content'), t('Read messages that don\u2019t mention the bot')]] as const).map(([bit, label, hint]) => (
                  <label key={bit} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-accent" checked={((open.privileged_intents ?? 0) & bit) !== 0} onChange={(e) => setIntents(e.target.checked ? (open.privileged_intents ?? 0) | bit : (open.privileged_intents ?? 0) & ~bit)} data-app-intent={bit} /><span>{label}</span><span className="text-xs text-text-2">{hint}</span></label>
                ))}
              </div>
            ) : (
              <><p className="text-sm text-text-2">{t('A bot is a user that acts through a token ({header}). Add it to servers with the {scope} scope.', { header: 'Authorization: Bot …', scope: 'bot' })}</p><button type="button" className="btn-ghost bg-bg-3" onClick={createBot} data-app-create-bot>{t('Create bot')}</button></>
            )}
          </div>
          <div className="rounded-lg border border-line bg-bg-1 p-3 space-y-2" data-app-look>
            <div className="font-semibold">{t('Icon and visibility')}</div>
            <div className="flex items-center gap-3">
              {open.icon_url ? <img src={open.icon_url} alt="" className="h-12 w-12 rounded-xl" /> : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-3 text-xl font-bold">{open.name[0]}</div>}
              <label className="btn-ghost flex cursor-pointer items-center gap-1 text-xs"><ImagePlus size={14} />{t('Upload icon')}<input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const img = await uploadImage('avatar', f); const a = await api.patch<Application>(`/applications/${open.id}`, { icon_url: img.url }); setOpen({ ...open, ...a }) } catch (err) { pushToast((err as Error).message, 'error') } }} data-app-icon /></label>
              {open.icon_url && <button type="button" className="btn-ghost text-xs" onClick={async () => { const a = await api.patch<Application>(`/applications/${open.id}`, { icon_url: '' }); setOpen({ ...open, ...a }) }}>{t('Remove')}</button>}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-accent" checked={open.bot_public !== false} onChange={async (e) => { try { const a = await api.patch<Application>(`/applications/${open.id}`, { bot_public: e.target.checked }); setOpen({ ...open, ...a }) } catch (err) { pushToast((err as Error).message, 'error') } }} data-app-public />{t('Public bot')} <span className="text-xs text-text-2">{t('(off: only you can add it to servers)')}</span></label>
            {open.verified && <p className="text-xs text-accent">{t('✓ Verified by an administrator')}</p>}
            {open.bot && <>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-accent" checked={!!open.listed} disabled={open.bot_public === false} onChange={async (e) => { try { const a = await api.patch<Application>(`/applications/${open.id}`, { listed: e.target.checked }); setOpen({ ...open, ...a }) } catch (err) { pushToast((err as Error).message, 'error') } }} data-app-listed />{t('List in the App Directory')}</label>
              {open.listed && <input className="input text-sm" defaultValue={(open.tags ?? []).join(', ')} placeholder={t('Tags, e.g. music, games, moderation')} onBlur={async (e) => { const a = await api.patch<Application>(`/applications/${open.id}`, { tags: e.target.value.split(',') }); setOpen({ ...open, ...a }) }} data-app-tags />}
            </>}
          </div>
          {open.bot && (
            <div className="rounded-lg border border-line bg-bg-1 p-3 space-y-2" data-app-invite>
              <div className="font-semibold">{t('Bot invite link')}</div>
              <div className="flex flex-wrap gap-3">{['bot', 'applications.commands'].map((s) => <label key={s} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-accent" checked={botScopes.includes(s)} onChange={(e) => setBotScopes(e.target.checked ? [...botScopes, s] : botScopes.filter((x) => x !== s))} />{s}</label>)}</div>
              <div className="text-xs font-semibold text-text-1">{t('Permissions')} <span className="font-normal text-text-2">· {botPerms}</span></div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 max-sm:grid-cols-1" data-perm-calculator>
                {PERMS.map((p) => <label key={p.key} className="flex items-center gap-1.5 text-xs" title={t(p.desc)}><input type="checkbox" className="accent-accent" checked={has(botPerms, P[p.key])} onChange={(e) => setBotPerms(e.target.checked ? botPerms | P[p.key] : botPerms & ~P[p.key])} data-perm-pick={p.key} />{t(p.label)}</label>)}
              </div>
              <code className="block break-all rounded bg-bg-0 px-2 py-1 text-xs" data-app-invite-url>{inviteUrl}</code>
              <div className="flex gap-2"><button type="button" className="btn-ghost text-xs" onClick={() => copy(t('Invite link'), inviteUrl)}><Copy size={12} /> {t('Copy link')}</button>
              <button type="button" className="btn-ghost text-xs" onClick={async () => { const a = await api.patch<Application>(`/applications/${open.id}`, { install_permissions: String(botPerms) }); setOpen({ ...open, ...a }); pushToast(t('The App Directory will ask for these permissions')) }} data-app-save-perms>{t('Use for the App Directory')}</button></div>
            </div>
          )}
          <div className="rounded-lg border border-line bg-bg-1 p-3 space-y-2" data-app-oauth>
            <div className="font-semibold">{t('OAuth2 URL generator')}</div>
            <div className="flex flex-wrap gap-2">{SCOPES.map(([id, label]) => <label key={id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={scopes.includes(id)} onChange={(e) => setScopes(e.target.checked ? [...scopes, id] : scopes.filter((s) => s !== id))} className="accent-accent" data-scope-pick={id} /> {label}</label>)}</div>
            <code className="block break-all rounded bg-bg-0 px-2 py-1 text-xs" data-app-auth-url>{authUrl}</code>
            <button type="button" className="btn-ghost text-xs" onClick={() => copy(t('URL'), authUrl)}><Copy size={12} /> {t('Copy URL')}</button>
            <p className="text-xs text-text-2">{t('Exchange the code at {endpoint} (form: grant_type=authorization_code, code, client_id, client_secret, redirect_uri). Use the token as {header}.', { endpoint: `POST ${publicOrigin()}/api/oauth2/token`, header: 'Authorization: Bearer …' })}</p>
          </div>
          <button type="button" className="rounded-md border border-danger/60 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10" onClick={del} data-app-delete><Trash2 size={14} className="inline mr-1" />{t('Delete application')}</button>
        </div>
      )}
    </div>
  )
}

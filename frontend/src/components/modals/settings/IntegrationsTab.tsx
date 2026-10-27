import { Bot, Megaphone, RefreshCw, Tv, Webhook as WebhookIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import Avatar from '../../Avatar'
import { useT } from '../../../lib/i18n'

interface Integrations {
  bots: { id: string; display_name: string; avatar_url: string | null; joined_at: string; application: string | null }[]
  webhooks: { id: string; name: string; avatar_url: string | null; channel_id: string; channel_name: string; created_at: string }[]
  follows: { channel_id: string; channel_name: string; source_id: string; source_name: string; source_guild: string }[]
}

interface Creator { id: string; provider: 'twitch' | 'youtube'; role_id: string | null; account_name: string; account_url: string; synced_at: string | null; member_count: number; last_error: string }
const CREATORS = [{ id: 'twitch', label: 'Twitch', role: 'Twitch Subscriber', what: 'subscribe to' }, { id: 'youtube', label: 'YouTube', role: 'YouTube Member', what: 'are channel members of' }] as const

/** Server Settings › Integrations: bots, webhooks and followed announcement channels, in one place. */
export default function IntegrationsTab({ guildId }: { guildId: string }) {
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const [data, setData] = useState<Integrations | null>(null)
  const t = useT()
  const load = () => api.get<Integrations>(`/guilds/${guildId}/integrations`).then(setData).catch((e) => pushToast((e as Error).message, 'error'))
  useEffect(() => { void load() }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [creators, setCreators] = useState<Creator[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const available = useStore((s) => s.instance.oauth_available ?? [])
  const loadCreators = () => api.get<Creator[]>(`/guilds/${guildId}/integrations/creators`).then(setCreators).catch(() => {})
  useEffect(() => { void loadCreators() }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps
  const connectCreator = async (provider: string) => {
    setBusy(provider)
    try {
      const mine = await api.get<{ provider: string; creator: boolean }[]>('/users/@me/connections')
      if (!mine.some((c) => c.provider === provider && c.creator)) {
        // Link the channel with subscriber access first; come back and press Connect again.
        const { url } = await api.get<{ url: string }>(`/connections/${provider}/start?creator=1`)
        location.href = url; return
      }
      await api.post(`/guilds/${guildId}/integrations/creators`, { provider }); await loadCreators()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(null) }
  }
  const syncCreator = async (id: string) => { setBusy(id); try { const c = await api.post<Creator>(`/guilds/${guildId}/integrations/creators/${id}/sync`); setCreators((l) => l.map((x) => (x.id === id ? c : x))) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(null) } }
  const removeCreator = (c: Creator) => openModal({ kind: 'confirm', title: t('Remove {name}', { name: c.provider === 'twitch' ? 'Twitch' : 'YouTube' }), body: t('The {role} role is deleted and everyone loses it.', { role: c.provider === 'twitch' ? 'Twitch Subscriber' : 'YouTube Member' }), danger: true, confirmLabel: t('Remove'), action: async () => { try { await api.delete(`/guilds/${guildId}/integrations/creators/${c.id}`); void loadCreators() } catch (e) { pushToast((e as Error).message, 'error') } } })
  const kick = (id: string, name: string) => openModal({ kind: 'confirm', title: t('Remove {name}', { name }), body: t('{name} leaves the server. Someone with Manage Server can add it again.', { name }), danger: true, confirmLabel: t('Remove'), action: async () => { try { await api.delete(`/guilds/${guildId}/members/${id}`); void load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  const head = (icon: React.ReactNode, label: string, n: number) => <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">{icon}{label}<span className="text-text-2">· {n}</span></h2>
  if (!data) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  return (
    <div className="space-y-6" data-integrations-tab>
      <div><h1 className="text-xl font-bold">{t('Integrations')}</h1><p className="mt-1 text-sm text-text-2">{t('Bots, webhooks and channels this server follows. Manage a channel\'s webhooks from its settings.')}</p></div>
      <section data-integrations-creators>
        {head(<Tv size={16} />, 'Twitch & YouTube', creators.length)}
        <p className="mb-2 text-xs text-text-2">{t('Link your channel and members who subscribe to or are channel members of it, with that account connected in Settings → Connections, get a role for it. Kept up to date every 15 minutes.')}</p>
        {CREATORS.map((p) => { const c = creators.find((x) => x.provider === p.id); return c ? (
          <div key={p.id} className="mb-1.5 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm" data-integration-creator={p.id}>
            <div className="flex items-center gap-2">
              <span className="flex-1"><span className="font-semibold">{p.label}</span> · <a href={c.account_url} target="_blank" rel="noreferrer" className="hover:underline">{c.account_name}</a>
                <span className="block text-xs text-text-2" data-creator-status>{c.last_error ? <span className="text-danger">{c.last_error}</span> : <>{c.member_count === 1 ? t('{n} member has {role}', { n: c.member_count, role: p.role }) : t('{n} members have {role}', { n: c.member_count, role: p.role })}{c.synced_at ? t(' · synced {time}', { time: new Date(c.synced_at).toLocaleTimeString() }) : ''}</>}</span></span>
              <button type="button" className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0 disabled:opacity-50" title={t('Sync now')} disabled={busy === c.id} onClick={() => void syncCreator(c.id)} data-creator-sync={p.id}><RefreshCw size={15} className={busy === c.id ? 'animate-spin' : ''} /></button>
              <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => removeCreator(c)} data-creator-remove={p.id}>{t('Remove')}</button>
            </div>
          </div>
        ) : (
          <div key={p.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm">
            <span className="flex-1"><span className="font-semibold">{p.label}</span><span className="block text-xs text-text-2">{available.includes(p.id) ? (p.id === 'twitch' ? t('Give your subscribers the {role} role.', { role: p.role }) : t('Give your channel members the {role} role.', { role: p.role })) : t('{name} isn\'t set up on this server (Instance Settings → Connections).', { name: p.label })}</span></span>
            <button type="button" className="btn-primary !py-1 text-xs" disabled={!available.includes(p.id) || busy === p.id} onClick={() => void connectCreator(p.id)} data-creator-connect={p.id}>{t('Connect')}</button>
          </div>
        ) })}
      </section>
      <section data-integrations-bots>
        {head(<Bot size={16} />, t('Bots'), data.bots.length)}
        {data.bots.length === 0 ? <p className="text-sm text-text-2">{t('No bots. Add one from its app\'s invite link.')}</p> : data.bots.map((b) => (
          <div key={b.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm" data-integration-bot={b.id}>
            <Avatar user={b} size={28} /><span className="flex-1"><span className="font-semibold">{b.display_name}</span>{b.application && <span className="text-text-2"> · {b.application}</span>}<span className="block text-xs text-text-2">{t('Added {date}', { date: new Date(b.joined_at).toLocaleDateString() })}</span></span>
            <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => kick(b.id, b.display_name)} data-integration-kick={b.id}>{t('Remove')}</button>
          </div>
        ))}
      </section>
      <section data-integrations-webhooks>
        {head(<WebhookIcon size={16} />, t('Webhooks'), data.webhooks.length)}
        {data.webhooks.length === 0 ? <p className="text-sm text-text-2">{t('No webhooks.')}</p> : data.webhooks.map((w) => (
          <button key={w.id} type="button" onClick={() => openModal({ kind: 'channelSettings', channelId: w.channel_id, tab: 'integrations' })} className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-left text-sm hover:bg-bg-3" data-integration-webhook={w.id}>
            <WebhookIcon size={16} className="text-text-2" /><span className="flex-1 font-semibold">{w.name}</span><span className="text-xs text-text-2">#{w.channel_name}</span>
          </button>
        ))}
      </section>
      <section data-integrations-follows>
        {head(<Megaphone size={16} />, t('Followed channels'), data.follows.length)}
        {data.follows.length === 0 ? <p className="text-sm text-text-2">{t('Not following any announcement channels.')}</p> : data.follows.map((f) => (
          <div key={f.channel_id + f.source_id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm"><span className="flex-1"><b>{f.source_guild}</b> · #{f.source_name}</span><span className="text-xs text-text-2">→ #{f.channel_name}</span></div>
        ))}
      </section>
    </div>
  )
}

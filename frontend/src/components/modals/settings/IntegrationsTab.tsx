import { Bot, Megaphone, Webhook as WebhookIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import Avatar from '../../Avatar'

interface Integrations {
  bots: { id: string; display_name: string; avatar_url: string | null; joined_at: string; application: string | null }[]
  webhooks: { id: string; name: string; avatar_url: string | null; channel_id: string; channel_name: string; created_at: string }[]
  follows: { channel_id: string; channel_name: string; source_id: string; source_name: string; source_guild: string }[]
}

/** Server Settings › Integrations: bots, webhooks and followed announcement channels, in one place. */
export default function IntegrationsTab({ guildId }: { guildId: string }) {
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const [data, setData] = useState<Integrations | null>(null)
  const load = () => api.get<Integrations>(`/guilds/${guildId}/integrations`).then(setData).catch((e) => pushToast((e as Error).message, 'error'))
  useEffect(() => { void load() }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps
  const kick = (id: string, name: string) => openModal({ kind: 'confirm', title: `Remove ${name}`, body: `${name} leaves the server. Someone with Manage Server can add it again.`, danger: true, confirmLabel: 'Remove', action: async () => { try { await api.delete(`/guilds/${guildId}/members/${id}`); void load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  const head = (icon: React.ReactNode, label: string, n: number) => <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">{icon}{label}<span className="text-text-2">· {n}</span></h2>
  if (!data) return <p className="text-sm text-text-2">Loading…</p>
  return (
    <div className="space-y-6" data-integrations-tab>
      <div><h1 className="text-xl font-bold">Integrations</h1><p className="mt-1 text-sm text-text-2">Bots, webhooks and channels this server follows. Manage a channel's webhooks from its settings.</p></div>
      <section data-integrations-bots>
        {head(<Bot size={16} />, 'Bots', data.bots.length)}
        {data.bots.length === 0 ? <p className="text-sm text-text-2">No bots. Add one from its app's invite link.</p> : data.bots.map((b) => (
          <div key={b.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm" data-integration-bot={b.id}>
            <Avatar user={b} size={28} /><span className="flex-1"><span className="font-semibold">{b.display_name}</span>{b.application && <span className="text-text-2"> · {b.application}</span>}<span className="block text-xs text-text-2">Added {new Date(b.joined_at).toLocaleDateString()}</span></span>
            <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => kick(b.id, b.display_name)} data-integration-kick={b.id}>Remove</button>
          </div>
        ))}
      </section>
      <section data-integrations-webhooks>
        {head(<WebhookIcon size={16} />, 'Webhooks', data.webhooks.length)}
        {data.webhooks.length === 0 ? <p className="text-sm text-text-2">No webhooks.</p> : data.webhooks.map((w) => (
          <button key={w.id} type="button" onClick={() => openModal({ kind: 'channelSettings', channelId: w.channel_id, tab: 'integrations' })} className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-left text-sm hover:bg-bg-3" data-integration-webhook={w.id}>
            <WebhookIcon size={16} className="text-text-2" /><span className="flex-1 font-semibold">{w.name}</span><span className="text-xs text-text-2">#{w.channel_name}</span>
          </button>
        ))}
      </section>
      <section data-integrations-follows>
        {head(<Megaphone size={16} />, 'Followed channels', data.follows.length)}
        {data.follows.length === 0 ? <p className="text-sm text-text-2">Not following any announcement channels.</p> : data.follows.map((f) => (
          <div key={f.channel_id + f.source_id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm"><span className="flex-1"><b>{f.source_guild}</b> · #{f.source_name}</span><span className="text-xs text-text-2">→ #{f.channel_name}</span></div>
        ))}
      </section>
    </div>
  )
}

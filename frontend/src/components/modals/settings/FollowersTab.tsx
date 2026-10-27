import { Copy, Megaphone, Plus, RefreshCw, Trash2, Webhook as WebhookIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { useT } from '../../../lib/i18n'

interface Webhook { id: string; name: string; avatar_url: string | null; created_at: string }
interface Follow { channel_id: string; channel_name: string; guild_id: string; guild_name: string }

/** Channel Settings › Integrations: servers following this announcement channel, and announcement channels this
 * channel follows. */
export default function FollowersTab({ channelId }: { channelId: string }) {
  const t = useT()
  const channel = useStore((s) => s.channels[channelId])
  const pushToast = useStore((s) => s.pushToast)
  const [followers, setFollowers] = useState<Follow[]>([])
  const [following, setFollowing] = useState<Follow[]>([])
  useEffect(() => {
    if (channel?.news) api.get<Follow[]>(`/channels/${channelId}/followers`).then(setFollowers).catch(() => {})
    api.get<Follow[]>(`/channels/${channelId}/following`).then(setFollowing).catch(() => {})
  }, [channelId, channel?.news])
  if (!channel) return null
  const drop = async (source: string, target: string, done: () => void) => { try { await api.delete(`/channels/${source}/followers/${target}`); done() } catch (e) { pushToast((e as Error).message, 'error') } }
  const row = (f: Follow, onRemove: () => void) => (
    <div key={f.channel_id} className="flex items-center gap-3 rounded-lg border border-line bg-bg-1 px-3 py-2 text-sm" data-follow-row={f.channel_id}>
      <Megaphone size={16} className="text-text-2" /><span className="flex-1 truncate"><b>{f.guild_name}</b> · #{f.channel_name}</span>
      <button type="button" className="text-text-2 hover:text-danger" title={t('Remove')} onClick={onRemove} data-follow-remove={f.channel_id}><Trash2 size={16} /></button>
    </div>
  )
  return (
    <div className="space-y-6" data-followers-tab>
      <h1 className="text-xl font-bold">{t('Integrations')}</h1>
      <Webhooks channelId={channelId} />
      {channel.news && (
        <section>
          <h2 className="label">{t('Followers')}</h2>
          <p className="mb-2 text-sm text-text-2">{t("Channels in other servers that get this channel's published posts.")}</p>
          <div className="space-y-2">{followers.length ? followers.map((f) => row(f, () => drop(channelId, f.channel_id, () => setFollowers(followers.filter((x) => x.channel_id !== f.channel_id))))) : <p className="text-sm text-text-2">{t('Nobody follows this channel yet.')}</p>}</div>
        </section>
      )}
      <section>
        <h2 className="label">{t('Followed channels')}</h2>
        <p className="mb-2 text-sm text-text-2">{t('Announcement channels whose published posts show up here.')}</p>
        <div className="space-y-2">{following.length ? following.map((f) => row(f, () => drop(f.channel_id, channelId, () => setFollowing(following.filter((x) => x.channel_id !== f.channel_id))))) : <p className="text-sm text-text-2">{t("This channel doesn't follow any announcement channels.")}</p>}</div>
      </section>
    </div>
  )
}

/** Webhooks: post into this channel from other services with a secret URL. The URL is shown when made or reset. */
function Webhooks({ channelId }: { channelId: string }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<Webhook[]>([])
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null)
  useEffect(() => { api.get<Webhook[]>(`/channels/${channelId}/webhooks`).then(setList).catch(() => setList([])) }, [channelId])
  const urlOf = (id: string, token: string) => `${location.origin}/api/webhooks/${id}/${token}`
  const create = async () => {
    try { const r = await api.post<{ webhook: Webhook; token: string }>(`/channels/${channelId}/webhooks`, { name: `Webhook ${list.length + 1}` }); setList([...list, r.webhook]); setFresh({ id: r.webhook.id, url: urlOf(r.webhook.id, r.token) }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const rename = async (w: Webhook, name: string) => { if (!name.trim() || name === w.name) return; try { const u = await api.patch<Webhook>(`/webhooks/${w.id}`, { name }); setList(list.map((x) => (x.id === w.id ? u : x))) } catch (e) { pushToast((e as Error).message, 'error') } }
  const reset = async (w: Webhook) => { try { const r = await api.post<{ token: string }>(`/webhooks/${w.id}/reset-token`); setFresh({ id: w.id, url: urlOf(w.id, r.token) }); pushToast(t('New URL made; the old one stopped working')) } catch (e) { pushToast((e as Error).message, 'error') } }
  const del = async (w: Webhook) => { try { await api.delete(`/webhooks/${w.id}`); setList(list.filter((x) => x.id !== w.id)) } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <section data-webhooks>
      <div className="mb-2 flex items-center justify-between"><h2 className="label mb-0">{t('Webhooks')}</h2><button type="button" className="btn-primary flex items-center gap-1 py-1" onClick={create} data-webhook-new><Plus size={14} />{t('New Webhook')}</button></div>
      <p className="mb-2 text-sm text-text-2">{t("Let other services post here: anyone with a webhook's URL can, so keep it secret.")}</p>
      <div className="space-y-2">
        {list.length === 0 && <p className="text-sm text-text-2">{t('No webhooks.')}</p>}
        {list.map((w) => (
          <div key={w.id} className="rounded-lg border border-line bg-bg-1 p-3 text-sm" data-webhook={w.id}>
            <div className="flex items-center gap-2">
              <WebhookIcon size={16} className="text-text-2" />
              <input className="input flex-1 py-1" defaultValue={w.name} maxLength={80} onBlur={(e) => rename(w, e.target.value)} data-webhook-name={w.id} />
              <button type="button" className="text-text-2 hover:text-text-0" title={t('Make a new URL')} onClick={() => reset(w)} data-webhook-reset={w.id}><RefreshCw size={15} /></button>
              <button type="button" className="text-text-2 hover:text-danger" title={t('Delete')} onClick={() => del(w)} data-webhook-delete={w.id}><Trash2 size={15} /></button>
            </div>
            {fresh?.id === w.id && (
              <div className="mt-2 flex gap-2">
                <input readOnly className="input flex-1 font-mono text-xs" value={fresh.url} data-webhook-url />
                <button type="button" className="btn-ghost flex items-center gap-1" onClick={() => { void navigator.clipboard?.writeText(fresh.url).catch(() => {}); pushToast(t('Webhook URL copied')) }}><Copy size={14} />{t('Copy')}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

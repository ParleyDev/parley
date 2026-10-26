import { Megaphone, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'

interface Follow { channel_id: string; channel_name: string; guild_id: string; guild_name: string }

/** Channel Settings › Integrations: servers following this announcement channel, and announcement channels this
 * channel follows. */
export default function FollowersTab({ channelId }: { channelId: string }) {
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
      <button type="button" className="text-text-2 hover:text-danger" title="Remove" onClick={onRemove} data-follow-remove={f.channel_id}><Trash2 size={16} /></button>
    </div>
  )
  return (
    <div className="space-y-6" data-followers-tab>
      <h1 className="text-xl font-bold">Integrations</h1>
      {channel.news && (
        <section>
          <h2 className="label">Followers</h2>
          <p className="mb-2 text-sm text-text-2">Channels in other servers that get this channel's published posts.</p>
          <div className="space-y-2">{followers.length ? followers.map((f) => row(f, () => drop(channelId, f.channel_id, () => setFollowers(followers.filter((x) => x.channel_id !== f.channel_id))))) : <p className="text-sm text-text-2">Nobody follows this channel yet.</p>}</div>
        </section>
      )}
      <section>
        <h2 className="label">Followed channels</h2>
        <p className="mb-2 text-sm text-text-2">Announcement channels whose published posts show up here.</p>
        <div className="space-y-2">{following.length ? following.map((f) => row(f, () => drop(f.channel_id, channelId, () => setFollowing(following.filter((x) => x.channel_id !== f.channel_id))))) : <p className="text-sm text-text-2">This channel doesn't follow any announcement channels.</p>}</div>
      </section>
    </div>
  )
}

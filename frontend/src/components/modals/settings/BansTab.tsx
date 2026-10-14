import { Search, ShieldOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import Avatar from '../../Avatar'

export default function BansTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const bans = useStore((s) => s.bans[guildId])
  const loaded = useStore((s) => !!s.bansLoaded[guildId])
  const loadBans = useStore((s) => s.loadBans)
  const removeBan = useStore((s) => s.removeBan)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const [q, setQ] = useState('')
  useEffect(() => { if (!loaded) loadBans(guildId) }, [guildId, loaded, loadBans])
  if (!guild) return null
  const list = Object.values(bans ?? {})
    .filter((b) => !q || b.display_name.toLowerCase().includes(q.toLowerCase()) || b.username.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const unban = (userId: string, name: string) => openModal({
    kind: 'confirm', title: `Revoke ban for ${name}`, body: `${name} will be able to rejoin ${guild.name} with a new invite.`, confirmLabel: 'Revoke Ban',
    action: async () => { try { await api.delete(`/guilds/${guildId}/bans/${userId}`); removeBan(guildId, userId); pushToast(`${name} was unbanned`) } catch (e) { pushToast((e as Error).message, 'error') } },
  })

  return (
    <div>
      <h1 className="text-xl font-bold">Bans</h1>
      <p className="text-sm text-text-2 mt-1">{loaded ? `${list.length} ban${list.length === 1 ? '' : 's'}` : 'Loading…'}</p>
      <div className="relative mt-4 mb-4">
        <input className="input pl-9" placeholder="Search bans" value={q} onChange={(e) => setQ(e.target.value)} />
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
      </div>
      {loaded && list.length === 0 && (
        <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2">No one is banned from {guild.name}.</div>
      )}
      <div className="divide-y divide-line">
        {list.map((b) => (
          <div key={b.user_id} className="py-3 flex items-center gap-3" data-ban={b.user_id}>
            <Avatar user={{ id: b.user_id, display_name: b.display_name, avatar_url: b.avatar_url }} size={36} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">{b.display_name} <span className="text-xs font-normal text-text-2">@{b.username}</span></div>
              <div className="text-xs text-text-2 truncate">
                {new Date(b.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                {b.moderator_name ? ` · by ${b.moderator_name}` : ''}
                {b.reason ? ` · ${b.reason}` : ' · No reason given'}
              </div>
            </div>
            <button onClick={() => unban(b.user_id, b.display_name)} className="btn-ghost py-1.5 shrink-0" title="Revoke ban"><ShieldOff size={16} /><span className="max-md:hidden">Revoke Ban</span></button>
          </div>
        ))}
      </div>
    </div>
  )
}

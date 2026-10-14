import { Crown, Search, UserMinus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { myGuildPerms, useStore } from '../../../store'
import { has, highestPosition, P, EMPTY_ROLES } from '../../../lib/perms'
import StyledName from '../../StyledName'
import Avatar from '../../Avatar'
import RolePicker from '../../RolePicker'

export default function MembersTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const members = useStore((s) => s.members[guildId])
  const loaded = useStore((s) => !!s.membersLoaded[guildId])
  const loadMembers = useStore((s) => s.loadMembers)
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const me = useStore((s) => s.user)
  const myPerms = useStore((s) => myGuildPerms(s, guildId))
  const openModal = useStore((s) => s.openModal)
  const removeMember = useStore((s) => s.removeMember)
  const pushToast = useStore((s) => s.pushToast)
  const [q, setQ] = useState('')
  useEffect(() => { if (!loaded) loadMembers(guildId) }, [guildId, loaded, loadMembers])
  if (!guild || !me) return null
  const myMember = members?.[me.id]
  const ctx = { guild, roles, member: myMember }
  const list = Object.values(members ?? {})
    .filter((m) => !q || m.display_name.toLowerCase().includes(q.toLowerCase()) || m.username.toLowerCase().includes(q.toLowerCase()) || (m.nickname ?? '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.nickname ?? a.display_name).localeCompare(b.nickname ?? b.display_name))

  const kick = (userId: string, name: string) => openModal({
    kind: 'confirm', title: `Kick ${name}`, body: `Are you sure you want to kick ${name} from ${guild.name}? They can rejoin with a new invite.`, danger: true, confirmLabel: 'Kick',
    action: async () => { try { await api.delete(`/guilds/${guildId}/members/${userId}`); removeMember(guildId, userId) } catch (e) { pushToast((e as Error).message, 'error') } },
  })

  return (
    <div>
      <h1 className="text-xl font-bold">Members</h1>
      <p className="text-sm text-text-2 mt-1">{list.length} member{list.length === 1 ? '' : 's'}</p>
      <div className="relative mt-4 mb-4">
        <input className="input pl-9" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} />
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
      </div>
      <div className="divide-y divide-line">
        {list.map((m) => {
          const isOwner = guild.owner_id === m.user_id
          const canKick = has(myPerms, P.KICK_MEMBERS) && m.user_id !== me.id && !isOwner && (guild.owner_id === me.id || highestPosition(ctx, me.id) > highestPosition({ ...ctx, member: m }, m.user_id))
          return (
            <div key={m.user_id} className="py-3 flex items-center gap-3">
              <button onClick={() => openModal({ kind: 'profile', userId: m.user_id })}><Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }} size={36} presence /></button>
              <div className="min-w-0 w-48 max-md:w-32 shrink-0">
                <div className="font-semibold truncate flex items-center gap-1"><StyledName userId={m.user_id} guildId={guildId}>{m.nickname ?? m.display_name}</StyledName>{isOwner && <Crown size={13} className="text-warn shrink-0" />}</div>
                <div className="text-xs text-text-2 truncate">@{m.username}</div>
              </div>
              <div className="flex-1 min-w-0"><RolePicker guildId={guildId} member={m} compact /></div>
              {canKick && <button onClick={() => kick(m.user_id, m.display_name)} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-danger/10 hover:text-danger" title="Kick"><UserMinus size={16} /></button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

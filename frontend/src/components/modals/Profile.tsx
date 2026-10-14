import { Ban, Check, MessageSquare, UserMinus, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import Avatar from '../Avatar'
import { api } from '../../lib/api'
import { myGuildPerms, useStore } from '../../store'
import { has, highestPosition, memberColor, P } from '../../lib/perms'
import RolePicker from '../RolePicker'
import type { DmChannel, User } from '../../lib/types'
import { colorFor } from '../../lib/format'

export default function ProfileModal({ onClose, userId }: { onClose: () => void; userId: string }) {
  const cached = useStore((s) => s.users[userId])
  const rel = useStore((s) => s.relationships[userId]?.kind)
  const me = useStore((s) => s.user)
  const online = useStore((s) => !!s.online[userId])
  const upsertChannel = useStore((s) => s.upsertChannel)
  const removeMember = useStore((s) => s.removeMember)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const { pathname } = useLocation()
  const guildId = matchPath('/channels/:guildId/*', pathname)?.params.guildId
  const inGuild = guildId && guildId !== '@me' ? guildId : undefined
  const guild = useStore((s) => (inGuild ? s.guilds[inGuild] : undefined))
  const member = useStore((s) => (inGuild ? s.members[inGuild]?.[userId] : undefined))
  const myMember = useStore((s) => (inGuild && me ? s.members[inGuild]?.[me.id] : undefined))
  const roles = useStore((s) => (inGuild ? s.roles[inGuild] : undefined) ?? {})
  const myPerms = useStore((s) => (inGuild ? myGuildPerms(s, inGuild) : 0))
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(cached ?? null)
  useEffect(() => { api.get<User>(`/users/${userId}`).then(setUser).catch(() => {}) }, [userId])
  if (!user) return <Modal onClose={onClose}><p className="text-text-2">Loading…</p></Modal>
  const isMe = me?.id === userId
  const dm = async () => {
    try { const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: userId }); upsertChannel(c); onClose(); navigate(`/channels/@me/${c.id}`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const kick = () => openModal({
    kind: 'confirm', title: `Kick ${user.display_name}`, body: `Are you sure you want to kick ${user.display_name} from ${guild?.name}? They can rejoin with a new invite.`, danger: true, confirmLabel: 'Kick',
    action: async () => { try { await api.delete(`/guilds/${inGuild}/members/${userId}`); removeMember(inGuild!, userId) } catch (e) { pushToast((e as Error).message, 'error') } },
  })
  const joined = member ? new Date(member.joined_at) : null
  const relAct = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } }
  const addFriend = () => relAct(() => api.post('/users/@me/relationships', { user_id: userId }))
  const acceptFriend = () => relAct(() => api.put(`/users/@me/relationships/${userId}`))
  const removeRel = () => relAct(() => api.delete(`/users/@me/relationships/${userId}`))
  const blockUser = () => openModal({ kind: 'confirm', title: `Block ${user.display_name}`, body: `${user.display_name} will not be able to message you or send you friend requests. Any friendship or pending request is removed.`, danger: true, confirmLabel: 'Block', action: () => relAct(() => api.put(`/users/@me/relationships/${userId}/block`)) })
  const ctx = guild ? { guild, roles, member: myMember } : null
  const canKick = !!(guild && ctx && me && !isMe && has(myPerms, P.KICK_MEMBERS) && guild.owner_id !== userId && (guild.owner_id === me.id || highestPosition(ctx, me.id) > highestPosition({ ...ctx, member }, userId)))
  const nameColor = memberColor(roles, member)
  return (
    <Modal onClose={onClose} width="max-w-sm">
      <div className="-mx-6 -mt-4">
        <div className="h-24" style={{ background: `linear-gradient(135deg, ${colorFor(user.id)}, #6d5dfc)` }} />
        <div className="px-5 -mt-10 flex items-end justify-between">
          <div className="rounded-full ring-[6px] ring-bg-1 bg-bg-1"><Avatar user={user} size={80} presence /></div>
          <div className="flex gap-2 pb-1">
            {!isMe && rel !== 'blocked' && <button onClick={dm} className="btn-primary py-1.5"><MessageSquare size={16} /> Message</button>}
            {!isMe && !rel && <button onClick={addFriend} className="btn-primary bg-success hover:bg-success/80 text-black py-1.5" title="Add Friend"><UserPlus size={16} /></button>}
            {!isMe && rel === 'incoming' && <button onClick={acceptFriend} className="btn-primary bg-success hover:bg-success/80 text-black py-1.5" title="Accept Friend Request"><Check size={16} /> Accept</button>}
            {!isMe && rel === 'outgoing' && <button onClick={removeRel} className="btn-ghost py-1.5 border border-line" title="Cancel Friend Request"><X size={16} /> Pending</button>}
            {!isMe && rel === 'friend' && <button onClick={removeRel} className="btn-ghost py-1.5 border border-line" title="Remove Friend"><Check size={16} /> Friends</button>}
            {!isMe && rel === 'blocked' && <button onClick={removeRel} className="btn-ghost py-1.5 border border-line" title="Unblock"><Ban size={16} /> Unblock</button>}
            {!isMe && rel !== 'blocked' && <button onClick={blockUser} className="btn-ghost py-1.5 text-text-2 hover:text-danger" title="Block"><Ban size={16} /></button>}
            {canKick && <button onClick={kick} className="btn-danger py-1.5" title="Kick"><UserMinus size={16} /></button>}
          </div>
        </div>
        <div className="px-5 pt-3 pb-2">
          <h2 className="text-xl font-bold leading-tight" style={{ color: nameColor ?? undefined }}>{member?.nickname ?? user.display_name}</h2>
          <p className="text-sm text-text-1">@{user.username} <span className="text-text-2">· {online ? 'Online' : 'Offline'}</span></p>
          <div className="mt-4 rounded-xl bg-bg-0/50 p-3 space-y-3">
            {inGuild && member && <div><div className="label">Roles</div><RolePicker guildId={inGuild} member={member} /></div>}
            {user.bio && <div><div className="label">About me</div><p className="text-sm whitespace-pre-wrap">{user.bio}</p></div>}
            <div className="flex gap-6">
              <div><div className="label">Member since</div><p className="text-sm">{new Date(user.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</p></div>
              {joined && <div><div className="label">Joined server</div><p className="text-sm">{joined.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</p></div>}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

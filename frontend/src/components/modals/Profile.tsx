import { Ban, Check, Gavel, MessageSquare, UserMinus, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { myGuildPerms, useStore } from '../../store'
import type { DmChannel, User } from '../../lib/types'
import { has, highestPosition, P, EMPTY_ROLES } from '../../lib/perms'
import { colorRole, nameCss } from '../StyledName'
import RolePicker from '../RolePicker'
import ProfileCard, { contrastText } from '../ProfileCard'
import { colorFor } from '../../lib/format'

export default function ProfileModal({ onClose, userId }: { onClose: () => void; userId: string }) {
  const cached = useStore((s) => s.users[userId])
  const rel = useStore((s) => s.relationships[userId]?.kind)
  const me = useStore((s) => s.user)
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
  const roles = useStore((s) => (inGuild ? s.roles[inGuild] : undefined) ?? EMPTY_ROLES)
  const myPerms = useStore((s) => (inGuild ? myGuildPerms(s, inGuild) : 0))
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(cached ?? null)
  // The cached copy may be partial (built from a member row), so always fetch the full profile,
  // and refetch whenever the cached copy changes (USER_UPDATE, member list load).
  useEffect(() => { api.get<User>(`/users/${userId}`).then(setUser).catch(() => {}) }, [userId, cached])
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
  const ctx = guild ? { guild, roles, member: myMember } : null
  const outranks = !!(guild && ctx && me && !isMe && member && guild.owner_id !== userId && (guild.owner_id === me.id || highestPosition(ctx, me.id) > highestPosition({ ...ctx, member }, userId)))
  const canKick = outranks && has(myPerms, P.KICK_MEMBERS)
  const canBan = outranks && has(myPerms, P.BAN_MEMBERS)
  const ban = () => openModal({ kind: 'ban', guildId: inGuild!, userId })
  const roleForName = colorRole(roles, member)
  const roleNameStyle = roleForName ? nameCss(roleForName.color, roleForName.color_accent) : undefined
  const relAct = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } }
  const addFriend = () => relAct(() => api.post('/users/@me/relationships', { user_id: userId }))
  const acceptFriend = () => relAct(() => api.put(`/users/@me/relationships/${userId}`))
  const removeRel = () => relAct(() => api.delete(`/users/@me/relationships/${userId}`))
  const blockUser = () => openModal({ kind: 'confirm', title: `Block ${user.display_name}`, body: `${user.display_name} will not be able to message you or send you friend requests. Any friendship or pending request is removed.`, danger: true, confirmLabel: 'Block', action: () => relAct(() => api.put(`/users/@me/relationships/${userId}/block`)) })

  const text = contrastText(user.theme_primary ?? colorFor(user.id))
  const ghost = `btn px-3! py-1.5 border ${text === '#fff' ? 'border-white/30 bg-black/30 text-white hover:bg-black/50' : 'border-black/20 bg-white/40 text-black hover:bg-white/60'}`
  const actions = !isMe && (
    <>
      {rel !== 'blocked' && <button onClick={dm} className="btn-primary px-3! py-1.5" title="Message"><MessageSquare size={16} /></button>}
      {!rel && <button onClick={addFriend} className="btn-primary bg-success hover:bg-success/80 text-black px-3! py-1.5" title="Add Friend"><UserPlus size={16} /></button>}
      {rel === 'incoming' && <button onClick={acceptFriend} className="btn-primary bg-success hover:bg-success/80 text-black px-3! py-1.5" title="Accept Friend Request"><Check size={16} /> Accept</button>}
      {rel === 'outgoing' && <button onClick={removeRel} className={ghost} title="Cancel Friend Request"><X size={16} /> Pending</button>}
      {rel === 'friend' && <button onClick={removeRel} className={ghost} title="Remove Friend"><Check size={16} /> Friends</button>}
      {rel === 'blocked' && <button onClick={removeRel} className={ghost} title="Unblock"><Ban size={16} /> Unblock</button>}
      {rel !== 'blocked' && <button onClick={blockUser} className={ghost} title="Block"><Ban size={16} /></button>}
      {canKick && <button onClick={kick} className="btn-danger px-3! py-1.5" title="Kick"><UserMinus size={16} /></button>}
      {canBan && <button onClick={ban} className="btn-danger px-3! py-1.5" title="Ban"><Gavel size={16} /></button>}
    </>
  )

  return (
    <Modal onClose={onClose} width="max-w-sm">
      <div className="-mx-6 -mt-4 -mb-4">
        <ProfileCard user={user} actions={actions} nameOverride={member?.nickname ? member.nickname : null} nameStyle={roleNameStyle}>
          {joined && <div><div className="text-[11px] font-bold uppercase tracking-wider opacity-70">Joined server</div><p>{joined.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</p></div>}
          {inGuild && member && <div className="w-full"><div className="text-[11px] font-bold uppercase tracking-wider opacity-70 mb-1">Roles</div><RolePicker guildId={inGuild} member={member} /></div>}
        </ProfileCard>
      </div>
    </Modal>
  )
}

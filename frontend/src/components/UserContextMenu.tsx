import { Ban, Copy, Gavel, MessageSquare, User as UserIcon, UserCheck, UserMinus, UserPlus, UserX } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { has, highestPosition, P, EMPTY_ROLES } from '../lib/perms'
import type { DmChannel } from '../lib/types'
import { myGuildPerms, useStore } from '../store'
import type { MenuEntry } from './ContextMenu'

export interface MenuUser { id: string; display_name: string; nickname?: string | null }

/**
 * Right-click menu for a user anywhere (member list, DM list, message author): profile, message,
 * friend actions, block, and kick/ban when inside a server you moderate.
 */
export function useUserMenu(guildId?: string | null) {
  const me = useStore((s) => s.user)
  const relationships = useStore((s) => s.relationships)
  const guild = useStore((s) => (guildId ? s.guilds[guildId] : undefined))
  const roles = useStore((s) => (guildId ? s.roles[guildId] ?? EMPTY_ROLES : EMPTY_ROLES))
  const members = useStore((s) => (guildId ? s.members[guildId] : undefined))
  const myPerms = useStore((s) => (guildId ? myGuildPerms(s, guildId) : 0))
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const removeMember = useStore((s) => s.removeMember)
  const navigate = useNavigate()
  const act = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } }

  return (u: MenuUser, anchor?: DOMRect | null): MenuEntry[] => {
    const name = u.nickname ?? u.display_name
    const isMe = me?.id === u.id
    const rel = relationships[u.id]?.kind
    const member = members?.[u.id], myMember = me ? members?.[me.id] : undefined
    const outranks = !!(guild && me && !isMe && member && guild.owner_id !== u.id && (guild.owner_id === me.id || highestPosition({ guild, roles, member: myMember }, me.id) > highestPosition({ guild, roles, member }, u.id)))
    const copy = (label: string, text: string) => act(async () => { await navigator.clipboard.writeText(text); pushToast(`${label} copied`) })
    const profile = () => openModal({ kind: 'profile', userId: u.id, anchor: anchor ? { x: anchor.left, y: anchor.top, w: anchor.width, h: anchor.height } : undefined })
    const message = () => act(async () => { const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: u.id }); upsertChannel(c); navigate(`/channels/@me/${c.id}`) })
    const block = () => openModal({ kind: 'confirm', title: `Block ${name}`, body: `${name} will not be able to message you or send you friend requests. Any friendship or pending request is removed.`, danger: true, confirmLabel: 'Block', action: () => act(() => api.put(`/users/@me/relationships/${u.id}/block`)) })
    const kick = () => openModal({ kind: 'confirm', title: `Kick ${name}`, body: `Are you sure you want to kick ${name} from ${guild?.name}? They can rejoin with a new invite.`, danger: true, confirmLabel: 'Kick', action: () => act(async () => { await api.delete(`/guilds/${guildId}/members/${u.id}`); removeMember(guildId!, u.id) }) })
    if (isMe) {
      return [
        { label: 'Profile', icon: <UserIcon size={16} />, onClick: profile },
        { label: 'Edit Profile', onClick: () => openModal({ kind: 'userSettings', tab: 'profile' }) },
        'sep',
        { label: 'Copy User ID', icon: <Copy size={16} />, onClick: () => copy('User ID', u.id) },
      ]
    }
    return [
      { label: 'Profile', icon: <UserIcon size={16} />, onClick: profile },
      { label: 'Message', icon: <MessageSquare size={16} />, onClick: message },
      'sep',
      ...(rel === undefined ? [{ label: 'Add Friend', icon: <UserPlus size={16} />, onClick: () => act(() => api.post('/users/@me/relationships', { user_id: u.id })) }] : []),
      ...(rel === 'incoming' ? [{ label: 'Accept Friend Request', icon: <UserCheck size={16} />, onClick: () => act(() => api.put(`/users/@me/relationships/${u.id}`)) }] : []),
      ...(rel === 'outgoing' ? [{ label: 'Cancel Friend Request', icon: <UserX size={16} />, onClick: () => act(() => api.delete(`/users/@me/relationships/${u.id}`)) }] : []),
      ...(rel === 'friend' ? [{ label: 'Remove Friend', icon: <UserMinus size={16} />, danger: true, onClick: () => act(() => api.delete(`/users/@me/relationships/${u.id}`)) }] : []),
      rel === 'blocked' ? { label: 'Unblock', icon: <Ban size={16} />, onClick: () => act(() => api.delete(`/users/@me/relationships/${u.id}`)) } : { label: 'Block', icon: <Ban size={16} />, danger: true, onClick: block },
      ...(outranks && (has(myPerms, P.KICK_MEMBERS) || has(myPerms, P.BAN_MEMBERS)) ? ['sep' as const] : []),
      ...(outranks && has(myPerms, P.KICK_MEMBERS) ? [{ label: `Kick ${name}`, icon: <UserMinus size={16} />, danger: true, onClick: kick }] : []),
      ...(outranks && has(myPerms, P.BAN_MEMBERS) ? [{ label: `Ban ${name}`, icon: <Gavel size={16} />, danger: true, onClick: () => openModal({ kind: 'ban', guildId: guildId!, userId: u.id }) }] : []),
      'sep',
      { label: 'Copy User ID', icon: <Copy size={16} />, onClick: () => copy('User ID', u.id) },
    ]
  }
}

import { AtSign, Ban, Copy, Flag, Gavel, MessageSquare, NotebookPen, Pencil, Phone, Send, Shield, TimerOff, TimerReset, User as UserIcon, UserCheck, UserMinus, UserPlus, UserX } from 'lucide-react'
import { getPrefs } from '../lib/prefs'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { canManageRole, has, highestPosition, isTimedOut, P, EMPTY_ROLES } from '../lib/perms'
import { voice } from '../lib/voice'
import { publicOrigin } from './InviteCard'
import type { DmChannel, Invite, Member } from '../lib/types'
import { myGuildPerms, useStore } from '../store'
import type { MenuEntry } from './ContextMenu'

export interface MenuUser { id: string; display_name: string; nickname?: string | null; bot?: boolean }

/** Put `@name` in the open message box; the composer turns it into a mention on send (see Composer). */
export function mentionInComposer(id: string, label: string) {
  window.dispatchEvent(new CustomEvent('parley:mention', { detail: { id, label } }))
}

/**
 * Right-click menu for a user anywhere (member list, DM list, message author): profile, mention, message, call,
 * note, nickname, roles, invite to a server, friend actions, block, and kick/ban when inside a server you moderate.
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
  const upsertMember = useStore((s) => s.upsertMember)
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
    const call = () => act(async () => { const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: u.id }); upsertChannel(c); navigate(`/channels/@me/${c.id}`); await voice.join(c.id) })
    const hasComposer = !!document.querySelector('textarea.composer-input')
    const mention = hasComposer ? [{ label: 'Mention', icon: <AtSign size={16} />, onClick: () => mentionInComposer(u.id, name) }] : []
    // Change Nickname: your own with Change Nickname, someone else's with Manage Nicknames when you outrank them.
    const canNick = !!guildId && !!member && (isMe ? has(myPerms, P.CHANGE_NICKNAME) : outranks && has(myPerms, P.MANAGE_NICKNAMES))
    const nickname = canNick ? [{ label: 'Change Nickname', icon: <Pencil size={16} />, onClick: () => openModal({ kind: 'nickname', guildId: guildId!, userId: u.id }) }] : []
    // Roles: tick any role below your highest one (Manage Roles); @everyone isn't a role you hand out.
    const ctx = guild && me ? { guild, roles, member: myMember } : null
    const assignable = ctx && member && has(myPerms, P.MANAGE_ROLES)
      ? Object.values(roles).filter((r) => r.id !== guild!.id).sort((a, b) => b.position - a.position) : []
    const toggleRole = (rid: string) => act(async () => {
      const cur = member!.roles
      const next = cur.includes(rid) ? cur.filter((x) => x !== rid) : [...cur, rid]
      upsertMember(await api.patch<Member>(`/guilds/${guildId}/members/${u.id}`, { roles: next }))
    })
    const roleMenu = assignable.length ? [{ label: 'Roles', icon: <Shield size={16} />, children: assignable.map((r) => ({
      label: `${member!.roles.includes(r.id) ? '✓ ' : ''}${r.name}`, disabled: !canManageRole(ctx!, me!.id, r), onClick: () => toggleRole(r.id),
    })) }] : []
    // Invite to Server: a week-long invite to any server you can invite to, sent to them in a DM.
    const st = useStore.getState()
    const invitable = isMe ? [] : Object.values(st.guilds).filter((g) => g.id !== guildId && has(myGuildPerms(st, g.id), P.CREATE_INVITE))
    const invite = (gid: string, gname: string) => act(async () => {
      const inv = await api.post<Invite>(`/guilds/${gid}/invites`, { max_age: 7 * 86400, max_uses: 0 })
      const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: u.id }); upsertChannel(c)
      await api.post(`/channels/${c.id}/messages`, { content: `${publicOrigin()}/invite/${inv.code}` })
      pushToast(`Invited ${name} to ${gname}`)
    })
    const inviteMenu = invitable.length ? [{ label: 'Invite to Server', icon: <Send size={16} />, children: invitable.map((g) => ({ label: g.name, onClick: () => invite(g.id, g.name) })) }] : []
    const kick = () => openModal({ kind: 'kick', guildId: guildId!, userId: u.id })
    if (isMe) {
      return [
        { label: 'Profile', icon: <UserIcon size={16} />, onClick: profile },
        ...mention,
        { label: 'Edit Profile', onClick: () => openModal({ kind: 'userSettings', tab: 'profile' }) },
        ...nickname,
        ...roleMenu,
        ...(getPrefs().developerMode ? ['sep' as const, { label: 'Copy User ID', icon: <Copy size={16} />, onClick: () => copy('User ID', u.id) }] : []),
      ]
    }
    return [
      { label: 'Profile', icon: <UserIcon size={16} />, onClick: profile },
      ...mention,
      { label: 'Message', icon: <MessageSquare size={16} />, onClick: message },
      ...(rel !== 'blocked' && !u.bot ? [{ label: 'Call', icon: <Phone size={16} />, onClick: call }] : []),
      { label: 'Add Note', icon: <NotebookPen size={16} />, onClick: profile },
      ...(nickname.length || roleMenu.length || inviteMenu.length ? ['sep' as const] : []),
      ...nickname,
      ...roleMenu,
      ...inviteMenu,
      'sep',
      ...(rel === undefined ? [{ label: 'Add Friend', icon: <UserPlus size={16} />, onClick: () => act(() => api.post('/users/@me/relationships', { user_id: u.id })) }] : []),
      ...(rel === 'incoming' ? [{ label: 'Accept Friend Request', icon: <UserCheck size={16} />, onClick: () => act(() => api.put(`/users/@me/relationships/${u.id}`)) }] : []),
      ...(rel === 'outgoing' ? [{ label: 'Cancel Friend Request', icon: <UserX size={16} />, onClick: () => act(() => api.delete(`/users/@me/relationships/${u.id}`)) }] : []),
      ...(rel === 'friend' ? [{ label: 'Remove Friend', icon: <UserMinus size={16} />, danger: true, onClick: () => act(() => api.delete(`/users/@me/relationships/${u.id}`)) }] : []),
      rel === 'blocked' ? { label: 'Unblock', icon: <Ban size={16} />, onClick: () => act(() => api.delete(`/users/@me/relationships/${u.id}`)) } : { label: 'Block', icon: <Ban size={16} />, danger: true, onClick: block },
      { label: 'Report User', icon: <Flag size={16} />, danger: true, onClick: () => openModal({ kind: 'report', userId: u.id, name }) },
      ...(outranks && (has(myPerms, P.KICK_MEMBERS) || has(myPerms, P.BAN_MEMBERS) || has(myPerms, P.MODERATE_MEMBERS)) ? ['sep' as const] : []),
      ...(outranks && has(myPerms, P.MODERATE_MEMBERS) ? [isTimedOut(member)
        ? { label: 'Remove Timeout', icon: <TimerOff size={16} />, onClick: () => act(async () => { upsertMember(await api.delete(`/guilds/${guildId}/members/${u.id}/timeout`)); pushToast(`Timeout removed for ${name}`) }) }
        : { label: `Timeout ${name}`, icon: <TimerReset size={16} />, danger: true, onClick: () => openModal({ kind: 'timeout', guildId: guildId!, userId: u.id }) }] : []),
      ...(outranks && has(myPerms, P.KICK_MEMBERS) ? [{ label: `Kick ${name}`, icon: <UserMinus size={16} />, danger: true, onClick: kick }] : []),
      ...(outranks && has(myPerms, P.BAN_MEMBERS) ? [{ label: `Ban ${name}`, icon: <Gavel size={16} />, danger: true, onClick: () => openModal({ kind: 'ban', guildId: guildId!, userId: u.id }) }] : []),
      ...(getPrefs().developerMode ? ['sep' as const, { label: 'Copy User ID', icon: <Copy size={16} />, onClick: () => copy('User ID', u.id) }] : []),
    ]
  }
}

import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { EMPTY_ROLES } from '../lib/perms'

/** `<@id>`: the user's server nickname or display name as a pill; click opens the profile. */
export function UserMention({ id }: { id: string }) {
  const openModal = useStore((s) => s.openModal)
  const name = useStore((s) => { const g = Object.values(s.members).find((m) => m[id])?.[id]; return g?.nickname ?? s.users[id]?.display_name ?? g?.display_name })
  const me = useStore((s) => s.user?.id === id)
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); openModal({ kind: 'profile', userId: id, anchor: { x: e.clientX, y: e.clientY, w: 0, h: 0 } }) }}
      className={`mention ${me ? 'mention-me' : ''}`} data-mention-user={id}>@{name ?? 'unknown-user'}</button>
  )
}

/** `<@&id>`: a role pill in the role's colour. */
export function RoleMention({ id }: { id: string }) {
  const role = useStore((s) => { for (const g of Object.values(s.roles)) if (g[id]) return g[id]; return undefined })
  const mine = useStore((s) => !!s.user && Object.values(s.members).some((m) => m[s.user!.id]?.roles.includes(id)))
  void EMPTY_ROLES
  const color = role?.color ?? undefined
  return <span className={`mention ${mine ? 'mention-me' : ''}`} style={color ? { color, background: `${color}26` } : undefined} data-mention-role={id}>@{role?.name ?? 'deleted-role'}</span>
}

/** `<#id>`: a channel pill that navigates. */
export function ChannelMention({ id }: { id: string }) {
  const navigate = useNavigate()
  const ch = useStore((s) => s.channels[id])
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); if (ch?.guild_id) navigate(`/channels/${ch.guild_id}/${ch.id}`) }} className="mention" data-mention-channel={id}>
      #{ch?.name ?? 'deleted-channel'}
    </button>
  )
}

export function EveryoneMention({ kind }: { kind: 'everyone' | 'here' }) {
  return <span className="mention mention-me" data-mention-everyone={kind}>@{kind}</span>
}

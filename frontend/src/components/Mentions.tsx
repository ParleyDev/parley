import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import Avatar from './Avatar'
import { useStore } from '../store'
import { EMPTY_ROLES } from '../lib/perms'
import { useT } from '../lib/i18n'

/** `<@id>`: the user's server nickname or display name as a pill; click opens the profile. */
export function UserMention({ id }: { id: string }) {
  const openModal = useStore((s) => s.openModal)
  const name = useStore((s) => { const g = Object.values(s.members).find((m) => m[id])?.[id]; return g?.nickname || s.users[id]?.display_name || g?.display_name })
  const me = useStore((s) => s.user?.id === id)
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); openModal({ kind: 'profile', userId: id, anchor: { x: e.clientX, y: e.clientY, w: 0, h: 0 } }) }}
      className={`mention ${me ? 'mention-me' : ''}`} data-mention-user={id}>@{name ?? 'unknown-user'}</button>
  )
}

/** `<@&id>`: a role pill in the role's colour; clicking it lists who has the role. */
export function RoleMention({ id }: { id: string }) {
  const role = useStore((s) => { for (const g of Object.values(s.roles)) if (g[id]) return g[id]; return undefined })
  const mine = useStore((s) => !!s.user && Object.values(s.members).some((m) => m[s.user!.id]?.roles.includes(id)))
  const openModal = useStore((s) => s.openModal)
  const [at, setAt] = useState<DOMRect | null>(null)
  const [people, setPeople] = useState<RoleHolder[] | null>(null)
  const t = useT()
  void EMPTY_ROLES
  const color = role?.color ?? undefined
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!role) return
    setAt(e.currentTarget.getBoundingClientRect()); setPeople(null)
    api.get<RoleHolder[]>(`/guilds/${role.guild_id}/roles/${id}/members`).then(setPeople).catch(() => setPeople([]))
  }
  return (
    <>
      <button type="button" onClick={open} className={`mention ${mine ? 'mention-me' : ''}`} style={color ? { color, background: `${color}26` } : undefined} data-mention-role={id}>@{role?.name ?? 'deleted-role'}</button>
      {at && createPortal(
        <>
          <div className="fixed inset-0 z-[120]" onMouseDown={() => setAt(null)} />
          <div role="dialog" aria-label={t('Members with {name}', { name: role?.name ?? '' })} className="pop fixed z-[130] w-64 max-h-80 overflow-y-auto rounded-lg border border-white/5 bg-[#111214] p-2 shadow-2xl"
            style={{ left: Math.min(at.left, window.innerWidth - 272), top: at.bottom + 6 > window.innerHeight - 330 ? Math.max(8, at.top - 326) : at.bottom + 6 }} data-role-members={id}>
            <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{role?.name}{people ? ` · ${people.length}${people.length === 200 ? '+' : ''}` : ''}</div>
            {people === null ? <p className="px-1 py-2 text-sm text-text-2">{t('Loading…')}</p> : people.length === 0 ? <p className="px-1 py-2 text-sm text-text-2">{t('Nobody has this role.')}</p> : people.map((p) => (
              <button key={p.id} type="button" onClick={(e) => { setAt(null); openModal({ kind: 'profile', userId: p.id, anchor: { x: e.clientX, y: e.clientY, w: 0, h: 0 } }) }} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-bg-3" data-role-member={p.id}>
                <Avatar user={p} size={22} /><span className="truncate">{p.nickname || p.display_name}</span>
              </button>
            ))}
          </div>
        </>, document.body)}
    </>
  )
}

interface RoleHolder { id: string; display_name: string; avatar_url: string | null; nickname: string | null }

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

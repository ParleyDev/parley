import { Check, ChevronRight, Clock, Crown, UserCheck, Gavel, MoreHorizontal, Pencil, Smile, UserMinus, UserPlus, UserX } from 'lucide-react'
import { nameLook } from '../lib/nameStyle'
import { roleLook } from './StyledName'
import { locale } from '../lib/i18n'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../lib/api'
import { myGuildPerms, useStore } from '../store'
import type { DmChannel, Guild, Member, UserProfile } from '../lib/types'
import { has, highestPosition, P, EMPTY_ROLES } from '../lib/perms'
import { colorFor, initials, renderMarkdown } from '../lib/format'
import ExpressionPicker from './ExpressionPicker'
import Avatar from './Avatar'
import { publicOrigin } from './InviteCard'
import { Badges, ClanTag } from './Flair'
import { colorRole } from './StyledName'

export const POPOUT_W = 300

interface Props {
  user: UserProfile
  /** Server the popout was opened in, if any. */
  guildId?: string
  onClose: () => void
  /** 'panel': the DM side panel — no message box, adds Member Since and a View Full Profile button. */
  variant?: 'popout' | 'panel'
}

/**
 * Discord's compact profile popout: banner with add-friend and "…" buttons, avatar, name,
 * "username • pronouns", a clamped bio with "View Full Bio", mutual servers, and a
 * "Message @user" box. Everything else lives in the full profile ("View Full Profile").
 */
export default function ProfilePopout({ user, guildId, onClose, variant = 'popout' }: Props) {
  const panel = variant === 'panel'
  const me = useStore((s) => s.user)
  const rel = useStore((s) => s.relationships[user.id]?.kind)
  const guild = useStore((s) => (guildId ? s.guilds[guildId] : undefined))
  const member = useStore((s) => (guildId ? s.members[guildId]?.[user.id] : undefined))
  const myMember = useStore((s) => (guildId && me ? s.members[guildId]?.[me.id] : undefined))
  const roles = useStore((s) => (guildId ? s.roles[guildId] : undefined) ?? EMPTY_ROLES)
  const myPerms = useStore((s) => (guildId ? myGuildPerms(s, guildId) : 0))
  // useShallow: the mapped array is new each render, which would otherwise re-render forever (React #185).
  const myGuilds = useStore(useShallow((s) => s.guildOrder.map((id) => s.guilds[id]).filter((g): g is Guild => !!g)))
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const removeMember = useStore((s) => s.removeMember)
  const sendMessage = useStore((s) => s.sendMessage)
  const navigate = useNavigate()
  const [quick, setQuick] = useState('')
  const [sending, setSending] = useState(false)
  const [emoji, setEmoji] = useState<DOMRect | null>(null)
  const [menu, setMenu] = useState(false)
  const [friendMenu, setFriendMenu] = useState(false)
  const [bioClamped, setBioClamped] = useState(false)
  const bioRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { const el = bioRef.current; if (el) setBioClamped(el.scrollHeight > el.clientHeight + 1) }, [user.bio])

  const isMe = me?.id === user.id
  const ctx = guild ? { guild, roles, member: myMember } : null
  const outranks = !!(guild && ctx && me && !isMe && member && guild.owner_id !== user.id && (guild.owner_id === me.id || highestPosition(ctx, me.id) > highestPosition({ ...ctx, member }, user.id)))
  const canKick = outranks && has(myPerms, P.KICK_MEMBERS)
  const canBan = outranks && has(myPerms, P.BAN_MEMBERS)
  const roleForName = colorRole(roles, member as Member | undefined)
  const look = roleForName ? roleLook(roleForName) : nameLook(user)
  const nameStyle = look.style

  const themed = !!user.theme_primary
  const primary = user.theme_primary ?? colorFor(user.id)
  const gradient = `linear-gradient(135deg, ${primary}, ${user.theme_accent ?? primary})`
  const cardStyle = themed
    ? { background: `linear-gradient(rgba(17,18,20,0.78), rgba(17,18,20,0.78)), ${gradient}`, borderColor: primary }
    : { background: '#232428', borderColor: 'rgba(255,255,255,0.06)' }

  const act = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } }
  const openDm = async () => { const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: user.id }); upsertChannel(c); return c }
  const sendQuick = async () => {
    const text = quick.trim()
    if (!text || sending) return
    setSending(true)
    try { const c = await openDm(); await sendMessage(c.id, text); onClose(); navigate(`/channels/@me/${c.id}`) } catch (e) { pushToast((e as Error).message, 'error') } finally { setSending(false) }
  }
  const onQuickKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); sendQuick() } }
  const copy = (label: string, text: string) => act(async () => { await navigator.clipboard.writeText(text); pushToast(`${label} copied`) })
  const fullProfile = () => { onClose(); openModal({ kind: 'profile', userId: user.id }) }
  const invite = (g: Guild) => act(async () => {
    const inv = await api.post<{ code: string }>(`/guilds/${g.id}/invites`, {})
    const c = await openDm()
    await sendMessage(c.id, `${publicOrigin()}/invite/${inv.code}`)
    pushToast(`Invite to ${g.name} sent`)
  })
  const kick = () => { onClose(); openModal({ kind: 'confirm', title: `Kick ${user.display_name}`, body: `Are you sure you want to kick ${user.display_name} from ${guild?.name}? They can rejoin with a new invite.`, danger: true, confirmLabel: 'Kick', action: () => act(async () => { await api.delete(`/guilds/${guildId}/members/${user.id}`); removeMember(guildId!, user.id) }) }) }
  const ban = () => { onClose(); openModal({ kind: 'ban', guildId: guildId!, userId: user.id }) }
  const block = () => { onClose(); openModal({ kind: 'confirm', title: `Block ${user.display_name}`, body: `${user.display_name} will not be able to message you or send you friend requests. Any friendship or pending request is removed.`, danger: true, confirmLabel: 'Block', action: () => act(() => api.put(`/users/@me/relationships/${user.id}/block`)) }) }

  const friendBtn = !isMe && (
    rel === 'friend' ? { title: 'Friend', icon: <UserCheck size={18} />, fn: () => setFriendMenu((m) => !m) }
    : rel === undefined ? { title: 'Add Friend', icon: <UserPlus size={18} />, fn: () => act(() => api.post('/users/@me/relationships', { user_id: user.id })) }
    : rel === 'incoming' ? { title: 'Accept Friend Request', icon: <Check size={18} />, fn: () => act(() => api.put(`/users/@me/relationships/${user.id}`)) }
    : rel === 'outgoing' ? { title: 'Cancel Friend Request', icon: <Clock size={18} />, fn: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) }
    : null)

  const mutual = user.mutual_guilds ?? []
  const friends = user.mutual_friends ?? []
  const reviewCount = user.review_count ?? 0
  const inviteTargets = myGuilds.filter((g) => !mutual.some((m) => m.id === g.id))
  const friendNote = useStore((s) => s.notes[user.id])
  const setNote = useStore((s) => s.setNote)
  const nickname = member?.nickname ?? friendNote?.nickname ?? null
  const [nickEdit, setNickEdit] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const saveNick = () => { const v = nickEdit ?? ''; setNickEdit(null); if (v.trim() === (friendNote?.nickname ?? '')) return; act(() => setNote(user.id, { nickname: v })) }
  const saveNoteText = () => { const v = noteDraft; setNoteDraft(null); if (v === null || v === (friendNote?.note ?? '')) return; act(() => setNote(user.id, { note: v })) }

  const menuItems: MenuEntry[] = isMe
    ? [
      { label: 'Edit Profile', icon: <Pencil size={16} />, onClick: () => { onClose(); openModal({ kind: 'userSettings', tab: 'profile' }) } },
      'sep',
      copyMenu(),
    ]
    : [
      { label: 'View Full Profile', onClick: fullProfile },
      ...(inviteTargets.length ? [{ label: 'Invite to Server', children: inviteTargets.map((g) => ({ label: g.name, icon: <GuildDot g={g} />, onClick: () => invite(g) })) }] : []),
      'sep',
      ...(rel === undefined ? [{ label: 'Add Friend', onClick: () => act(() => api.post('/users/@me/relationships', { user_id: user.id })) }] : []),
      ...(rel === 'incoming' ? [{ label: 'Accept Friend Request', onClick: () => act(() => api.put(`/users/@me/relationships/${user.id}`)) }] : []),
      ...(rel === 'outgoing' ? [{ label: 'Cancel Friend Request', onClick: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) }] : []),
      ...(rel === 'friend' ? [{ label: 'Remove Friend', danger: true, onClick: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) }] : []),
      rel === 'blocked' ? { label: 'Unblock', onClick: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) } : { label: 'Block', danger: true, onClick: block },
      ...(canKick || canBan ? ['sep' as const] : []),
      ...(canKick ? [{ label: `Kick ${nickname ?? user.display_name}`, danger: true, icon: <UserMinus size={16} />, onClick: kick }] : []),
      ...(canBan ? [{ label: `Ban ${nickname ?? user.display_name}`, danger: true, icon: <Gavel size={16} />, onClick: ban }] : []),
      'sep',
      copyMenu(),
    ]
  function copyMenu(): MenuEntry {
    return { label: 'Copy User Info', children: [
      { label: 'Copy User ID', onClick: () => copy('User ID', user.id) },
      { label: 'Copy Profile Link', onClick: () => copy('Profile link', `${location.origin}/users/${user.id}`) },
      ...(user.avatar_url ? [{ label: 'Copy Avatar Image Link', onClick: () => copy('Avatar link', new URL(user.avatar_url!, location.origin).href) }] : []),
      ...(user.banner_url ? [{ label: 'Copy Banner Image Link', onClick: () => copy('Banner link', new URL(user.banner_url!, location.origin).href) }] : []),
    ] }
  }

  return (
    <div className="relative w-full rounded-lg border text-[#dbdee1] shadow-2xl overflow-visible" style={cardStyle} data-profile-card>
      {/* Banner with overlaid buttons */}
      <div className="relative h-[105px] rounded-t-lg bg-cover bg-center" style={user.banner_url ? { backgroundImage: `url(${user.banner_url})` } : { background: gradient }}>
        <div className="absolute right-3 top-3 flex gap-2">
          {friendBtn && (
            <div className="relative">
              <button onClick={friendBtn.fn} title={friendBtn.title} aria-label={friendBtn.title} aria-expanded={rel === 'friend' ? friendMenu : undefined} className="h-8 w-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center" data-friend-badge={rel === 'friend' ? '' : undefined}>{friendBtn.icon}</button>
              {friendMenu && <Menu items={[{ label: 'Remove Friend', danger: true, onClick: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) }]} onClose={() => setFriendMenu(false)} className="top-[calc(100%+4px)] right-0" />}
            </div>
          )}
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} title="More" aria-label="More" aria-expanded={menu} className="h-8 w-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center"><MoreHorizontal size={18} /></button>
            {menu && <Menu items={menuItems} onClose={() => setMenu(false)} className="top-0 left-[calc(100%+8px)]" />}
          </div>
        </div>
        {user.custom_status && (
          <div className="absolute left-[104px] bottom-[-14px] max-w-[180px] rounded-xl px-3 py-1.5 text-sm shadow-lg truncate" style={{ background: themed ? '#1a1527' : '#232428' }} data-custom-status title={user.custom_status}>{user.custom_status}</div>
        )}
      </div>
      {/* Avatar */}
      <div className="px-4 -mt-[42px]">
        <div className="inline-block rounded-full" style={{ boxShadow: `0 0 0 6px ${themed ? '#1a1527' : '#232428'}` }}><Avatar user={user} size={80} presence /></div>
      </div>
      <div className="px-4 pt-3 pb-4 space-y-3">
        <div>
          <h2 className="text-[20px] font-bold leading-6 truncate flex items-center gap-1.5">
            {nickEdit !== null ? (
              <input autoFocus value={nickEdit} maxLength={32} onChange={(e) => setNickEdit(e.target.value)} onBlur={saveNick} onKeyDown={(e) => { if (e.key === 'Enter') saveNick(); if (e.key === 'Escape') setNickEdit(null) }} placeholder={user.display_name}
                className="h-7 w-48 rounded-md bg-black/30 border border-white/20 px-2 text-sm font-bold outline-none" data-friend-nick-input />
            ) : (
              <span className={look.className} style={nameStyle} data-profile-name>{nickname ?? user.display_name}</span>
            )}
            <ClanTag userId={user.id} tag={user.clan_tag} />
            <Badges badges={user.badges} />
            {guild?.owner_id === user.id && <Crown size={16} className="text-warn shrink-0" />}
            {rel === 'friend' && nickEdit === null && <button type="button" onClick={() => setNickEdit(friendNote?.nickname ?? '')} title="Set friend nickname" className="shrink-0 opacity-60 hover:opacity-100" data-friend-nick><Pencil size={13} /></button>}
          </h2>
          {/* Like Discord: "username • pronouns" wraps so long pronouns drop to their own line. */}
          <p className="text-sm leading-[18px] flex flex-wrap gap-x-1 break-words">
            {nickname && nickname !== user.display_name ? <><span>{user.display_name}</span><span className="opacity-60">•</span></> : null}
            <span className="break-all">{user.username}</span>
            {user.pronouns ? <><span className="opacity-60">•</span><span>{user.pronouns}</span></> : null}
          </p>
        </div>
        {!isMe && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1">Note</div>
            <textarea value={noteDraft ?? friendNote?.note ?? ''} onChange={(e) => setNoteDraft(e.target.value)} onBlur={saveNoteText} maxLength={256} rows={noteDraft || friendNote?.note ? 3 : 1} placeholder="Click to add a note"
              className="w-full resize-none rounded-md bg-black/20 px-2 py-1 text-sm outline-none placeholder:text-[#b5bac1]/70 focus:bg-black/30" data-profile-note />
          </div>
        )}
        {(friends.length > 0 || mutual.length > 0) && (
          <button onClick={fullProfile} className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] leading-4 text-[#b5bac1] hover:text-[#dbdee1]" data-mutual>
            {friends.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="flex -space-x-2">{friends.slice(0, 3).map((f) => <span key={f.id} className="rounded-full ring-2 ring-[#232428]"><Avatar user={{ id: f.id, display_name: f.display_name, avatar_url: f.avatar_url }} size={16} /></span>)}</span>
                <span>{friends.length} Mutual Friend{friends.length === 1 ? '' : 's'}</span>
              </span>
            )}
            {friends.length > 0 && mutual.length > 0 && <span className="opacity-60">•</span>}
            {mutual.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="flex -space-x-2">{mutual.slice(0, 3).map((g) => <GuildDot key={g.id} g={g} ring />)}</span>
                <span>{mutual.length} Mutual Server{mutual.length === 1 ? '' : 's'}</span>
              </span>
            )}
          </button>
        )}
        {user.bio && (
          <div>
            <div ref={bioRef} className="msg-content text-sm leading-[18px] whitespace-pre-wrap break-words overflow-hidden max-h-[54px]" data-bio>{renderMarkdown(user.bio, { blocks: false })}</div>
            {bioClamped && <div className="text-sm leading-[18px] text-[#b5bac1]" aria-hidden>…</div>}
            {bioClamped && <button onClick={fullProfile} className="mt-3 block text-xs font-medium text-[#dbdee1] hover:underline" data-view-full-bio>View Full Bio</button>}
          </div>
        )}
        <button onClick={fullProfile} className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold text-left hover:brightness-110" style={{ background: themed ? 'rgba(0,0,0,0.35)' : '#2b2d31' }} data-reviews>
          <span>User Reviews</span>
          <span className="font-normal text-[#b5bac1]">{reviewCount === 0 ? 'No reviews yet' : `${reviewCount} review${reviewCount === 1 ? '' : 's'}`}</span>
        </button>
        {(user.connections?.length ?? 0) > 0 && (
          <div data-profile-connections>
            <h3 className="text-xs font-bold mb-1">Connections</h3>
            <div className="flex flex-wrap gap-1.5">
              {user.connections!.map((c) => (
                <a key={c.id} href={c.url || undefined} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:brightness-110" style={{ background: themed ? 'rgba(0,0,0,0.35)' : '#2b2d31' }} data-connection={c.provider} title={c.provider}>
                  <span className="h-4 w-4 rounded-sm bg-white/15 text-[10px] font-bold flex items-center justify-center uppercase">{c.provider[0]}</span>
                  <span className="truncate max-w-[140px]">{c.name}</span>
                </a>
              ))}
            </div>
          </div>
        )}
        {panel && (
          <div>
            <h3 className="text-xs font-bold mb-1">Member Since</h3>
            <p className="text-sm text-[#b5bac1]">{new Date(user.created_at).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          </div>
        )}
        {!panel && !isMe && rel !== 'blocked' && (
          <div className="relative">
            <input ref={inputRef} value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={onQuickKey} disabled={sending} maxLength={2000}
              placeholder={`Message @${nickname ?? user.display_name}`} aria-label={`Message @${user.username}`} data-quick-message
              className="w-full h-11 rounded-lg pl-3 pr-10 text-sm text-[#dbdee1] placeholder:text-[#87898c] outline-none border border-transparent focus:border-white/15"
              style={{ background: themed ? 'rgba(0,0,0,0.4)' : '#1e1f22' }} />
            <button type="button" onClick={(e) => setEmoji((cur) => (cur ? null : e.currentTarget.getBoundingClientRect()))} title="Emoji" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#b5bac1] hover:text-[#dbdee1]"><Smile size={20} /></button>
            {emoji && (
              <ExpressionPicker tabs={['emoji']} anchor={emoji} onClose={() => { setEmoji(null); inputRef.current?.focus() }}
                onEmoji={(t) => setQuick((v) => (v && !/\s$/.test(v) ? v + ' ' : v) + t + ' ')} />
            )}
          </div>
        )}
        {rel === 'blocked' && <div className="flex items-center gap-2 text-sm text-text-2"><UserX size={16} /> You blocked this user.</div>}
        {panel && <button onClick={fullProfile} className="w-full rounded-lg py-2.5 text-sm font-semibold hover:brightness-110" style={{ background: themed ? 'rgba(0,0,0,0.35)' : '#2b2d31' }} data-view-full-profile>View Full Profile</button>}
      </div>
    </div>
  )
}

function GuildDot({ g, ring }: { g: Pick<Guild, 'id' | 'name' | 'icon_url'>; ring?: boolean }) {
  const cls = `h-4 w-4 rounded-full shrink-0 ${ring ? 'ring-2 ring-[#232428]' : ''}`
  return g.icon_url
    ? <img src={g.icon_url} alt="" title={g.name} className={`${cls} object-cover`} />
    : <span title={g.name} className={`${cls} text-white text-[8px] font-bold flex items-center justify-center`} style={{ background: colorFor(g.id) }}>{initials(g.name)}</span>
}

type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; onClick?: () => void; children?: MenuItem[] }
type MenuEntry = MenuItem | 'sep'

/** Discord-style context menu: opens to the right of the "…" button (left if no room), submenus fly out sideways. */
function Menu({ items, onClose, className = '' }: { items: MenuEntry[]; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [flip, setFlip] = useState(false)
  useLayoutEffect(() => { const r = ref.current?.getBoundingClientRect(); if (r && r.right > window.innerWidth - 8) setFlip(true) }, [])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={(e) => { e.stopPropagation(); onClose() }} />
      <div ref={ref} role="menu" data-profile-menu className={`pop absolute z-[70] min-w-[190px] rounded-md bg-[#111214] border border-white/5 shadow-2xl p-1.5 ${flip ? 'top-0 right-[calc(100%+8px)] left-auto' : className}`}>
        {items.map((it, i) => it === 'sep'
          ? <div key={i} className="my-1 h-px bg-white/10" />
          : <MenuRow key={i} item={it} onClose={onClose} flip={flip} />)}
      </div>
    </>
  )
}

function MenuRow({ item, onClose, flip }: { item: MenuItem; onClose: () => void; flip: boolean }) {
  const [open, setOpen] = useState(false)
  const danger = item.danger ? 'text-[#f23f43] hover:bg-[#f23f43] hover:text-white' : 'text-[#dbdee1] hover:bg-accent hover:text-white'
  if (item.children) {
    return (
      <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`w-full flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm font-medium text-left ${danger}`}>
          <span className="flex items-center gap-2">{item.icon}{item.label}</span><ChevronRight size={16} />
        </button>
        {open && <SubMenu items={item.children} onClose={onClose} parentFlip={flip} />}
      </div>
    )
  }
  return (
    <button type="button" role="menuitem" onClick={() => { onClose(); item.onClick?.() }} className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-left ${danger}`}>
      {item.icon}{item.label}
    </button>
  )
}

/** Flies out to the right of its row, or to the left when that would leave the viewport. */
function SubMenu({ items, onClose, parentFlip }: { items: MenuItem[]; onClose: () => void; parentFlip: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [flip, setFlip] = useState(parentFlip)
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    if (!flip && r.right > window.innerWidth - 8) setFlip(true)
    else if (flip && r.left < 8) setFlip(false)
  }, [flip])
  return (
    <div ref={ref} role="menu" className={`pop absolute top-0 z-[80] min-w-[190px] rounded-md bg-[#111214] border border-white/5 shadow-2xl p-1.5 ${flip ? 'right-full mr-1' : 'left-full ml-1'}`}>
      {items.map((c, i) => <MenuRow key={i} item={c} onClose={onClose} flip={flip} />)}
    </div>
  )
}

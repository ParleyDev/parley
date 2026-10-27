import { Check, Clock, MessageSquare, Crown, Lock, UserCheck, Gavel, MoreHorizontal, Pencil, Smile, UserMinus, UserPlus, UserX } from 'lucide-react'
import { nameLook } from '../lib/nameStyle'
import { roleLook } from './StyledName'
import { locale, useT } from '../lib/i18n'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
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
import { frameClass } from '../lib/cosmetics'
import ProfileEffect from './ProfileEffect'
import { FrameRoom } from './ProfileFrame'
import { LogoMark } from './Logo'
import RolePicker from './RolePicker'
import VoiceCard from './VoiceCard'
import { profileCardStyle, profileColors } from '../lib/profileLook'
import { ActivityCard } from './SpotifyActivity'
import ContextMenu, { type MenuEntry, type MenuState } from './ContextMenu'
import ImageLightbox from './modals/ImageLightbox'
import { createPortal } from 'react-dom'

export const POPOUT_W = 300

interface Props {
  user: UserProfile
  /** Server the popout was opened in, if any. */
  guildId?: string
  onClose: () => void
  /** 'panel': the DM side panel — no message box, adds Member Since and a View Full Profile button.
   *  'full': the card of the full profile — tall, scrolling inside, with the actions under the name, both Member
   *  Since dates, roles and your note; the full profile puts its tabs beside it. */
  variant?: 'popout' | 'panel' | 'full'
}

/**
 * Discord's compact profile popout: banner with add-friend and "…" buttons, avatar, name,
 * "username • pronouns", a clamped bio with "View Full Bio", mutual servers, and a
 * "Message @user" box. Everything else lives in the full profile ("View Full Profile").
 */
export default function ProfilePopout({ user, guildId, onClose, variant = 'popout' }: Props) {
  const panel = variant === 'panel'
  const full = variant === 'full'
  const me = useStore((s) => s.user)
  const rel = useStore((s) => s.relationships[user.id]?.kind)
  const live = useStore((s) => !!s.voiceStates[user.id]?.self_stream)
  const activity = useStore((s) => s.activities[user.id])
  const friendsSince = useStore((st) => st.relationships[user.id]?.created_at)
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
  const sendMessage = useStore((s) => s.sendMessage)
  const navigate = useNavigate()
  const t = useT()
  const [quick, setQuick] = useState('')
  const [sending, setSending] = useState(false)
  const [emoji, setEmoji] = useState<DOMRect | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [friendMenu, setFriendMenu] = useState<MenuState | null>(null)
  const [viewAvatar, setViewAvatar] = useState(false)
  // The avatar viewer sits over this card: Escape closes it first.
  useLayoutEffect(() => {
    if (!viewAvatar) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setViewAvatar(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [viewAvatar])
  const [bioClamped, setBioClamped] = useState(false)
  const bioRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { const el = bioRef.current; if (el && !full) setBioClamped(el.scrollHeight > el.clientHeight + 1) }, [user.bio, full])

  const isMe = me?.id === user.id
  const ctx = guild ? { guild, roles, member: myMember } : null
  const outranks = !!(guild && ctx && me && !isMe && member && guild.owner_id !== user.id && (guild.owner_id === me.id || highestPosition(ctx, me.id) > highestPosition({ ...ctx, member }, user.id)))
  const canKick = outranks && has(myPerms, P.KICK_MEMBERS)
  const canBan = outranks && has(myPerms, P.BAN_MEMBERS)
  const roleForName = colorRole(roles, member as Member | undefined)
  const look = roleForName ? roleLook(roleForName) : nameLook(user)
  const nameStyle = look.style

  const { themed, gradient } = profileColors(user)
  const cardStyle = profileCardStyle(user)

  const act = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } }
  const openDm = async () => { const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: user.id }); upsertChannel(c); return c }
  const sendQuick = async () => {
    const text = quick.trim()
    if (!text || sending) return
    setSending(true)
    try { const c = await openDm(); await sendMessage(c.id, text); onClose(); navigate(`/channels/@me/${c.id}`) } catch (e) { pushToast((e as Error).message, 'error') } finally { setSending(false) }
  }
  const onQuickKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); sendQuick() } }
  const copy = (label: string, text: string) => act(async () => { await navigator.clipboard.writeText(text); pushToast(t('{label} copied', { label })) })
  const fullProfile = (tab?: 'friends' | 'servers' | 'reviews') => { onClose(); openModal({ kind: 'profile', userId: user.id, tab }) }
  const invite = (g: Guild) => act(async () => {
    const inv = await api.post<{ code: string }>(`/guilds/${g.id}/invites`, {})
    const c = await openDm()
    await sendMessage(c.id, `${publicOrigin()}/invite/${inv.code}`)
    pushToast(t('Invite to {name} sent', { name: g.name }))
  })
  const kick = () => { onClose(); openModal({ kind: 'kick', guildId: guildId!, userId: user.id }) }
  const ban = () => { onClose(); openModal({ kind: 'ban', guildId: guildId!, userId: user.id }) }
  const block = () => { onClose(); openModal({ kind: 'confirm', title: t('Block {name}', { name: user.display_name }), body: t('{name} will not be able to message you or send you friend requests. Any friendship or pending request is removed.', { name: user.display_name }), danger: true, confirmLabel: t('Block'), action: () => act(() => api.put(`/users/@me/relationships/${user.id}/block`)) }) }

  const friendBtn = !isMe && (
    rel === 'friend' ? { title: t('Friend'), icon: <UserCheck size={18} />, fn: (e: React.MouseEvent) => { const r = e.currentTarget.getBoundingClientRect(); setFriendMenu((m) => m ? null : { x: r.left, y: r.bottom + 4, items: [{ label: t('Remove Friend'), danger: true, onClick: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) }] }) } }
    : rel === undefined ? { title: t('Add Friend'), icon: <UserPlus size={18} />, fn: () => act(() => api.post('/users/@me/relationships', { user_id: user.id })) }
    : rel === 'incoming' ? { title: t('Accept Friend Request'), icon: <Check size={18} />, fn: () => act(() => api.put(`/users/@me/relationships/${user.id}`)) }
    : rel === 'outgoing' ? { title: t('Cancel Friend Request'), icon: <Clock size={18} />, fn: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) }
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
      { label: t('Edit Profile'), icon: <Pencil size={16} />, onClick: () => { onClose(); openModal({ kind: 'editProfile' }) } },
      'sep',
      copyMenu(),
    ]
    : [
      { label: t('View Full Profile'), onClick: fullProfile },
      ...(inviteTargets.length ? [{ label: t('Invite to Server'), children: inviteTargets.map((g) => ({ label: g.name, icon: <GuildDot g={g} />, onClick: () => invite(g) })) }] : []),
      'sep',
      ...(rel === undefined ? [{ label: t('Add Friend'), onClick: () => act(() => api.post('/users/@me/relationships', { user_id: user.id })) }] : []),
      ...(rel === 'incoming' ? [{ label: t('Accept Friend Request'), onClick: () => act(() => api.put(`/users/@me/relationships/${user.id}`)) }] : []),
      ...(rel === 'outgoing' ? [{ label: t('Cancel Friend Request'), onClick: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) }] : []),
      ...(rel === 'friend' ? [{ label: t('Remove Friend'), danger: true, onClick: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) }] : []),
      rel === 'blocked' ? { label: t('Unblock'), onClick: () => act(() => api.delete(`/users/@me/relationships/${user.id}`)) } : { label: t('Block'), danger: true, onClick: block },
      ...(canKick || canBan ? ['sep' as const] : []),
      ...(canKick ? [{ label: t('Kick {name}', { name: nickname ?? user.display_name }), danger: true, icon: <UserMinus size={16} />, onClick: kick }] : []),
      ...(canBan ? [{ label: t('Ban {name}', { name: nickname ?? user.display_name }), danger: true, icon: <Gavel size={16} />, onClick: ban }] : []),
      'sep',
      copyMenu(),
    ]
  function copyMenu(): MenuEntry {
    return { label: t('Copy User Info'), children: [
      { label: t('Copy User ID'), onClick: () => copy(t('User ID'), user.id) },
      { label: t('Copy Profile Link'), onClick: () => copy(t('Profile link'), `${location.origin}/users/${user.id}`) },
      ...(user.avatar_url ? [{ label: t('Copy Avatar Image Link'), onClick: () => copy(t('Avatar link'), new URL(user.avatar_url!, location.origin).href) }] : []),
      ...(user.banner_url ? [{ label: t('Copy Banner Image Link'), onClick: () => copy(t('Banner link'), new URL(user.banner_url!, location.origin).href) }] : []),
    ] }
  }

  return (
    <FrameRoom value={user.profile_frame} bleed={full} className={full ? 'md:h-full' : ''} innerClassName={full ? 'md:h-full' : ''}>
    <div className={`relative w-full ${full ? 'rounded-xl h-full flex flex-col' : 'rounded-lg'} border text-[#dbdee1] shadow-2xl overflow-visible ${frameClass(user.profile_frame)}`} style={cardStyle} data-profile-card data-profile-frame={user.profile_frame || undefined} data-profile-variant={variant}>
      <ProfileEffect id={user.profile_effect} />
      {/* Banner with overlaid buttons */}
      <div className={`relative ${full ? 'h-[140px] shrink-0 rounded-t-xl' : 'h-[105px] rounded-t-lg'} bg-cover bg-center`} style={user.banner_url ? { backgroundImage: `url(${user.banner_url})` } : { background: gradient }}>
        {!full && <div className="absolute right-3 top-3 flex gap-2">
          {full && !isMe && rel !== 'blocked' && (
            <button onClick={() => act(async () => { const c = await openDm(); onClose(); navigate(`/channels/@me/${c.id}`) })} className="h-8 rounded-full bg-accent hover:brightness-110 px-3.5 text-sm font-semibold text-white flex items-center gap-1.5" data-full-message><MessageSquare size={16} />{t('Message')}</button>
          )}
          {full && isMe && (
            <button onClick={() => { onClose(); openModal({ kind: 'editProfile' }) }} className="h-8 rounded-full bg-black/55 hover:bg-black/75 px-3.5 text-sm font-semibold text-white flex items-center gap-1.5" data-full-edit-profile><Pencil size={15} />{t('Edit Profile')}</button>
          )}
          {friendBtn && (
            <div className="relative">
              <button onClick={friendBtn.fn} title={friendBtn.title} aria-label={friendBtn.title} aria-expanded={rel === 'friend' ? !!friendMenu : undefined} className="h-8 w-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center" data-friend-badge={rel === 'friend' ? '' : undefined}>{friendBtn.icon}</button>
              {friendMenu && <ContextMenu {...friendMenu} onClose={() => setFriendMenu(null)} />}
            </div>
          )}
          <div className="relative">
            <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: r.right + 8, y: r.top, items: menuItems }) }} title={t('More')} aria-label={t('More')} aria-expanded={!!menu} className="h-8 w-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center"><MoreHorizontal size={18} /></button>
            {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
          </div>
        </div>}
        {user.custom_status && (
          <div className={`absolute ${full ? 'left-[156px] max-w-[260px]' : 'left-[104px] max-w-[180px]'} bottom-[-14px] rounded-xl px-3 py-1.5 text-sm shadow-lg truncate`} style={{ background: themed ? '#1a1527' : '#232428' }} data-custom-status title={user.custom_status}>{user.custom_status}</div>
        )}
      </div>
      {/* Avatar */}
      <div className={full ? 'px-5 -mt-[64px]' : 'px-4 -mt-[42px]'}>
        <div className="inline-block rounded-full" style={{ boxShadow: `0 0 0 ${full ? 8 : 6}px ${themed ? '#1a1527' : '#232428'}` }}>
          {user.avatar_url
            ? <button type="button" onClick={() => setViewAvatar(true)} className="block rounded-full cursor-zoom-in" title={t('View Avatar')} aria-label={t('View Avatar')} data-view-avatar><Avatar user={user} size={full ? 120 : 80} presence animate /></button>
            : <Avatar user={user} size={full ? 120 : 80} presence animate />}
        </div>
        {viewAvatar && user.avatar_url && createPortal(<div className="relative z-[160]"><ImageLightbox url={user.avatar_url} name={user.display_name} onClose={() => setViewAvatar(false)} /></div>, document.body)}
      </div>
      <div className={full ? 'flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-3 pb-5' : 'px-4 pt-3 pb-4'} data-profile-body>
      <div className={full ? 'space-y-4' : 'space-y-3'} data-profile-main>
        <div>
          <h2 className={`${full ? 'text-[24px] leading-7' : 'text-[20px] leading-6'} font-bold truncate flex items-center gap-1.5`}>
            {nickEdit !== null ? (
              <input autoFocus value={nickEdit} maxLength={32} onChange={(e) => setNickEdit(e.target.value)} onBlur={saveNick} onKeyDown={(e) => { if (e.key === 'Enter') saveNick(); if (e.key === 'Escape') setNickEdit(null) }} placeholder={user.display_name}
                className="h-7 w-48 rounded-md bg-black/30 border border-white/20 px-2 text-sm font-bold outline-none" data-friend-nick-input />
            ) : (
              <span className={look.className} style={nameStyle} data-profile-name>{nickname ?? user.display_name}</span>
            )}
            <ClanTag userId={user.id} tag={user.clan_tag} />
            <Badges badges={user.badges} />
            {guild?.owner_id === user.id && <Crown size={16} className="text-warn shrink-0" />}
            {rel === 'friend' && nickEdit === null && <button type="button" onClick={() => setNickEdit(friendNote?.nickname ?? '')} title={t('Set friend nickname')} className="shrink-0 opacity-60 hover:opacity-100" data-friend-nick><Pencil size={13} /></button>}
          </h2>
          {/* Like Discord: "username • pronouns" wraps so long pronouns drop to their own line. */}
          <p className="text-sm leading-[18px] flex flex-wrap gap-x-1 break-words">
            {nickname && nickname !== user.display_name ? <><span>{user.display_name}</span><span className="opacity-60">•</span></> : null}
            <span className="break-all">{user.username}</span>
            {user.pronouns ? <><span className="opacity-60">•</span><span>{user.pronouns}</span></> : null}
          </p>
        </div>
        {full && (
          // Discord's full profile: the actions sit under the name, the main one spelled out.
          <div className="flex items-center gap-2" data-full-actions>
            {isMe ? <button onClick={() => { onClose(); openModal({ kind: 'editProfile' }) }} className="h-9 rounded-lg bg-accent hover:brightness-110 px-4 text-sm font-semibold text-white flex items-center gap-1.5" data-full-edit-profile><Pencil size={15} />{t('Edit Profile')}</button>
              : rel === undefined ? <button onClick={() => act(() => api.post('/users/@me/relationships', { user_id: user.id }))} className="h-9 rounded-lg bg-accent hover:brightness-110 px-4 text-sm font-semibold text-white flex items-center gap-1.5" data-full-add-friend><UserPlus size={16} />{t('Add Friend')}</button>
              : rel === 'incoming' ? <button onClick={() => act(() => api.put(`/users/@me/relationships/${user.id}`))} className="h-9 rounded-lg bg-success hover:brightness-110 px-4 text-sm font-semibold text-black flex items-center gap-1.5"><Check size={16} />{t('Accept')}</button>
              : rel !== 'blocked' ? <button onClick={() => act(async () => { const c = await openDm(); onClose(); navigate(`/channels/@me/${c.id}`) })} className="h-9 rounded-lg bg-accent hover:brightness-110 px-4 text-sm font-semibold text-white flex items-center gap-1.5" data-full-message><MessageSquare size={16} />{t('Message')}</button> : null}
            {!isMe && rel !== 'blocked' && (rel === undefined || rel === 'incoming') && <button onClick={() => act(async () => { const c = await openDm(); onClose(); navigate(`/channels/@me/${c.id}`) })} title={t('Message')} aria-label={t('Message')} className="h-9 w-9 rounded-lg bg-black/30 hover:bg-black/45 flex items-center justify-center" data-full-message-icon><MessageSquare size={18} /></button>}
            {friendBtn && (rel === 'friend' || rel === 'outgoing') && (
              <span className="relative">
                <button onClick={friendBtn.fn} title={friendBtn.title} aria-label={friendBtn.title} className="h-9 w-9 rounded-lg bg-black/30 hover:bg-black/45 flex items-center justify-center" data-friend-badge={rel === 'friend' ? '' : undefined}>{friendBtn.icon}</button>
                {friendMenu && <ContextMenu {...friendMenu} onClose={() => setFriendMenu(null)} />}
              </span>
            )}
            <span className="relative">
              <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: r.left, y: r.bottom + 4, items: menuItems }) }} title={t('More')} aria-label={t('More')} aria-expanded={!!menu} className="h-9 w-9 rounded-lg bg-black/30 hover:bg-black/45 flex items-center justify-center"><MoreHorizontal size={18} /></button>
              {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
            </span>
          </div>
        )}
        {!isMe && !full && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1">{t('Note')}</div>
            <textarea value={noteDraft ?? friendNote?.note ?? ''} onChange={(e) => setNoteDraft(e.target.value)} onBlur={saveNoteText} maxLength={256} rows={noteDraft || friendNote?.note ? 3 : 1} placeholder={t('Click to add a note')}
              className="w-full resize-none rounded-md bg-black/20 px-2 py-1 text-sm outline-none placeholder:text-[#b5bac1]/70 focus:bg-black/30" data-profile-note />
          </div>
        )}
        {!full && (friends.length > 0 || mutual.length > 0) && (
          <button onClick={() => fullProfile(friends.length ? 'friends' : 'servers')} className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] leading-4 text-[#b5bac1] hover:text-[#dbdee1]" data-mutual>
            {friends.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="flex -space-x-2">{friends.slice(0, 3).map((f) => <span key={f.id} className="rounded-full ring-2 ring-[#232428]"><Avatar user={{ id: f.id, display_name: f.display_name, avatar_url: f.avatar_url }} size={16} /></span>)}</span>
                <span>{friends.length === 1 ? t('{n} Mutual Friend', { n: friends.length }) : t('{n} Mutual Friends', { n: friends.length })}</span>
              </span>
            )}
            {friends.length > 0 && mutual.length > 0 && <span className="opacity-60">•</span>}
            {mutual.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="flex -space-x-2">{mutual.slice(0, 3).map((g) => <GuildDot key={g.id} g={g} ring />)}</span>
                <span>{mutual.length === 1 ? t('{n} Mutual Server', { n: mutual.length }) : t('{n} Mutual Servers', { n: mutual.length })}</span>
              </span>
            )}
          </button>
        )}
        {user.private_profile && <div className="flex items-center gap-1.5 text-xs text-[#b5bac1]" data-private-profile><Lock size={12} /> {t('Private profile: only friends can see more')}</div>}
        {live && <div className="flex items-center gap-1.5 text-xs" data-profile-live><span className="rounded bg-danger px-1 text-[10px] font-extrabold text-white">{t('LIVE')}</span>{t('Streaming in voice')}</div>}
        {activity && !full && <ActivityCard userId={user.id} activity={activity} dark={themed} />}
        {user.bio && (
          <div>
            <div ref={bioRef} className={`msg-content text-sm leading-[18px] whitespace-pre-wrap break-words ${full ? '' : 'overflow-hidden max-h-[54px]'}`} data-bio>{renderMarkdown(user.bio, { blocks: false })}</div>
            {bioClamped && <div className="text-sm leading-[18px] text-[#b5bac1]" aria-hidden>…</div>}
            {bioClamped && <button onClick={() => fullProfile()} className="mt-3 block text-xs font-medium text-[#dbdee1] hover:underline" data-view-full-bio>{t('View Full Bio')}</button>}
          </div>
        )}
        {!full && <button onClick={() => fullProfile('reviews')} className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold text-left hover:brightness-110" style={{ background: themed ? 'rgba(0,0,0,0.35)' : '#2b2d31' }} data-reviews>
          <span>{t('User Reviews')}</span>
          <span className="font-normal text-[#b5bac1]">{reviewCount === 0 ? t('No reviews yet') : reviewCount === 1 ? t('{n} review', { n: reviewCount }) : t('{n} reviews', { n: reviewCount })}</span>
        </button>}
        {(user.connections?.length ?? 0) > 0 && (
          <div data-profile-connections>
            <h3 className="text-xs font-bold mb-1">{t('Connections')}</h3>
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
        {(panel || full || (guild && member)) && (
          // Like Discord: when you joined the instance, and (in a server) when you joined that server.
          <div data-member-since>
            <h3 className="text-xs font-bold mb-1">{t('Member Since')}</h3>
            <p className="text-sm text-[#b5bac1] flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="flex items-center gap-1.5" title={t('Joined Parley')}><LogoMark className="h-3.5 w-3.5" />{new Date(user.created_at).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              {guild && member?.joined_at && <><span className="opacity-60">•</span><span className="flex items-center gap-1.5" title={t('Joined {server}', { server: guild.name })} data-member-since-server><GuildDot g={guild} />{new Date(member.joined_at).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })}</span></>}
            </p>
          </div>
        )}
        {rel === 'friend' && friendsSince && (
          <div data-friends-since>
            <h3 className="text-xs font-bold mb-1">{t('Friends Since')}</h3>
            <p className="text-sm text-[#b5bac1]">{new Date(friendsSince).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          </div>
        )}
        {guildId && member && ((member as Member).roles.length > 0 || has(myPerms, P.MANAGE_ROLES)) && (
          // Server context: their roles here (and adding or removing them, when you may); nothing when there are none.
          <div data-profile-roles>
            <h3 className="text-xs font-bold mb-1">{t('Roles')}</h3>
            <RolePicker guildId={guildId} member={member as Member} compact />
          </div>
        )}
        {!full && <VoiceCard userId={user.id} onJoin={onClose} dark={themed} />}
        {full && !isMe && (
          <div>
            <h3 className="text-xs font-bold mb-1">{t('Note (only visible to you)')}</h3>
            <textarea value={noteDraft ?? friendNote?.note ?? ''} onChange={(e) => setNoteDraft(e.target.value)} onBlur={saveNoteText} maxLength={256} rows={noteDraft || friendNote?.note ? 3 : 1} placeholder={t('Click to add a note')}
              className="w-full resize-none rounded-md bg-transparent px-0 py-1 text-sm italic outline-none placeholder:text-[#b5bac1]/80 focus:bg-black/20 focus:px-2 focus:not-italic" data-profile-note />
          </div>
        )}
        {!panel && !full && !isMe && rel !== 'blocked' && (
          <div className="relative">
            <input ref={inputRef} value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={onQuickKey} disabled={sending} maxLength={2000}
              placeholder={t('Message @{name}', { name: nickname ?? user.display_name })} aria-label={t('Message @{name}', { name: user.username })} data-quick-message
              className="w-full h-11 rounded-lg pl-3 pr-10 text-sm text-[#dbdee1] placeholder:text-[#87898c] outline-none border border-transparent focus:border-white/15"
              style={{ background: themed ? 'rgba(0,0,0,0.4)' : '#1e1f22' }} />
            <button type="button" onClick={(e) => setEmoji((cur) => (cur ? null : e.currentTarget.getBoundingClientRect()))} title={t('Emoji')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#b5bac1] hover:text-[#dbdee1]"><Smile size={20} /></button>
            {emoji && (
              <ExpressionPicker tabs={['emoji']} anchor={emoji} onClose={() => { setEmoji(null); inputRef.current?.focus() }}
                onEmoji={(em) => setQuick((v) => (v && !/\s$/.test(v) ? v + ' ' : v) + em + ' ')} />
            )}
          </div>
        )}
        {rel === 'blocked' && <div className="flex items-center gap-2 text-sm text-text-2"><UserX size={16} /> {t('You blocked this user.')}</div>}
        {panel && <button onClick={() => fullProfile()} className="w-full rounded-lg py-2.5 text-sm font-semibold hover:brightness-110" style={{ background: themed ? 'rgba(0,0,0,0.35)' : '#2b2d31' }} data-view-full-profile>{t('View Full Profile')}</button>}
      </div>
      </div>
    </div>
    </FrameRoom>
  )
}

function GuildDot({ g, ring }: { g: Pick<Guild, 'id' | 'name' | 'icon_url'>; ring?: boolean }) {
  const cls = `h-4 w-4 rounded-full shrink-0 ${ring ? 'ring-2 ring-[#232428]' : ''}`
  return g.icon_url
    ? <img src={g.icon_url} alt="" title={g.name} className={`${cls} object-cover`} />
    : <span title={g.name} className={`${cls} text-white text-[8px] font-bold flex items-center justify-center`} style={{ background: colorFor(g.id) }}>{initials(g.name)}</span>
}


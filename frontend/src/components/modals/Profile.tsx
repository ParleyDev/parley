import { Ban, Check, Gavel, MessageSquare, Pencil, UserMinus, UserPlus, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { myGuildPerms, useStore } from '../../store'
import type { DmChannel, User } from '../../lib/types'
import { has, highestPosition, P, EMPTY_ROLES } from '../../lib/perms'
import type { Anchor } from '../../lib/anchor'
import { colorRole, nameCss } from '../StyledName'
import RolePicker from '../RolePicker'
import ProfileCard, { contrastText } from '../ProfileCard'
import { colorFor } from '../../lib/format'

const CARD_W = 340
const GAP = 8
const PAD = 8

/**
 * A user's profile. On wide screens it is a Discord-style popout anchored beside whatever was
 * clicked (member list row, chat avatar, voice participant…); on phones it slides up as a sheet.
 * Without an anchor (e.g. opened programmatically) it falls back to a centred modal.
 */
export default function ProfileModal({ onClose, userId, anchor }: { onClose: () => void; userId: string; anchor?: Anchor }) {
  const cached = useStore((s) => s.users[userId])
  const rel = useStore((s) => s.relationships[userId]?.kind)
  const me = useStore((s) => s.user)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const removeMember = useStore((s) => s.removeMember)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const sendMessage = useStore((s) => s.sendMessage)
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
  const [quick, setQuick] = useState('')
  const [sending, setSending] = useState(false)
  // The cached copy may be partial (built from a member row), so always fetch the full profile,
  // and refetch whenever the cached copy changes (USER_UPDATE, member list load).
  useEffect(() => { api.get<User>(`/users/${userId}`).then(setUser).catch(() => {}) }, [userId, cached])

  const isMe = me?.id === userId
  const openDm = async () => {
    const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: userId })
    upsertChannel(c)
    return c
  }
  const dm = async () => {
    try { const c = await openDm(); onClose(); navigate(`/channels/@me/${c.id}`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const sendQuick = async () => {
    const text = quick.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const c = await openDm()
      await sendMessage(c.id, text)
      onClose(); navigate(`/channels/@me/${c.id}`)
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setSending(false) }
  }
  const onQuickKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); sendQuick() } }
  const kick = () => openModal({
    kind: 'confirm', title: `Kick ${user?.display_name}`, body: `Are you sure you want to kick ${user?.display_name} from ${guild?.name}? They can rejoin with a new invite.`, danger: true, confirmLabel: 'Kick',
    action: async () => { try { await api.delete(`/guilds/${inGuild}/members/${userId}`); removeMember(inGuild!, userId) } catch (e) { pushToast((e as Error).message, 'error') } },
  })
  const ban = () => openModal({ kind: 'ban', guildId: inGuild!, userId })
  const relAct = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } }
  const addFriend = () => relAct(() => api.post('/users/@me/relationships', { user_id: userId }))
  const acceptFriend = () => relAct(() => api.put(`/users/@me/relationships/${userId}`))
  const removeRel = () => relAct(() => api.delete(`/users/@me/relationships/${userId}`))
  const blockUser = () => openModal({ kind: 'confirm', title: `Block ${user?.display_name}`, body: `${user?.display_name} will not be able to message you or send you friend requests. Any friendship or pending request is removed.`, danger: true, confirmLabel: 'Block', action: () => relAct(() => api.put(`/users/@me/relationships/${userId}/block`)) })

  if (!user) return <Popout anchor={anchor} onClose={onClose}><div className="rounded-2xl bg-bg-1 border border-line p-6 text-text-2">Loading…</div></Popout>

  const ctx = guild ? { guild, roles, member: myMember } : null
  const outranks = !!(guild && ctx && me && !isMe && member && guild.owner_id !== userId && (guild.owner_id === me.id || highestPosition(ctx, me.id) > highestPosition({ ...ctx, member }, userId)))
  const canKick = outranks && has(myPerms, P.KICK_MEMBERS)
  const canBan = outranks && has(myPerms, P.BAN_MEMBERS)
  const roleForName = colorRole(roles, member)
  const roleNameStyle = roleForName ? nameCss(roleForName.color, roleForName.color_accent) : undefined

  const text = contrastText(user.theme_primary ?? colorFor(user.id))
  const light = text === '#fff'
  const ghostBase = `btn border ${light ? 'border-white/30 bg-black/30 text-white hover:bg-black/50' : 'border-black/20 bg-white/40 text-black hover:bg-white/60'}`
  const ghost = `${ghostBase} px-3! py-1.5`
  // Icon-only actions are 32px squares so five of them fit beside the avatar.
  const icon = 'h-8 w-8 p-0! rounded-md'
  const ghostIcon = `${ghostBase} ${icon}`
  const actions = isMe ? (
    <button onClick={() => { onClose(); openModal({ kind: 'userSettings', tab: 'profile' }) }} className={ghost} title="Edit Profile"><Pencil size={16} /> Edit Profile</button>
  ) : (
    <>
      {rel !== 'blocked' && <button onClick={dm} className={`btn-primary ${icon}`} title="Message"><MessageSquare size={16} /></button>}
      {!rel && <button onClick={addFriend} className={`btn-primary bg-success hover:bg-success/80 text-black ${icon}`} title="Add Friend"><UserPlus size={16} /></button>}
      {rel === 'incoming' && <button onClick={acceptFriend} className="btn-primary bg-success hover:bg-success/80 text-black px-3! py-1.5" title="Accept Friend Request"><Check size={16} /> Accept</button>}
      {rel === 'outgoing' && <button onClick={removeRel} className={ghost} title="Cancel Friend Request"><X size={16} /> Pending</button>}
      {rel === 'friend' && <button onClick={removeRel} className={ghost} title="Remove Friend"><Check size={16} /> Friends</button>}
      {rel === 'blocked' && <button onClick={removeRel} className={ghost} title="Unblock"><Ban size={16} /> Unblock</button>}
      {rel !== 'blocked' && <button onClick={blockUser} className={ghostIcon} title="Block"><Ban size={16} /></button>}
      {canKick && <button onClick={kick} className={`btn-danger ${icon}`} title="Kick"><UserMinus size={16} /></button>}
      {canBan && <button onClick={ban} className={`btn-danger ${icon}`} title="Ban"><Gavel size={16} /></button>}
    </>
  )
  const footer = !isMe && rel !== 'blocked' ? (
    <input value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={onQuickKey} disabled={sending} maxLength={2000}
      placeholder={`Message @${user.username}`} aria-label={`Message @${user.username}`} data-quick-message
      className={`w-full rounded-lg px-3 py-2 text-sm outline-none border transition ${light ? 'bg-black/35 border-white/15 text-white placeholder:text-white/60 focus:border-white/40' : 'bg-white/45 border-black/15 text-black placeholder:text-black/55 focus:border-black/40'}`} />
  ) : null

  return (
    <Popout anchor={anchor} onClose={onClose}>
      <ProfileCard user={user} actions={actions} footer={footer} nameOverride={member?.nickname ? member.nickname : null} nameStyle={roleNameStyle}
        server={guild && member ? { id: guild.id, name: guild.name, icon_url: guild.icon_url, joined_at: member.joined_at } : undefined}>
        {inGuild && member && (
          <section className="w-full">
            <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1 opacity-70">Roles</h3>
            <RolePicker guildId={inGuild} member={member} />
          </section>
        )}
      </ProfileCard>
    </Popout>
  )
}

/**
 * Positions its child next to `anchor` on wide screens (right of it if there is room, else left,
 * clamped to the viewport), as a bottom sheet on phones, or centred when there is no anchor.
 */
function Popout({ anchor, onClose, children }: { anchor?: Anchor; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useLayoutEffect(() => {
    if (!anchor || !wide) return
    const place = () => {
      const h = ref.current?.offsetHeight ?? 400
      const vw = window.innerWidth, vh = window.innerHeight
      let left: number
      if (anchor.x + anchor.w + GAP + CARD_W <= vw - PAD) left = anchor.x + anchor.w + GAP
      else if (anchor.x - GAP - CARD_W >= PAD) left = anchor.x - GAP - CARD_W
      else left = Math.max(PAD, Math.min(anchor.x, vw - CARD_W - PAD))
      // Align the card's top with the anchor, keep it on screen.
      const top = Math.max(PAD, Math.min(anchor.y, vh - h - PAD))
      setStyle({ position: 'fixed', left, top, width: CARD_W, maxHeight: vh - PAD * 2 })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, wide, children])

  if (!anchor) return <Modal onClose={onClose} width="max-w-sm"><div className="-mx-6 -my-4">{children}</div></Modal>
  if (!wide) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div className="sheet-up w-full max-h-[90vh] overflow-y-auto rounded-t-2xl shadow-2xl" role="dialog" aria-modal data-profile-sheet>{children}</div>
      </div>
    )
  }
  return (
    <div className="fixed inset-0 z-50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal data-profile-popout className="pop shadow-2xl rounded-2xl flex flex-col" style={style ?? { position: 'fixed', left: -9999, top: 0, width: CARD_W }}>{children}</div>
    </div>
  )
}

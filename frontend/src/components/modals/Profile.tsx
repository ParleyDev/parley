import { Ban, Check, Gavel, MessageSquare, Pencil, UserMinus, UserPlus, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { myGuildPerms, useStore } from '../../store'
import type { DmChannel, Review, UserProfile } from '../../lib/types'
import { has, highestPosition, P, EMPTY_ROLES } from '../../lib/perms'
import type { Anchor } from '../../lib/anchor'
import { colorRole, roleLook } from '../StyledName'
import RolePicker from '../RolePicker'
import ProfileCard, { contrastText } from '../ProfileCard'
import ProfilePopout, { POPOUT_W } from '../ProfilePopout'
import { colorFor, initials, formatTime, renderMarkdown } from '../../lib/format'
import Avatar from '../Avatar'

const GAP = 8
const PAD = 8

/**
 * A user's profile. With an anchor (something was clicked) it is Discord's compact popout
 * beside that element on wide screens, or a bottom sheet on phones. Without one (deep link,
 * "View Full Profile") it is the full profile modal: card with Member Since, roles, mutual
 * servers and the action buttons.
 */
export default function ProfileModal({ onClose, userId, anchor }: { onClose: () => void; userId: string; anchor?: Anchor }) {
  const cached = useStore((s) => s.users[userId])
  const { pathname } = useLocation()
  const guildId = matchPath('/channels/:guildId/*', pathname)?.params.guildId
  const inGuild = guildId && guildId !== '@me' ? guildId : undefined
  const [user, setUser] = useState<UserProfile | null>(cached ?? null)
  // The cached copy may be partial (built from a member row), so always fetch the full profile,
  // and refetch whenever the cached copy changes (USER_UPDATE, member list load).
  useEffect(() => { api.get<UserProfile>(`/users/${userId}`).then(setUser).catch(() => {}) }, [userId, cached])

  if (anchor) {
    return (
      <Popout anchor={anchor} onClose={onClose}>
        {user ? <ProfilePopout user={user} guildId={inGuild} onClose={onClose} /> : <div className="rounded-lg bg-[#232428] p-6 text-text-2">Loading…</div>}
      </Popout>
    )
  }
  if (!user) return <Modal onClose={onClose}><p className="text-text-2">Loading…</p></Modal>
  return <FullProfile user={user} inGuild={inGuild} onClose={onClose} />
}

function FullProfile({ user, inGuild, onClose }: { user: UserProfile; inGuild?: string; onClose: () => void }) {
  const userId = user.id
  const rel = useStore((s) => s.relationships[userId]?.kind)
  const me = useStore((s) => s.user)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const removeMember = useStore((s) => s.removeMember)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const guild = useStore((s) => (inGuild ? s.guilds[inGuild] : undefined))
  const member = useStore((s) => (inGuild ? s.members[inGuild]?.[userId] : undefined))
  const myMember = useStore((s) => (inGuild && me ? s.members[inGuild]?.[me.id] : undefined))
  const roles = useStore((s) => (inGuild ? s.roles[inGuild] : undefined) ?? EMPTY_ROLES)
  const myPerms = useStore((s) => (inGuild ? myGuildPerms(s, inGuild) : 0))
  const navigate = useNavigate()
  const isMe = me?.id === userId
  const dm = async () => {
    try { const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: userId }); upsertChannel(c); onClose(); navigate(`/channels/@me/${c.id}`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const kick = () => openModal({ kind: 'kick', guildId: inGuild!, userId })
  const ban = () => openModal({ kind: 'ban', guildId: inGuild!, userId })
  const relAct = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } }
  const addFriend = () => relAct(() => api.post('/users/@me/relationships', { user_id: userId }))
  const acceptFriend = () => relAct(() => api.put(`/users/@me/relationships/${userId}`))
  const removeRel = () => relAct(() => api.delete(`/users/@me/relationships/${userId}`))
  const blockUser = () => openModal({ kind: 'confirm', title: `Block ${user.display_name}`, body: `${user.display_name} will not be able to message you or send you friend requests. Any friendship or pending request is removed.`, danger: true, confirmLabel: 'Block', action: () => relAct(() => api.put(`/users/@me/relationships/${userId}/block`)) })

  const ctx = guild ? { guild, roles, member: myMember } : null
  const outranks = !!(guild && ctx && me && !isMe && member && guild.owner_id !== userId && (guild.owner_id === me.id || highestPosition(ctx, me.id) > highestPosition({ ...ctx, member }, userId)))
  const canKick = outranks && has(myPerms, P.KICK_MEMBERS)
  const canBan = outranks && has(myPerms, P.BAN_MEMBERS)
  const roleForName = colorRole(roles, member)
  const roleNameLook = roleForName ? roleLook(roleForName) : undefined

  const text = contrastText(user.theme_primary ?? colorFor(user.id))
  const light = text === '#fff'
  const ghostBase = `btn border ${light ? 'border-white/30 bg-black/30 text-white hover:bg-black/50' : 'border-black/20 bg-white/40 text-black hover:bg-white/60'}`
  const ghost = `${ghostBase} px-3! py-1.5`
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
  const mutual = user.mutual_guilds ?? []
  const friends = user.mutual_friends ?? []
  return (
    <Modal onClose={onClose} width="max-w-sm">
      <div className="-mx-6 -my-4">
        <ProfileCard user={user} actions={actions} nameOverride={member?.nickname ? member.nickname : null} nameLook={roleNameLook}
          server={guild && member ? { id: guild.id, name: guild.name, icon_url: guild.icon_url, joined_at: member.joined_at } : undefined}>
          {inGuild && member && (
            <section className="w-full">
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1 opacity-70">Roles</h3>
              <RolePicker guildId={inGuild} member={member} />
            </section>
          )}
          {friends.length > 0 && (
            <section data-mutual-friends>
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1 opacity-70">Mutual friends — {friends.length}</h3>
              <ul className="space-y-1">
                {friends.map((f) => (
                  <li key={f.id}><button onClick={() => { onClose(); openModal({ kind: 'profile', userId: f.id }) }} className="flex items-center gap-2 hover:underline text-left"><Avatar user={{ id: f.id, display_name: f.display_name, avatar_url: f.avatar_url }} size={20} /><span className="truncate">{f.display_name}</span></button></li>
                ))}
              </ul>
            </section>
          )}
          {mutual.length > 0 && (
            <section data-mutual-list>
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1 opacity-70">Mutual servers — {mutual.length}</h3>
              <ul className="space-y-1">
                {mutual.map((g) => (
                  <li key={g.id}>
                    <button onClick={() => { onClose(); navigate(`/channels/${g.id}`) }} className="flex items-center gap-2 hover:underline text-left">
                      {g.icon_url ? <img src={g.icon_url} alt="" className="h-5 w-5 rounded-full object-cover" /> : <span className="h-5 w-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center" style={{ background: colorFor(g.id) }}>{initials(g.name)}</span>}
                      <span className="truncate">{g.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Reviews userId={userId} light={light} isMe={isMe} />
        </ProfileCard>
      </div>
    </Modal>
  )
}

/** "User Reviews": short notes other users leave on a profile. One per author; only the author can remove theirs. On your own profile you read them but cannot post. */
function Reviews({ userId, light, isMe }: { userId: string; light: boolean; isMe: boolean }) {
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<Review[]>(`/users/${userId}/reviews`).then(setReviews).catch(() => setReviews([])) }, [userId])
  const mine = reviews?.find((r) => r.author_id === me?.id)
  const submit = async () => {
    const content = draft.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      const r = await api.put<Review>(`/users/${userId}/reviews`, { content })
      setReviews((rs) => [r, ...(rs ?? []).filter((x) => x.author_id !== r.author_id)])
      setDraft(''); pushToast(mine ? 'Review updated' : 'Review posted')
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const remove = async (r: Review) => {
    try { await api.delete(`/users/${userId}/reviews/${r.id}`); setReviews((rs) => (rs ?? []).filter((x) => x.id !== r.id)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const field = light ? 'bg-black/35 border-white/15 text-white placeholder:text-white/60 focus:border-white/40' : 'bg-white/45 border-black/15 text-black placeholder:text-black/55 focus:border-black/40'
  return (
    <section data-reviews-list>
      <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1 opacity-70">User reviews{reviews ? ` — ${reviews.length}` : ''}</h3>
      {!isMe && <div className="flex gap-2 mb-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} maxLength={500}
          placeholder={mine ? 'Update your review' : 'Leave a review'} aria-label="Leave a review" data-review-input className={`flex-1 min-w-0 rounded-lg px-3 py-1.5 text-sm outline-none border transition ${field}`} />
        <button onClick={submit} disabled={busy || !draft.trim()} className="btn-primary px-3! py-1.5">Post</button>
      </div>}
      {reviews === null && <p className="opacity-70">Loading…</p>}
      {reviews?.length === 0 && <p className="opacity-70">{isMe ? 'No one has reviewed you yet.' : 'No reviews yet. Be the first!'}</p>}
      <ul className="space-y-2">
        {reviews?.map((r) => (
          <li key={r.id} className="flex gap-2" data-review>
            <Avatar user={{ id: r.author_id, display_name: r.author_display_name, avatar_url: r.author_avatar_url }} size={24} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2"><span className="font-semibold truncate">{r.author_display_name}</span><span className="text-[11px] opacity-70 shrink-0">{formatTime(r.created_at)}</span>
                {r.author_id === me?.id && <button onClick={() => remove(r)} className="ml-auto text-[11px] opacity-70 hover:opacity-100 hover:underline" title="Delete review">Delete</button>}
              </div>
              <div className="msg-content whitespace-pre-wrap break-words leading-snug">{renderMarkdown(r.content, { blocks: false })}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Positions its child next to `anchor` on wide screens (right of it if there is room, else left,
 * clamped to the viewport) or as a bottom sheet on phones.
 */
function Popout({ anchor, onClose, children }: { anchor: Anchor; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useLayoutEffect(() => {
    if (!wide) return
    const place = () => {
      const h = ref.current?.offsetHeight ?? 400
      const vw = window.innerWidth, vh = window.innerHeight
      let left: number
      if (anchor.x + anchor.w + GAP + POPOUT_W <= vw - PAD) left = anchor.x + anchor.w + GAP
      else if (anchor.x - GAP - POPOUT_W >= PAD) left = anchor.x - GAP - POPOUT_W
      else left = Math.max(PAD, Math.min(anchor.x, vw - POPOUT_W - PAD))
      // Align the card's top with the anchor, keep it on screen.
      const top = Math.max(PAD, Math.min(anchor.y, vh - h - PAD))
      setStyle({ position: 'fixed', left, top, width: POPOUT_W })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, wide, children])

  if (!wide) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 safe-area" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div className="sheet-up w-full max-h-[90vh] overflow-y-auto rounded-t-lg" role="dialog" aria-modal data-profile-sheet>{children}</div>
      </div>
    )
  }
  return (
    <div className="fixed inset-0 z-50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal data-profile-popout className="pop" style={style ?? { position: 'fixed', left: -9999, top: 0, width: POPOUT_W }}>{children}</div>
    </div>
  )
}

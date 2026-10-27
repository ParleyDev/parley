import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { withServerProfile } from '../../lib/serverProfile'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Review, UserProfile } from '../../lib/types'
import type { Anchor } from '../../lib/anchor'
import RolePicker from '../RolePicker'
import ProfilePopout, { POPOUT_W } from '../ProfilePopout'
import { colorFor, initials, formatTime, renderMarkdown } from '../../lib/format'
import Avatar from '../Avatar'
import { useT } from '../../lib/i18n'

const GAP = 8
const PAD = 8

/**
 * A user's profile. With an anchor (something was clicked) it is Discord's compact popout
 * beside that element on wide screens, or a bottom sheet on phones. Without one (deep link,
 * "View Full Profile") it is the full profile modal: card with Member Since, roles, mutual
 * servers and the action buttons.
 */
export default function ProfileModal({ onClose, userId, anchor, tab }: { onClose: () => void; userId: string; anchor?: Anchor; tab?: 'roles' | 'friends' | 'servers' | 'reviews' }) {
  const t = useT()
  const cached = useStore((s) => s.users[userId])
  const { pathname } = useLocation()
  const guildId = matchPath('/channels/:guildId/*', pathname)?.params.guildId
  const inGuild = guildId && guildId !== '@me' ? guildId : undefined
  const [fetched, setUser] = useState<UserProfile | null>(cached ?? null)
  const serverMember = useStore((s) => (inGuild ? s.members[inGuild]?.[userId] : undefined))
  const user = useMemo(() => (fetched ? withServerProfile(fetched, serverMember) : null), [fetched, serverMember])
  // The cached copy may be partial (built from a member row), so always fetch the full profile,
  // and refetch whenever the cached copy changes (USER_UPDATE, member list load).
  useEffect(() => { api.get<UserProfile>(`/users/${userId}`).then(setUser).catch(() => {}) }, [userId, cached])

  if (anchor) {
    return (
      <Popout anchor={anchor} onClose={onClose}>
        {user ? <ProfilePopout user={user} guildId={inGuild} onClose={onClose} /> : <div className="rounded-lg bg-[#232428] p-6 text-text-2">{t('Loading…')}</div>}
      </Popout>
    )
  }
  if (!user) return <Modal onClose={onClose}><p className="text-text-2">{t('Loading…')}</p></Modal>
  return <FullProfile user={user} inGuild={inGuild} onClose={onClose} initialTab={tab} />
}

function FullProfile({ user, inGuild, onClose, initialTab }: { user: UserProfile; inGuild?: string; onClose: () => void; initialTab?: 'roles' | 'friends' | 'servers' | 'reviews' }) {
  const t = useT()
  const userId = user.id
  const me = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const member = useStore((s) => (inGuild ? s.members[inGuild]?.[userId] : undefined))
  const navigate = useNavigate()
  const isMe = me?.id === userId
  const mutual = user.mutual_guilds ?? []
  const friends = user.mutual_friends ?? []
  const showRoles = !!(inGuild && member)
  type Tab = 'roles' | 'friends' | 'servers' | 'reviews'
  const tabs: { id: Tab; label: string }[] = [
    ...(showRoles ? [{ id: 'roles' as Tab, label: t('Roles') }] : []),
    { id: 'friends' as Tab, label: friends.length ? t('Mutual Friends — {n}', { n: friends.length }) : t('Mutual Friends') },
    { id: 'servers' as Tab, label: mutual.length ? t('Mutual Servers — {n}', { n: mutual.length }) : t('Mutual Servers') },
    { id: 'reviews' as Tab, label: t('Reviews') },
  ].filter((x) => !(isMe && (x.id === 'friends' || x.id === 'servers')))
  const [tab, setTab] = useState<Tab>(initialTab ?? tabs[0].id)
  const empty = (msg: string) => <p className="py-8 text-center text-sm text-[#b5bac1]">{msg}</p>
  const row = 'w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/[.06]'
  const aside = (
    <div className="flex flex-col min-h-[260px]" data-full-profile-tabs>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-white/10 mb-3" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
            className={`shrink-0 pb-2 -mb-px border-b-2 text-sm font-medium ${tab === x.id ? 'border-white text-white' : 'border-transparent text-[#b5bac1] hover:text-[#dbdee1]'}`} data-profile-tab={x.id}>{x.label}</button>
        ))}
      </div>
      {tab === 'roles' && showRoles && <section data-profile-roles><RolePicker guildId={inGuild!} member={member!} /></section>}
      {tab === 'friends' && (friends.length === 0 ? empty(t('No mutual friends')) : (
        <ul className="space-y-0.5" data-mutual-friends>
          {friends.map((f) => (
            <li key={f.id}><button onClick={() => { onClose(); openModal({ kind: 'profile', userId: f.id }) }} className={row}><Avatar user={{ id: f.id, display_name: f.display_name, avatar_url: f.avatar_url }} size={36} /><span className="truncate font-medium">{f.display_name}</span></button></li>
          ))}
        </ul>
      ))}
      {tab === 'servers' && (mutual.length === 0 ? empty(t('No mutual servers')) : (
        <ul className="space-y-0.5" data-mutual-list>
          {mutual.map((g) => (
            <li key={g.id}>
              <button onClick={() => { onClose(); navigate(`/channels/${g.id}`) }} className={row}>
                {g.icon_url ? <img src={g.icon_url} alt="" className="h-9 w-9 rounded-xl object-cover" /> : <span className="h-9 w-9 rounded-xl text-white text-xs font-bold flex items-center justify-center" style={{ background: colorFor(g.id) }}>{initials(g.name)}</span>}
                <span className="truncate font-medium">{g.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ))}
      {tab === 'reviews' && <Reviews userId={userId} light isMe={isMe} />}
    </div>
  )
  // Discord's full profile: the wide card (big banner and avatar, profile on the left, tabs on the right), in the
  // same colours as the popout, its frame and effect around it. The card scrolls inside the room its frame needs.
  return (
    <Modal onClose={onClose} width="max-w-[720px]" bare>
      <ProfilePopout user={user} guildId={inGuild} onClose={onClose} variant="full" aside={aside} />
    </Modal>
  )
}

/** "User Reviews": short notes other users leave on a profile. One per author; only the author can remove theirs. On your own profile you read them but cannot post. */
function Reviews({ userId, light, isMe }: { userId: string; light: boolean; isMe: boolean }) {
  const t = useT()
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
      setDraft(''); pushToast(mine ? t('Review updated') : t('Review posted'))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const remove = async (r: Review) => {
    try { await api.delete(`/users/${userId}/reviews/${r.id}`); setReviews((rs) => (rs ?? []).filter((x) => x.id !== r.id)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const field = light ? 'bg-black/35 border-white/15 text-white placeholder:text-white/60 focus:border-white/40' : 'bg-white/45 border-black/15 text-black placeholder:text-black/55 focus:border-black/40'
  return (
    <section data-reviews-list>
      <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1 opacity-70">{t('User reviews')}{reviews ? ` — ${reviews.length}` : ''}</h3>
      {!isMe && <div className="flex gap-2 mb-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} maxLength={500}
          placeholder={mine ? t('Update your review') : t('Leave a review')} aria-label={t('Leave a review')} data-review-input className={`flex-1 min-w-0 rounded-lg px-3 py-1.5 text-sm outline-none border transition ${field}`} />
        <button onClick={submit} disabled={busy || !draft.trim()} className="btn-primary px-3! py-1.5">{t('Post')}</button>
      </div>}
      {reviews === null && <p className="opacity-70">Loading…</p>}
      {reviews?.length === 0 && <p className="opacity-70">{isMe ? t('No one has reviewed you yet.') : t('No reviews yet. Be the first!')}</p>}
      <ul className="space-y-2">
        {reviews?.map((r) => (
          <li key={r.id} className="flex gap-2" data-review>
            <Avatar user={{ id: r.author_id, display_name: r.author_display_name, avatar_url: r.author_avatar_url }} size={24} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2"><span className="font-semibold truncate">{r.author_display_name}</span><span className="text-[11px] opacity-70 shrink-0">{formatTime(r.created_at)}</span>
                {r.author_id === me?.id && <button onClick={() => remove(r)} className="ml-auto text-[11px] opacity-70 hover:opacity-100 hover:underline" title={t('Delete review')}>{t('Delete')}</button>}
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
      // A profile frame reaches past the card: its room (padding on the frame wrapper) widens the box, and the whole
      // framed box is what has to fit on screen.
      const room = ref.current?.querySelector<HTMLElement>('[data-frame-room]')
      const cs = room ? getComputedStyle(room) : null
      const side = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0
      const W = POPOUT_W + side
      const vw = window.innerWidth, vh = window.innerHeight
      let left: number
      if (anchor.x + anchor.w + GAP + W <= vw - PAD) left = anchor.x + anchor.w + GAP
      else if (anchor.x - GAP - W >= PAD) left = anchor.x - GAP - W
      else left = Math.max(PAD, Math.min(anchor.x, vw - W - PAD))
      // Align the card's top with the anchor, keep it on screen.
      const top = Math.max(PAD, Math.min(anchor.y - (cs ? parseFloat(cs.paddingTop) || 0 : 0), vh - h - PAD))
      setStyle((o) => (o && o.left === left && o.top === top && o.width === W ? o : { position: 'fixed', left, top, width: W }))
    }
    place()
    window.addEventListener('resize', place)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    if (ref.current) ro?.observe(ref.current)
    return () => { window.removeEventListener('resize', place); ro?.disconnect() }
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

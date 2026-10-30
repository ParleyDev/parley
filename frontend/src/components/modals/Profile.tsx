import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { withServerProfile } from '../../lib/serverProfile'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Review, UserProfile } from '../../lib/types'
import type { Anchor } from '../../lib/anchor'
import ProfilePopout, { POPOUT_W } from '../ProfilePopout'
import { colorFor, initials, formatTime, renderMarkdown } from '../../lib/format'
import Avatar from '../Avatar'
import VoiceCard from '../VoiceCard'
import { ActivityCard } from '../SpotifyActivity'
import { X } from 'lucide-react'
import SelfDock from '../SelfDock'
import { usePhone } from '../../lib/swipe'
import { useT } from '../../lib/i18n'

const GAP = 8
const PAD = 8

/**
 * A user's profile. With an anchor (something was clicked) it is Discord's compact popout
 * beside that element on wide screens, or a bottom sheet on phones. Without one (deep link,
 * "View Full Profile") it is the full profile modal: card with Member Since, roles, mutual
 * servers and the action buttons.
 */
/** Full profiles fetched this session: reopening one shows it whole at once (frame, effect, banner) while it refreshes. */
const profiles = new Map<string, UserProfile>()

export default function ProfileModal({ onClose, userId, anchor, tab, note }: { onClose: () => void; userId: string; anchor?: Anchor; tab?: FullTab | 'roles'; note?: boolean }) {
  const t = useT()
  const cached = useStore((s) => s.users[userId])
  const { pathname } = useLocation()
  const guildId = matchPath('/channels/:guildId/*', pathname)?.params.guildId
  const inGuild = guildId && guildId !== '@me' ? guildId : undefined
  const [fetched, setUser] = useState<UserProfile | null>(profiles.get(userId) ?? cached ?? null)
  // The first time, the cached copy is only partial (no frame, effect or banner): give the full profile a moment
  // before showing it, rather than flashing the bare card and building it up.
  const [complete, setComplete] = useState(profiles.has(userId))
  useEffect(() => { if (complete) return; const id = setTimeout(() => setComplete(true), 500); return () => clearTimeout(id) }, [complete])
  const serverMember = useStore((s) => (inGuild ? s.members[inGuild]?.[userId] : undefined))
  const user = useMemo(() => (fetched ? withServerProfile(fetched, serverMember) : null), [fetched, serverMember])
  // The cached copy may be partial (built from a member row), so always fetch the full profile,
  // and refetch whenever the cached copy changes (USER_UPDATE, member list load).
  // Not found: an account waiting to be deleted (hidden) or gone.
  const [gone, setGone] = useState(false)
  useEffect(() => { api.get<UserProfile>(`/users/${userId}`).then((u) => { profiles.set(userId, u); setUser(u); setComplete(true); setGone(false) }).catch(() => { setGone(true); setComplete(true) }) }, [userId, cached])

  if (gone || user?.deleted) {
    const card = <DeletedCard deleted={!!user?.deleted} />
    return anchor ? <Popout anchor={anchor} onClose={onClose}>{card}</Popout> : <Modal onClose={onClose} width="max-w-xs" bare>{card}</Modal>
  }
  if (anchor) {
    return (
      <Popout anchor={anchor} onClose={onClose}>
        {!complete ? null : user ? <ProfilePopout user={user} guildId={inGuild} onClose={onClose} /> : <div className="rounded-lg bg-[#232428] p-6 text-text-2">{t('Loading…')}</div>}
      </Popout>
    )
  }
  if (!user) return <Modal onClose={onClose}><p className="text-text-2">{t('Loading…')}</p></Modal>
  return <FullProfile user={user} inGuild={inGuild} onClose={onClose} initialTab={tab} focusNote={note} />
}

/** In place of a profile: a deleted account (a tombstone), or one that isn't available (being deleted). */
function DeletedCard({ deleted }: { deleted: boolean }) {
  const t = useT()
  return (
    <div className="rounded-lg bg-[#232428] border border-white/10 shadow-2xl overflow-hidden text-[#dbdee1]" data-profile-deleted={deleted ? 'deleted' : 'unavailable'}>
      <div className="h-16 bg-[#1e1f22]" />
      <div className="px-4 -mt-8"><span className="inline-block rounded-full ring-[6px] ring-[#232428]"><Avatar user={{ id: '0', display_name: 'Deleted User', avatar_url: null }} size={64} /></span></div>
      <div className="px-4 pt-2 pb-4">
        <div className="text-lg font-bold">{t('Deleted User')}</div>
        <p className="text-sm text-[#b5bac1]">{deleted ? t('This account was deleted.') : t("This account isn't available.")}</p>
      </div>
    </div>
  )
}

type FullTab = 'activity' | 'friends' | 'servers' | 'wishlist' | 'games' | 'reviews'

/**
 * Discord's full profile: a window with the profile card on the left (its frame free to reach past the window's
 * edge) and tabs on the right: what they're doing (voice, activity), mutual friends and servers, their wishlist and
 * games when they have some, and reviews. In a server the card carries that server's roles and join date.
 */
function FullProfile({ user, inGuild, onClose, initialTab, focusNote }: { user: UserProfile; inGuild?: string; onClose: () => void; initialTab?: FullTab | 'roles'; focusNote?: boolean }) {
  const t = useT()
  const userId = user.id
  const me = useStore((s) => s.user)
  const openModal = useStore((s) => s.openModal)
  const activity = useStore((s) => s.activities[userId])
  const navigate = useNavigate()
  const isMe = me?.id === userId
  const mutual = user.mutual_guilds ?? []
  const friends = user.mutual_friends ?? []
  const wishlist = user.panels?.wishlist ?? []
  const games = user.panels?.games ?? []
  // On a phone it is a sheet that slides up to the top (Discord mobile), and slides back down when closed or dragged.
  const phone = usePhone()
  const sheet = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  const dismiss = () => {
    if (!phone) return onClose()
    if (sheet.current) { sheet.current.style.transform = ''; sheet.current.style.transition = '' }
    setClosing(true)
    window.setTimeout(onClose, 220)
  }
  const drag = useRef<{ y: number; dy: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { drag.current = (scroller.current?.scrollTop ?? 0) <= 0 && !(e.target as HTMLElement).closest('[data-self-dock-panel]') ? { y: e.touches[0].clientY, dy: 0 } : null }
  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current; const el = sheet.current
    if (!d || !el) return
    d.dy = Math.max(0, e.touches[0].clientY - d.y)
    if (d.dy > 0 && (scroller.current?.scrollTop ?? 0) <= 0) { el.style.transition = 'none'; el.style.transform = `translateY(${d.dy}px)` }
  }
  const onTouchEnd = () => {
    const d = drag.current; const el = sheet.current; drag.current = null
    if (!d || !el || d.dy === 0) return
    if (d.dy > 110) dismiss()
    else { el.style.transition = 'transform .2s ease-out'; el.style.transform = '' }
  }
  const dismissRef = useRef(dismiss); dismissRef.current = dismiss
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-context-menu], [data-lightbox], [data-account-dialog]')) { e.stopImmediatePropagation(); dismissRef.current() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const tabs: { id: FullTab; label: string; count?: number }[] = [
    { id: 'activity', label: t('Activity') },
    ...(isMe ? [] : [
      { id: 'friends' as FullTab, label: t('Mutual Friends'), count: friends.length },
      { id: 'servers' as FullTab, label: t('Mutual Servers'), count: mutual.length },
    ]),
    ...(wishlist.length ? [{ id: 'wishlist' as FullTab, label: t('Wishlist') }] : []),
    ...(games.length ? [{ id: 'games' as FullTab, label: t('Games') }] : []),
    { id: 'reviews', label: t('Reviews') },
  ]
  const [tab, setTab] = useState<FullTab>(initialTab && initialTab !== 'roles' && tabs.some((x) => x.id === initialTab) ? initialTab : 'activity')
  const empty = (msg: string) => <p className="py-10 text-center text-sm text-[#b5bac1]">{msg}</p>
  const row = 'w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/[.06]'
  const panel = 'rounded-xl bg-black/25 p-3'
  return (
    <div className={phone ? `fixed inset-0 z-50 flex flex-col justify-end pt-[calc(env(safe-area-inset-top)+8px)] transition-colors duration-200 ${closing ? 'bg-black/0' : 'bg-black/60'}` : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm safe-pad'} onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss() }}>
      <div className={phone ? 'flex-1 min-h-0 flex flex-col justify-end' : 'flex-1 min-w-0 h-full flex items-center justify-center wide:px-10 wide:py-14'} onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss() }}>
        <div ref={sheet} className={phone ? 'sheet-rise relative w-full h-full overflow-hidden rounded-t-2xl border-t border-line bg-bg-1 shadow-2xl text-[#dbdee1]' : 'pop relative w-full max-w-[1000px] h-[min(820px,100%)] rounded-2xl border border-line bg-bg-1 shadow-2xl flex gap-8 p-10 text-[#dbdee1]'}
          role="dialog" aria-modal aria-label={user.display_name} data-full-profile data-profile-sheet={phone || undefined} data-closing={closing || undefined} onTouchStart={phone ? onTouchStart : undefined} onTouchMove={phone ? onTouchMove : undefined} onTouchEnd={phone ? onTouchEnd : undefined}>
          <div ref={scroller} className={phone ? 'h-full overflow-y-auto overscroll-contain flex flex-col gap-4 p-3 pb-28' : 'contents'} data-profile-sheet-scroll={phone || undefined}>
          <button type="button" onClick={dismiss} className={`absolute z-20 h-9 w-9 flex items-center justify-center ${phone ? 'left-5 top-5 rounded-full bg-black/50' : 'right-3 top-3 rounded-lg bg-black/30 hover:bg-black/50'}`} title={t('Close')} aria-label={t('Close')} data-full-profile-close><X size={20} /></button>
          <div className="w-[400px] shrink-0 wide:h-full phone:w-full" data-full-profile-card>
            <ProfilePopout user={user} guildId={inGuild} onClose={onClose} variant="full" focusNote={focusNote} />
          </div>
          <div className="flex-1 min-w-0 min-h-0 flex flex-col wide:pt-2 phone:flex-none" data-full-profile-tabs>
            {/* One line of tabs, like Discord's: short labels with the count beside them, and a row that scrolls sideways
                (no bar) rather than wrapping when there are many. */}
            <div className="flex flex-nowrap gap-x-6 overflow-x-auto scrollbar-none border-b border-white/10 mb-4 wide:mr-10" role="tablist" data-profile-tabs>
              {tabs.map((x) => (
                <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
                  className={`shrink-0 whitespace-nowrap pb-2.5 border-b-2 text-[15px] font-semibold ${tab === x.id ? 'border-white text-white' : 'border-transparent text-[#b5bac1] hover:text-[#dbdee1]'}`} data-profile-tab={x.id}>
                  {x.label}{x.count ? <span className="ml-1.5 font-normal opacity-70">{x.count}</span> : null}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-3 phone:flex-none phone:overflow-visible">
              {tab === 'activity' && (
                <div className="space-y-3" data-profile-activity>
                  <VoiceCard userId={userId} onJoin={onClose} dark />
                  {activity && <div><div className="text-xs font-bold text-[#b5bac1] mb-2">{t('Current activity')}</div><ActivityCard userId={userId} activity={activity} dark /></div>}
                  {!activity && <ActivityEmpty userId={userId} />}
                </div>
              )}
              {tab === 'friends' && (friends.length === 0 ? empty(t('No mutual friends')) : (
                <ul className="space-y-0.5" data-mutual-friends>
                  {friends.map((f) => (
                    <li key={f.id}><button onClick={() => { onClose(); openModal({ kind: 'profile', userId: f.id }) }} className={row}><Avatar user={{ id: f.id, display_name: f.display_name, avatar_url: f.avatar_url }} size={40} /><span className="truncate font-semibold">{f.display_name}</span></button></li>
                  ))}
                </ul>
              ))}
              {tab === 'servers' && (mutual.length === 0 ? empty(t('No mutual servers')) : (
                <ul className="space-y-0.5" data-mutual-list>
                  {mutual.map((g) => (
                    <li key={g.id}>
                      <button onClick={() => { onClose(); navigate(`/channels/${g.id}`) }} className={row}>
                        {g.icon_url ? <img src={g.icon_url} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <span className="h-10 w-10 rounded-xl text-white text-xs font-bold flex items-center justify-center" style={{ background: colorFor(g.id) }}>{initials(g.name)}</span>}
                        <span className="truncate font-semibold">{g.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
              {tab === 'wishlist' && (
                <ul className={`${panel} space-y-1`} data-panel-wishlist>{wishlist.map((it, i) => <li key={i} className="truncate">{it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="hover:underline">{it.title}</a> : it.title}</li>)}</ul>
              )}
              {tab === 'games' && (
                <ul className="flex flex-wrap gap-2" data-panel-games>{games.map((it, i) => <li key={i} className="rounded-lg bg-black/25 px-3 py-1.5 text-sm">{it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="hover:underline">{it.title}</a> : it.title}</li>)}</ul>
              )}
              {tab === 'reviews' && <div className={panel}><Reviews userId={userId} light isMe={isMe} /></div>}
            </div>
          </div>
          </div>
          {phone && isMe && <SelfDock onClose={onClose} />}
        </div>
      </div>
    </div>
  )
}

/** The Activity tab when there's no game or music: say so, unless they're in voice (the card above covers it). */
function ActivityEmpty({ userId }: { userId: string }) {
  const t = useT()
  const inVoice = useStore((s) => !!s.voiceStates[userId]?.channel_id)
  if (inVoice) return null
  return <p className="py-10 text-center text-sm text-[#b5bac1]" data-profile-no-activity>{t('Nothing going on right now.')}</p>
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
      // Align the card's top with the anchor (the clicked row), then keep the whole framed box on screen and below the
      // channel header and the banner above it, so it never covers the header's buttons or loses its frame's top.
      const header = document.querySelector<HTMLElement>('[data-header-spans] > header, main > header')
      const minTop = Math.max(PAD, (header?.getBoundingClientRect().bottom ?? 0) + GAP)
      const top = Math.max(minTop, Math.min(anchor.y - (cs ? parseFloat(cs.paddingTop) || 0 : 0), vh - h - PAD))
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

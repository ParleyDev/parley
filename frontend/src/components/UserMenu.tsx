import { Award, ChevronRight, IdCard, Pencil, Plus, ShieldCheck, UserCircle } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { frameClass } from '../lib/cosmetics'
import { renderMarkdown } from '../lib/format'
import { t as tr, useT } from '../lib/i18n'
import { profileCardStyle, profileColors } from '../lib/profileLook'
import type { PrivateUser, UserProfile } from '../lib/types'
import { useStore } from '../store'
import AccountSwitcher from './AccountSwitcher'
import Avatar from './Avatar'
import { Badges } from './Flair'
import ProfileEffect from './ProfileEffect'
import { FrameRoom } from './ProfileFrame'
import StyledName from './StyledName'

const statusDurations = () => [
  { label: tr('For 15 minutes'), secs: 15 * 60 }, { label: tr('For 1 hour'), secs: 3600 }, { label: tr('For 8 hours'), secs: 8 * 3600 },
  { label: tr('For 24 hours'), secs: 86400 }, { label: tr('For 3 days'), secs: 3 * 86400 },
]
export const statuses = (): { v: string; label: string; color: string; note?: string }[] => [
  { v: 'online', label: tr('Online'), color: '#3ccf7d' },
  { v: 'idle', label: tr('Idle'), color: '#f6b53d' },
  { v: 'dnd', label: tr('Do Not Disturb'), color: '#f0506e', note: tr('You will not receive desktop notifications') },
  { v: 'invisible', label: tr('Invisible'), color: '#7d8394', note: tr('You will appear offline') },
]

/** A status dot, drawn like Discord's (DND a bar, Invisible a ring, Idle a moon). */
export function StatusDot({ v, size = 10 }: { v: string; size?: number }) {
  const c = statuses().find((s) => s.v === v)?.color ?? '#3ccf7d'
  if (v === 'invisible') return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, border: `${Math.max(2, size / 4)}px solid ${c}` }} />
  if (v === 'dnd') return <span className="shrink-0 rounded-full inline-flex items-center justify-center" style={{ width: size, height: size, background: c }}><span className="rounded-full bg-black/70" style={{ width: size * 0.6, height: Math.max(2, size / 5) }} /></span>
  if (v === 'idle') return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: `radial-gradient(circle at 30% 30%, transparent ${size * 0.32}px, ${c} ${size * 0.33}px)` }} />
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: c }} />
}

/**
 * A side menu next to a row, rendered over everything (a portal, fixed position) so it never stretches the menu or
 * gets clipped: beside the menu on the right, on the left when there is no room, over the menu on narrow screens.
 * React events still bubble through the portal, so hovering from the row into it keeps it open.
 */
/** Space between the menu and a flyout, like Discord's. */
const GAP = 6

function Flyout({ anchor, width, children }: { anchor: HTMLElement | null; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; pad: number; side: 'right' | 'left' | 'over' } | null>(null)
  useLayoutEffect(() => {
    if (!anchor) return
    const row = anchor.getBoundingClientRect()
    // Beside the menu card itself (a frame around it may reach a little past; the flyout sits over that).
    const menu = (anchor.closest('[data-user-menu]') ?? anchor).getBoundingClientRect()
    const h = ref.current?.offsetHeight ?? 0
    const top = Math.max(8, Math.min(row.top, window.innerHeight - h - 8))
    if (menu.right + GAP + width <= window.innerWidth - 8) setPos({ left: row.right, top, pad: menu.right - row.right + GAP, side: 'right' })
    else if (menu.left - GAP - width >= 8) setPos({ left: menu.left - GAP - width, top, pad: 0, side: 'left' })
    else setPos({ left: Math.max(8, Math.min(row.left, window.innerWidth - width - 8)), top: Math.min(row.bottom + 4, window.innerHeight - h - 8), pad: 0, side: 'over' })
  }, [anchor, width])
  return createPortal(
    // The outer box only positions (its padding bridges the gap for the pointer) and stays see-through; the panel is
    // the floating surface, so themes that give floating surfaces a solid background colour only the panel.
    <div ref={ref} className="fixed z-[130]" style={pos ? { left: pos.left, top: pos.top, paddingLeft: pos.pad, paddingRight: pos.side === 'left' ? GAP : 0 } : { left: -9999, top: 0 }} role="menu" data-flyout-side={pos?.side}>
      <div className="pop rounded-xl bg-[#232428] border border-white/10 shadow-2xl p-1.5" style={{ width }} data-flyout-panel>{children}</div>
    </div>,
    document.body,
  )
}

/** A row of the menu's grouped lists; `flyout` opens a side menu on hover or click. */
function Row({ icon, label, extra, onClick, flyout, open, onOpen, ...data }: { icon: ReactNode; label: ReactNode; extra?: ReactNode; onClick?: () => void; flyout?: ReactNode; open?: boolean; onOpen?: (o: boolean) => void } & Record<`data-${string}`, string | undefined>) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setEl} onMouseEnter={flyout ? () => onOpen?.(true) : undefined} onMouseLeave={flyout ? () => onOpen?.(false) : undefined}>
      <button type="button" onClick={flyout ? () => onOpen?.(true) : onClick} aria-haspopup={flyout ? 'menu' : undefined} aria-expanded={flyout ? !!open : undefined}
        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] text-left text-[#dbdee1] hover:bg-white/[.06] ${open ? 'bg-white/[.06]' : ''}`} {...data}>
        <span className="w-5 shrink-0 flex items-center justify-center text-[#b5bac1]">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {extra}
        {flyout && <ChevronRight size={16} className="shrink-0 text-[#b5bac1]" />}
      </button>
      {flyout && open && <Flyout anchor={el} width={256}>{flyout}</Flyout>}
    </div>
  )
}

const Group = ({ children }: { children: ReactNode }) => <div className="rounded-xl bg-black/25 p-1 divide-y divide-white/[.06] [&>*]:rounded-lg">{children}</div>

/**
 * The self menu from the user panel (Discord's layout): your profile card with a status bubble and bio, then
 * Edit Profile, status (a flyout with durations), badges; then Switch Accounts and Copy User ID.
 */
export default function UserMenu({ onClose }: { onClose: () => void }) {
  const t = useT()
  const user = useStore((s) => s.user)!
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [fly, setFly] = useState<'status' | 'accounts' | null>(null)
  const [durations, setDurations] = useState<string | null>(null)
  useEffect(() => { api.get<UserProfile>(`/users/${user.id}`).then(setProfile).catch(() => {}) }, [user.id])

  const setStatus = async (v: string, forSecs?: number) => {
    onClose()
    try {
      // Keep the returned account (it carries status_expires_at, which the public USER_UPDATE leaves out).
      const u = await api.patch<PrivateUser>('/users/@me', { status: v, ...(forSecs ? { status_for_secs: forSecs } : {}) })
      const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
    } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const until = user.status !== 'online' && user.status_expires_at && new Date(user.status_expires_at).getTime() > Date.now()
    ? new Date(user.status_expires_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null
  const current = statuses().find((s) => s.v === user.status) ?? statuses()[0]
  const { gradient } = profileColors(user)
  const reviews = profile?.review_count ?? 0
  const editProfile = () => { onClose(); openModal({ kind: 'editProfile' }) }

  return (
    // The frame's room is part of the floating box, so placement and keep-on-screen account for the frame too.
    <FrameRoom value={user.profile_frame} className="pop absolute bottom-full left-0 mb-2 z-40">
    <div className={`relative w-[300px] max-w-[calc(100vw-16px)] rounded-xl border shadow-2xl text-[#dbdee1] ${frameClass(user.profile_frame)}`} style={profileCardStyle(user)} data-user-menu data-profile-frame={user.profile_frame || undefined}>
      <ProfileEffect id={user.profile_effect} />
      <div className="relative h-[100px] rounded-t-xl bg-cover bg-center" style={user.banner_url ? { backgroundImage: `url(${user.banner_url})` } : { background: gradient }} />
      <div className="relative px-4 -mt-10 flex items-end gap-2">
        <div className="inline-block rounded-full" style={{ boxShadow: '0 0 0 5px #232428' }}><Avatar user={user} size={80} presence animate /></div>
        <button type="button" onClick={() => { onClose(); openModal({ kind: 'customStatus' }) }} className="mb-6 min-w-0 flex-1 truncate rounded-2xl bg-[#111214]/90 px-3 py-2 text-left text-sm text-[#b5bac1] hover:text-[#dbdee1] shadow-lg" data-set-status title={t('Set a custom status')}>
          {user.custom_status ? <span className="text-[#dbdee1]">{user.custom_status}</span> : <span className="inline-flex items-center gap-1.5 italic"><Plus size={14} />{t("What's your hot take?")}</span>}
        </button>
      </div>
      <div className="relative px-4 pt-2 pb-3 space-y-2">
        <div>
          <div className="text-xl font-bold leading-6 truncate flex items-center gap-1.5"><StyledName userId={user.id}>{user.display_name}</StyledName></div>
          <div className="text-sm flex flex-wrap items-center gap-x-1.5"><span>{user.username}</span>{user.pronouns ? <><span className="opacity-60">•</span><span>{user.pronouns}</span></> : null}<Badges badges={profile?.badges} /></div>
        </div>
        {user.bio && <div className="msg-content text-sm leading-[18px] whitespace-pre-wrap break-words max-h-[54px] overflow-hidden" data-user-menu-bio>{renderMarkdown(user.bio, { blocks: false })}</div>}
        <button type="button" onClick={() => { onClose(); openModal({ kind: 'profile', userId: user.id, tab: 'reviews' }) }} className="w-full flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-[13px] font-semibold hover:bg-black/35" data-user-menu-reviews>
          <span>{t('User Reviews')}</span><span className="font-normal text-[#b5bac1]">{reviews === 0 ? t('No reviews yet') : reviews === 1 ? t('{n} review', { n: reviews }) : t('{n} reviews', { n: reviews })}</span>
        </button>
        <Group>
          <Row icon={<Pencil size={18} />} label={t('Edit Profile')} onClick={editProfile} data-user-menu-edit="" />
          <Row icon={<StatusDot v={current.v} size={11} />} label={current.label} open={fly === 'status'} onOpen={(o) => setFly(o ? 'status' : null)} data-status-menu=""
            extra={until ? <span className="shrink-0 text-[11px] text-[#b5bac1]" data-status-until>{t('until {when}', { when: until })}</span> : undefined}
            flyout={statuses().map((s) => (
              <div key={s.v} className="relative" onMouseEnter={() => setDurations(s.v === 'online' ? null : s.v)}>
                <div className="flex items-center rounded-md hover:bg-white/[.06]">
                  <button type="button" onClick={() => setStatus(s.v)} className={`min-w-0 flex-1 flex items-start gap-2.5 px-2 py-2 text-left ${user.status === s.v ? 'text-white' : ''}`} data-status-option={s.v}>
                    <span className="mt-1 flex"><StatusDot v={s.v} /></span>
                    <span className="min-w-0"><span className="block text-sm font-semibold">{s.label}</span>{s.note && <span className="block text-xs text-[#b5bac1]">{s.note}</span>}</span>
                  </button>
                  {s.v !== 'online' && <button type="button" onClick={() => setDurations(s.v)} className="shrink-0 rounded-md p-2 text-[#b5bac1] hover:text-white" title={t('{status} for a while', { status: s.label })} aria-label={t('{status} for a while', { status: s.label })} aria-expanded={durations === s.v} data-status-durations={s.v}><ChevronRight size={16} /></button>}
                </div>
                {durations === s.v && (
                  <div className="absolute left-full top-0 z-50 pl-1.5 max-sm:static max-sm:pl-6 [[data-flyout-side=left]_&]:left-auto [[data-flyout-side=left]_&]:right-full [[data-flyout-side=left]_&]:pl-0 [[data-flyout-side=left]_&]:pr-1.5" role="menu">
                    <div className="pop w-44 max-sm:w-full rounded-xl bg-[#232428] border border-white/10 shadow-2xl p-1.5 space-y-0.5" data-status-duration-list={s.v}>
                      {statusDurations().map((d) => <button key={d.secs} type="button" onClick={() => setStatus(s.v, d.secs)} className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/[.06]" data-status-for={d.secs}>{d.label}</button>)}
                      <button type="button" onClick={() => setStatus(s.v)} className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/[.06]">{t('Forever')}</button>
                    </div>
                  </div>
                )}
              </div>
            ))} />
          <Row icon={<Award size={18} />} label={t('Badges')} onClick={editProfile} data-user-menu-badges="" />
          {user.is_admin && <Row icon={<ShieldCheck size={18} />} label={<span className="text-success">{t('Admin Console')}</span>} onClick={() => { onClose(); navigate('/admin') }} data-admin-console="" />}
        </Group>
        <Group>
          <Row icon={<UserCircle size={18} />} label={t('Switch Accounts')} open={fly === 'accounts'} onOpen={(o) => setFly(o ? 'accounts' : null)} data-switch-accounts=""
            flyout={<><AccountSwitcher /><div className="h-px bg-white/10 my-1" /><button type="button" onClick={() => { onClose(); openModal({ kind: 'userSettings', tab: 'account' }) }} className="w-full rounded-md px-2 py-1.5 text-left text-sm font-semibold hover:bg-white/[.06]" data-manage-accounts>{t('Manage Accounts')}</button></>} />
          <Row icon={<IdCard size={18} />} label={t('Copy User ID')} onClick={() => { onClose(); void navigator.clipboard.writeText(user.id).then(() => pushToast(t('{label} copied', { label: t('User ID') }))).catch(() => {}) }} data-copy-user-id="" />
        </Group>
      </div>
    </div>
    </FrameRoom>
  )
}


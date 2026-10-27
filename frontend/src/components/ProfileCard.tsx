import { Camera, ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { locale, useT } from '../lib/i18n'
import type { User, Connection } from '../lib/types'
import { colorFor, initials, renderMarkdown } from '../lib/format'
import { APP_NAME } from '../lib/brand'
import { LogoMark } from './Logo'
import Avatar, { statusColor } from './Avatar'
import { Badges, ClanTag } from './Flair'
import { nameLook, type NameLook } from '../lib/nameStyle'
import { useStore } from '../store'
import { frameClass } from '../lib/cosmetics'
import ProfileEffect from './ProfileEffect'

export interface ProfileLike extends Pick<User, 'id' | 'username' | 'display_name' | 'avatar_url' | 'bio' | 'created_at'> {
  banner_url?: string | null
  profile_frame?: string
  profile_effect?: string
  private_profile?: boolean
  clan_tag?: string
  avatar_decoration?: string
  name_style?: { font?: string; effect?: string; colors?: string[] } | null
  badges?: string[]
  connections?: Connection[]
  panels?: User['panels']
  theme_primary?: string | null
  theme_accent?: string | null
  pronouns?: string
  status?: string
  name_primary?: string | null
  name_accent?: string | null
  custom_status?: string
}

/** CSS background for a profile: the user's theme (solid or gradient) or a generated colour. */
export function themeBackground(u: ProfileLike): string {
  const a = u.theme_primary ?? colorFor(u.id)
  const b = u.theme_accent
  return b ? `linear-gradient(135deg, ${a}, ${b})` : a
}

/** Pick black or white text for a hex colour. */
export function contrastText(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#fff'
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.4 ? '#0b0c10' : '#fff'
}

/** Presence choices, as in the user panel's menu. */
export const PRESENCE: { v: string; label: string }[] = [
  { v: 'online', label: 'Online' }, { v: 'idle', label: 'Idle' }, { v: 'dnd', label: 'Do Not Disturb' }, { v: 'invisible', label: 'Invisible' },
]

/** Makes the card editable in place (User Settings › Profiles): each handler receives the new value. */
export interface ProfileEdit {
  onDisplayName: (v: string) => void
  onPronouns: (v: string) => void
  onCustomStatus: (v: string) => void
  onAvatarFile: (f: File) => void
  onAvatarRemove: () => void
  onBannerFile: (f: File) => void
  onBannerRemove: () => void
  /** Presence (online, idle, dnd, invisible); applied straight away rather than with Save. */
  status?: string
  onStatus?: (v: string) => void
  /** Which image is uploading, to show progress on it. */
  busy?: 'avatar' | 'banner' | null
}

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/apng'

/** Text that turns into an input when clicked: Enter or leaving the field keeps the change, Escape drops it. */
function InlineText({ value, placeholder, maxLength, onCommit, className, inputClassName, field, required, children }: {
  value: string; placeholder: string; maxLength: number; onCommit: (v: string) => void; className?: string; inputClassName?: string; field: string; required?: boolean; children?: ReactNode
}) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const done = (keep: boolean) => {
    if (draft !== null && keep) { const v = draft.trim(); if (v !== value && (v || !required)) onCommit(v) }
    setDraft(null)
  }
  if (draft !== null) {
    return (
      <input autoFocus value={draft} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={() => done(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); done(true) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false) } }}
        className={`min-w-0 w-full rounded-md bg-black/35 px-1.5 py-0.5 outline-none ring-2 ring-white/40 focus:ring-white/70 text-inherit placeholder:text-current placeholder:opacity-60 ${inputClassName ?? ''}`} data-inline-input={field} />
    )
  }
  return (
    <button type="button" onClick={() => setDraft(value)} className={`group/inline inline-flex min-w-0 max-w-full items-center gap-1 rounded-md px-1 -mx-1 text-left hover:bg-black/20 ${className ?? ''}`} title={t('Click to edit')} data-inline-edit={field}>
      {children ?? (value ? <span className="truncate">{value}</span> : <span className="truncate opacity-60">{placeholder}</span>)}
      <Pencil size={12} className="shrink-0 opacity-0 group-hover/inline:opacity-70" aria-hidden />
    </button>
  )
}

interface Props {
  user: ProfileLike
  /** Edit the name, pronouns, status, avatar and banner right on the card. */
  edit?: ProfileEdit
  /** Icon buttons rendered to the right of the avatar. */
  actions?: ReactNode
  /** Extra sections inside the detail box (e.g. roles). */
  children?: ReactNode
  /** Shown as the name instead of display_name (server nickname). */
  nameOverride?: string | null
  compact?: boolean
  /** Overrides the user's own name style (e.g. a role colour inside a server). */
  nameStyle?: CSSProperties
  /** A ready-made look (role styles) that wins over the user's own. */
  nameLook?: NameLook
  /** When opened inside a server: adds the server join date next to the app join date. */
  server?: { name: string; icon_url: string | null; id: string; joined_at: string }
  /** Rendered at the bottom of the card (the quick "Message @user" box). */
  footer?: ReactNode
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * Discord-style profile popout: banner, overlapping avatar with status, name block, then a
 * detail panel with About Me, Member Since (app + server), roles, and a footer slot.
 * The whole card is tinted with the user's theme colours.
 */
export default function ProfileCard({ user, actions, children, nameOverride, compact, nameStyle, nameLook: nameLook_, server, footer, edit }: Props) {
  const t = useT()
  const avatarRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const [statusMenu, setStatusMenu] = useState(false)
  // "Friends since": when the friend request was accepted.
  const friendsSince = useStore((s) => (s.relationships[user.id]?.kind === 'friend' ? s.relationships[user.id].created_at : null))
  const look = nameLook_ ?? (nameStyle ? { className: '', style: nameStyle } : nameLook(user))
  const nameCssFinal = look.style
  const theme = themeBackground(user)
  const text = contrastText(user.theme_primary ?? colorFor(user.id))
  const light = text === '#fff'
  const dim = light ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'
  const panel = light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'
  const ring = user.theme_primary ?? colorFor(user.id)
  const avatar = compact ? 64 : 80
  return (
    <div className={`relative overflow-hidden rounded-2xl flex flex-col max-h-full ${frameClass(user.profile_frame)}`} style={{ background: theme, color: text }} data-profile-card data-profile-frame={user.profile_frame || undefined}>
      <ProfileEffect id={user.profile_effect} />
      <div className={`group/banner relative ${compact ? 'h-20' : 'h-[105px]'} w-full shrink-0 bg-cover bg-center`} style={user.banner_url ? { backgroundImage: `url(${user.banner_url})` } : { background: 'rgba(0,0,0,0.18)' }}>
        {edit && (
          <>
            <button type="button" onClick={() => bannerRef.current?.click()} disabled={edit.busy === 'banner'} className={`absolute inset-0 flex items-center justify-center gap-2 bg-black/45 text-sm font-semibold text-white transition-opacity ${edit.busy === 'banner' ? 'opacity-100' : 'opacity-0 group-hover/banner:opacity-100 focus-visible:opacity-100'}`} data-inline-banner>
              <Camera size={18} className={edit.busy === 'banner' ? 'animate-pulse' : ''} />{edit.busy === 'banner' ? t('Uploading…') : user.banner_url ? t('Change banner') : t('Add banner')}
            </button>
            {user.banner_url && <button type="button" onClick={edit.onBannerRemove} className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white opacity-0 group-hover/banner:opacity-100 focus-visible:opacity-100 hover:text-danger" title={t('Remove banner')} data-inline-banner-remove><Trash2 size={14} /></button>}
            <input ref={bannerRef} type="file" accept={IMAGE_TYPES} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) edit.onBannerFile(f); e.target.value = '' }} data-inline-banner-input />
          </>
        )}
      </div>
      <div className={`px-4 ${compact ? '-mt-8' : '-mt-11'} flex items-end justify-between shrink-0`}>
        <div className="group/avatar relative rounded-full ring-[6px] bg-bg-1" style={{ ['--tw-ring-color' as string]: ring }}>
          <Avatar user={user} size={avatar} presence decoration={user.avatar_decoration} animate />
          {edit && (
            <>
              <button type="button" onClick={() => avatarRef.current?.click()} disabled={edit.busy === 'avatar'} className={`absolute inset-0 rounded-full flex flex-col items-center justify-center bg-black/50 text-[10px] font-bold uppercase tracking-wide text-white transition-opacity ${edit.busy === 'avatar' ? 'opacity-100' : 'opacity-0 group-hover/avatar:opacity-100 focus-visible:opacity-100'}`} title={t('Change avatar')} data-inline-avatar>
                <Camera size={18} className={edit.busy === 'avatar' ? 'animate-pulse' : ''} />{edit.busy === 'avatar' ? '' : t('Change')}
              </button>
              {user.avatar_url && <button type="button" onClick={edit.onAvatarRemove} className="absolute -right-1 -top-1 rounded-full bg-black/70 p-1 text-white opacity-0 group-hover/avatar:opacity-100 focus-visible:opacity-100 hover:text-danger" title={t('Remove avatar')} data-inline-avatar-remove><Trash2 size={12} /></button>}
              <input ref={avatarRef} type="file" accept={IMAGE_TYPES} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) edit.onAvatarFile(f); e.target.value = '' }} data-inline-avatar-input />
            </>
          )}
        </div>
        {actions && <div className="flex flex-wrap justify-end gap-1.5 pb-1 min-w-0 pl-3">{actions}</div>}
      </div>
      {edit ? (
        <div className="px-4 pt-2 shrink-0 space-y-0.5" data-profile-editable>
          <h2 className="text-xl font-bold leading-tight flex items-center gap-1.5 min-w-0">
            <InlineText field="display_name" value={user.display_name} placeholder={t('Display name')} maxLength={32} required onCommit={edit.onDisplayName} inputClassName="text-xl font-bold">
              <span className={`truncate ${look.className}`} style={nameCssFinal} data-profile-name>{user.display_name}</span>
            </InlineText>
            <ClanTag userId={user.id} tag={user.clan_tag} /><Badges badges={user.badges} className="ml-1" />
          </h2>
          <div className="text-sm flex items-center gap-1 min-w-0" style={{ color: dim }}>
            <span className="shrink-0">{user.username} ·</span>
            <InlineText field="pronouns" value={user.pronouns ?? ''} placeholder={t('Add pronouns')} maxLength={40} onCommit={edit.onPronouns} />
          </div>
          <div className="flex items-center gap-2 min-w-0 pt-1">
            {edit.onStatus && (
              <div className="relative shrink-0">
                <button type="button" onClick={() => setStatusMenu((o) => !o)} className="flex items-center gap-1.5 rounded-full bg-black/25 px-2 py-0.5 text-xs font-medium hover:bg-black/35" aria-haspopup="menu" aria-expanded={statusMenu} data-inline-presence={edit.status ?? 'online'}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor(edit.status, true) }} />{t(PRESENCE.find((p) => p.v === (edit.status ?? 'online'))?.label ?? 'Online')}<ChevronDown size={12} />
                </button>
                {statusMenu && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setStatusMenu(false)} />
                    <div role="menu" className="pop absolute left-0 top-full z-[70] mt-1 w-44 rounded-lg border border-line bg-bg-0 p-1 text-text-0 shadow-2xl">
                      {PRESENCE.map((p) => (
                        <button key={p.v} type="button" role="menuitem" onClick={() => { setStatusMenu(false); edit.onStatus!(p.v) }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-3" data-presence-option={p.v}>
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor(p.v, true) }} />{t(p.label)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <InlineText field="custom_status" value={user.custom_status ?? ''} placeholder={t('Set a custom status')} maxLength={128} onCommit={edit.onCustomStatus} className="text-sm" />
          </div>
        </div>
      ) : (
      <div className="px-4 pt-2 shrink-0">
        <h2 className="text-xl font-bold leading-tight truncate flex items-center gap-1.5"><span className={look.className} style={nameCssFinal} data-profile-name>{nameOverride ?? user.display_name}</span><ClanTag userId={user.id} tag={user.clan_tag} /><Badges badges={user.badges} className="ml-1" /></h2>
        {user.custom_status && <p className="text-sm truncate mb-0.5" data-custom-status>{user.custom_status}</p>}
        <p className="text-sm truncate" style={{ color: dim }}>
          {nameOverride && nameOverride !== user.display_name ? <span className="text-[15px]" style={{ color: text }}>{user.display_name} · </span> : null}
          <span>{user.username}</span>{user.pronouns ? <span> · {user.pronouns}</span> : null}
        </p>
      </div>
      )}
      <div className="px-4 pt-3 pb-4 min-h-0 overflow-y-auto">
        <div className="rounded-xl p-3 space-y-3 text-sm" style={{ background: panel }}>
          {user.bio && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>{t('About me')}</h3>
              <div className="msg-content whitespace-pre-wrap break-words leading-snug">{renderMarkdown(user.bio, { blocks: false })}</div>
            </section>
          )}
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>{t('Member since')}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5" title={APP_NAME}>
                <span className="h-4 w-4 rounded-full bg-bg-0 text-accent flex items-center justify-center shrink-0" aria-hidden><LogoMark className="h-2.5 w-2.5" /></span>
                <span>{fmtDate(user.created_at)}</span>
              </span>
              {server && (
                <>
                  <span className="h-1 w-1 rounded-full" style={{ background: dim }} aria-hidden />
                  <span className="flex items-center gap-1.5" title={server.name} data-server-joined>
                    {server.icon_url
                      ? <img src={server.icon_url} alt="" className="h-4 w-4 rounded-full object-cover shrink-0" />
                      : <span className="h-4 w-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center shrink-0" style={{ background: colorFor(server.id) }} aria-hidden>{initials(server.name)}</span>}
                    <span>{fmtDate(server.joined_at)}</span>
                  </span>
                </>
              )}
            </div>
          </section>
          {friendsSince && (
            <section data-friends-since>
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>{t('Friends since')}</h3>
              <span>{fmtDate(friendsSince)}</span>
            </section>
          )}
          {(user.connections?.length ?? 0) > 0 && (
            <section data-profile-connections>
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>{t('Connections')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {user.connections!.map((c) => (
                  <a key={c.id} href={c.url || undefined} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md bg-bg-0/40 px-2 py-1 text-xs hover:bg-bg-0/70" data-connection={c.provider} title={c.provider}>
                    <span className="h-4 w-4 rounded-sm bg-text-0/15 text-[10px] font-bold flex items-center justify-center uppercase">{c.provider[0]}</span>
                    <span className="truncate max-w-[140px]">{c.name}</span>
                  </a>
                ))}
              </div>
            </section>
          )}
          {(user.panels?.wishlist?.length ?? 0) > 0 && (
            <section data-panel="wishlist">
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>{t('Wishlist')}</h3>
              <ul className="space-y-0.5">{user.panels!.wishlist!.map((it, i) => <li key={i} className="truncate">{it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:decoration-solid">{it.title}</a> : it.title}</li>)}</ul>
            </section>
          )}
          {(user.panels?.games?.length ?? 0) > 0 && (
            <section data-panel="games">
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>{t('Game collection')}</h3>
              <ul className="flex flex-wrap gap-1">{user.panels!.games!.map((it, i) => <li key={i} className="rounded-md px-2 py-0.5 text-xs" style={{ background: 'rgba(0,0,0,0.25)' }}>{it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="hover:underline">{it.title}</a> : it.title}</li>)}</ul>
            </section>
          )}
          {children}
        </div>
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </div>
  )
}

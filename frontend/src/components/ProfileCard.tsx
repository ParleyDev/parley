import type { CSSProperties, ReactNode } from 'react'
import { locale } from '../lib/i18n'
import type { User, Connection } from '../lib/types'
import { colorFor, initials, renderMarkdown } from '../lib/format'
import { APP_INITIAL, APP_NAME } from '../lib/brand'
import Avatar from './Avatar'
import { Badges, ClanTag } from './Flair'
import { nameLook } from '../lib/nameStyle'

export interface ProfileLike extends Pick<User, 'id' | 'username' | 'display_name' | 'avatar_url' | 'bio' | 'created_at'> {
  banner_url?: string | null
  clan_tag?: string
  avatar_decoration?: string
  name_style?: { font?: string; effect?: string } | null
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

interface Props {
  user: ProfileLike
  /** Icon buttons rendered to the right of the avatar. */
  actions?: ReactNode
  /** Extra sections inside the detail box (e.g. roles). */
  children?: ReactNode
  /** Shown as the name instead of display_name (server nickname). */
  nameOverride?: string | null
  compact?: boolean
  /** Overrides the user's own name style (e.g. a role colour inside a server). */
  nameStyle?: CSSProperties
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
export default function ProfileCard({ user, actions, children, nameOverride, compact, nameStyle, server, footer }: Props) {
  const look = nameStyle ? { className: '', style: nameStyle } : nameLook(user)
  const nameCssFinal = look.style
  const theme = themeBackground(user)
  const text = contrastText(user.theme_primary ?? colorFor(user.id))
  const light = text === '#fff'
  const dim = light ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'
  const panel = light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'
  const ring = user.theme_primary ?? colorFor(user.id)
  const avatar = compact ? 64 : 80
  return (
    <div className="overflow-hidden rounded-2xl flex flex-col max-h-full" style={{ background: theme, color: text }} data-profile-card>
      <div className={`${compact ? 'h-20' : 'h-[105px]'} w-full shrink-0 bg-cover bg-center`} style={user.banner_url ? { backgroundImage: `url(${user.banner_url})` } : { background: 'rgba(0,0,0,0.18)' }} />
      <div className={`px-4 ${compact ? '-mt-8' : '-mt-11'} flex items-end justify-between shrink-0`}>
        <div className="rounded-full ring-[6px] bg-bg-1" style={{ ['--tw-ring-color' as string]: ring }}><Avatar user={user} size={avatar} presence decoration={user.avatar_decoration} /></div>
        {actions && <div className="flex flex-wrap justify-end gap-1.5 pb-1 min-w-0 pl-3">{actions}</div>}
      </div>
      <div className="px-4 pt-2 shrink-0">
        <h2 className="text-xl font-bold leading-tight truncate flex items-center gap-1.5"><span className={look.className} style={nameCssFinal} data-profile-name>{nameOverride ?? user.display_name}</span><ClanTag userId={user.id} tag={user.clan_tag} /><Badges badges={user.badges} className="ml-1" /></h2>
        {user.custom_status && <p className="text-sm truncate mb-0.5" data-custom-status>{user.custom_status}</p>}
        <p className="text-sm truncate" style={{ color: dim }}>
          {nameOverride && nameOverride !== user.display_name ? <span className="text-[15px]" style={{ color: text }}>{user.display_name} · </span> : null}
          <span>{user.username}</span>{user.pronouns ? <span> · {user.pronouns}</span> : null}
        </p>
      </div>
      <div className="px-4 pt-3 pb-4 min-h-0 overflow-y-auto">
        <div className="rounded-xl p-3 space-y-3 text-sm" style={{ background: panel }}>
          {user.bio && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>About me</h3>
              <div className="msg-content whitespace-pre-wrap break-words leading-snug">{renderMarkdown(user.bio, { blocks: false })}</div>
            </section>
          )}
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>Member since</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5" title={APP_NAME}>
                <span className="h-4 w-4 rounded-full bg-bg-0 text-text-0 text-[10px] font-bold flex items-center justify-center shrink-0" aria-hidden>{APP_INITIAL}</span>
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
          {(user.connections?.length ?? 0) > 0 && (
            <section data-profile-connections>
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>Connections</h3>
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
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>Wishlist</h3>
              <ul className="space-y-0.5">{user.panels!.wishlist!.map((it, i) => <li key={i} className="truncate">{it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:decoration-solid">{it.title}</a> : it.title}</li>)}</ul>
            </section>
          )}
          {(user.panels?.games?.length ?? 0) > 0 && (
            <section data-panel="games">
              <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>Game collection</h3>
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

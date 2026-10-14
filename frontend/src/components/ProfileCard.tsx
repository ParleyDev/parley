import type { CSSProperties, ReactNode } from 'react'
import type { User } from '../lib/types'
import { colorFor, initials, renderMarkdown } from '../lib/format'
import { APP_INITIAL, APP_NAME } from '../lib/brand'
import Avatar from './Avatar'
import { nameCss } from './StyledName'

export interface ProfileLike extends Pick<User, 'id' | 'username' | 'display_name' | 'avatar_url' | 'bio' | 'created_at'> {
  banner_url?: string | null
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

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * Discord-style profile popout: banner, overlapping avatar with status, name block, then a
 * detail panel with About Me, Member Since (app + server), roles, and a footer slot.
 * The whole card is tinted with the user's theme colours.
 */
export default function ProfileCard({ user, actions, children, nameOverride, compact, nameStyle, server, footer }: Props) {
  const nameCssFinal = nameStyle ?? nameCss(user.name_primary, user.name_accent)
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
        <div className="rounded-full ring-[6px] bg-bg-1" style={{ ['--tw-ring-color' as string]: ring }}><Avatar user={user} size={avatar} presence /></div>
        {actions && <div className="flex flex-wrap justify-end gap-1.5 pb-1 min-w-0 pl-3">{actions}</div>}
      </div>
      <div className="px-4 pt-2 shrink-0">
        <h2 className="text-xl font-bold leading-tight truncate"><span style={nameCssFinal}>{nameOverride ?? user.display_name}</span></h2>
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
          {children}
        </div>
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </div>
  )
}

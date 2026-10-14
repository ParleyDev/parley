import type { ReactNode } from 'react'
import type { User } from '../lib/types'
import { colorFor, renderMarkdown } from '../lib/format'
import Avatar from './Avatar'
import { nameCss } from './StyledName'
import type { CSSProperties } from 'react'

export interface ProfileLike extends Pick<User, 'id' | 'username' | 'display_name' | 'avatar_url' | 'bio' | 'created_at'> {
  banner_url?: string | null
  theme_primary?: string | null
  theme_accent?: string | null
  pronouns?: string
  status?: string
  name_primary?: string | null
  name_accent?: string | null
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
  /** Rendered next to the avatar (action buttons). */
  actions?: ReactNode
  /** Extra rows inside the detail box (e.g. roles, joined date). */
  children?: ReactNode
  /** Shown under the name instead of @username, if set. */
  nameOverride?: string | null
  compact?: boolean
  /** Overrides the user's own name style (e.g. a role colour inside a server). */
  nameStyle?: CSSProperties
}

/**
 * Discord-style profile card: banner (image or theme gradient), avatar, name, pronouns,
 * markdown "About me". The whole card is tinted with the user's theme colours.
 */
export default function ProfileCard({ user, actions, children, nameOverride, compact, nameStyle }: Props) {
  const nameCssFinal = nameStyle ?? nameCss(user.name_primary, user.name_accent)
  const theme = themeBackground(user)
  const text = contrastText(user.theme_primary ?? colorFor(user.id))
  const dim = text === '#fff' ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'
  const panel = text === '#fff' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'
  return (
    <div className="overflow-hidden rounded-2xl" style={{ background: theme, color: text }}>
      <div className={`${compact ? 'h-20' : 'h-28'} w-full bg-cover bg-center`} style={user.banner_url ? { backgroundImage: `url(${user.banner_url})` } : { background: 'rgba(0,0,0,0.18)' }} />
      <div className={`px-4 ${compact ? '-mt-8' : '-mt-10'} flex items-end justify-between`}>
        <div className="rounded-full ring-[6px] bg-bg-1" style={{ ['--tw-ring-color' as string]: user.theme_primary ?? colorFor(user.id) }}><Avatar user={user} size={compact ? 64 : 80} presence /></div>
        {actions && <div className="flex gap-2 pb-1">{actions}</div>}
      </div>
      <div className="px-4 pt-3 pb-4">
        <h2 className="text-xl font-bold leading-tight truncate"><span style={nameCssFinal}>{nameOverride ?? user.display_name}</span></h2>
        <p className="text-sm truncate" style={{ color: dim }}>@{user.username}{user.pronouns ? <span> · {user.pronouns}</span> : null}</p>
        <div className="mt-3 rounded-xl p-3 space-y-3 text-sm" style={{ background: panel }}>
          {user.bio && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: dim }}>About me</div>
              <div className="msg-content whitespace-pre-wrap break-words leading-snug">{renderMarkdown(user.bio)}</div>
            </div>
          )}
          <div className="flex gap-6 flex-wrap">
            <div><div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: dim }}>Member since</div><p>{new Date(user.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</p></div>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

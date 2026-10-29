import type { CSSProperties, ReactNode } from 'react'
import type { Member, Role } from '../lib/types'
import { useStore } from '../store'
import { usePrefs } from '../lib/prefs'
import { nameLook, type NameLook } from '../lib/nameStyle'

/** A role's name look (its style, or its classic colour / gradient). */
export const roleLook = (r: Pick<Role, 'color' | 'color_accent' | 'name_style'>): NameLook => nameLook({ name_primary: r.color, name_accent: r.color_accent, name_style: r.name_style })

export interface NameStyleSource { name_primary?: string | null; name_accent?: string | null }

/** CSS for a solid or gradient-coloured name. Gradient text uses background-clip so it works on any element. */
export function nameCss(primary: string | null | undefined, accent?: string | null): CSSProperties | undefined {
  if (!primary) return undefined
  if (!accent) return { color: primary }
  return { backgroundImage: `linear-gradient(90deg, ${primary}, ${accent})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }
}

/** Highest coloured role a member holds, if any. */
export function colorRole(roles: Record<string, Role>, member: Member | undefined): Role | null {
  if (!member) return null
  let best: Role | null = null
  for (const rid of member.roles) {
    const r = roles[rid]
    if (r && (r.color || r.name_style?.colors?.length) && (!best || r.position > best.position)) best = r
  }
  return best
}

/**
 * Resolve how a name should look. Inside a server the highest coloured role wins (like Discord);
 * otherwise the user's own name style; otherwise the caller's default.
 */
export function resolveNameStyle(roles: Record<string, Role> | undefined, member: Member | undefined, user: NameStyleSource | undefined): CSSProperties | undefined {
  const role = roles ? colorRole(roles, member) : null
  if (role) return nameCss(role.color, role.color_accent)
  return nameCss(user?.name_primary, user?.name_accent)
}

interface Props {
  userId: string
  /** Server context: role colours apply. Omit for DMs / friends. */
  guildId?: string | null
  children?: ReactNode
  className?: string
  /** Extra CSS merged under the computed colour. */
  style?: CSSProperties
}

/** A user's name coloured by role (in a server) or their own name style. Children default to display name / nickname. */
export default function StyledName({ userId, guildId, children, className, style }: Props) {
  const user = useStore((s) => s.users[userId] ?? (s.user?.id === userId ? s.user : undefined))
  const member = useStore((s) => (guildId ? s.members[guildId]?.[userId] : undefined))
  const roles = useStore((s) => (guildId ? s.roles[guildId] : undefined))
  const nick = useStore((s) => s.notes[userId]?.nickname)
  const mode = usePrefs().roleColors
  const role = roles ? colorRole(roles, member) : null
  // Inside a server a coloured role wins (solid or gradient); otherwise the user's own style (font + effect + colours).
  const useRole = mode === 'name' && role
  // The user map may not hold this person yet, or hold a slimmer copy; member rows carry the same style fields,
  // so take whichever source actually has a style.
  const styled = (x: { name_primary?: string | null; name_style?: { colors?: string[] } | null } | undefined) => !!x && (!!x.name_primary || !!x.name_style?.colors?.length)
  const src = styled(user) ? user : styled(member) ? member : user ?? member
  const look = useRole ? roleLook(role) : nameLook(src)
  // Your friend nickname for them wins everywhere, like Discord.
  const label = nick || children || member?.nickname || user?.display_name || user?.username || 'Unknown'
  return <span className={`${className ?? ''} ${look.className}`.trim()} style={{ ...style, ...look.style }} data-role-colors={mode} data-name-effect={useRole ? (role.name_style?.effect ?? (role.color_accent ? 'gradient' : 'solid')) : (src?.name_style?.effect ?? (src?.name_accent ? 'gradient' : src?.name_primary ? 'solid' : undefined))}>{label}{mode === 'next' && role && <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: role.color ?? undefined }} title={role.name} data-role-dot />}</span>
}

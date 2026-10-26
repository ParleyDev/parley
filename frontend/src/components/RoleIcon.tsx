import { useStore } from '../store'
import { EMPTY_ROLES } from '../lib/perms'
import type { Role } from '../lib/types'

/** The icon of a member's highest role that has one (Discord shows it next to their name), or nothing. */
export default function RoleIcon({ guildId, userId, size = 16 }: { guildId: string | null | undefined; userId: string; size?: number }) {
  const role = useStore((s) => {
    if (!guildId) return undefined
    const roles = s.roles[guildId] ?? EMPTY_ROLES
    const mine = s.members[guildId]?.[userId]?.roles ?? []
    let best: Role | undefined
    for (const id of mine) { const r = roles[id]; if (r?.icon && (!best || r.position > best.position)) best = r }
    return best
  })
  if (!role?.icon) return null
  return role.icon.startsWith('/api/images/')
    ? <img src={role.icon} alt={role.name} title={role.name} className="inline-block shrink-0 object-contain align-[-2px]" style={{ width: size, height: size }} data-role-icon={role.id} />
    : <span title={role.name} aria-label={role.name} className="inline-block shrink-0 leading-none" style={{ fontSize: size * 0.95 }} data-role-icon={role.id}>{role.icon}</span>
}

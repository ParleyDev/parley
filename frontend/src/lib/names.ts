import { useStore } from '../store'

type Named = { display_name?: string | null; username?: string | null } | null | undefined

/** A user's own name, outside any server (DMs, friends, profiles): their display name, else their username. */
export function globalName(u: Named): string {
  return u?.display_name?.trim() || u?.username?.trim() || ''
}

/** A user's name where they are shown, as on Discord: their nickname in this server, else the friend nickname you gave them, else their global name. */
export function shownName(u: Named, member?: { nickname?: string | null } | null, friendNick?: string | null): string {
  return member?.nickname?.trim() || friendNick?.trim() || globalName(u)
}

/** `shownName` from the store: the member in `guildId` (none in a DM), your friend nickname, falling back to what the client knows of the user. */
export function nameIn(s: ReturnType<typeof useStore.getState>, userId: string, guildId?: string | null): string {
  const member = guildId ? s.members[guildId]?.[userId] : undefined
  const user = member ?? s.users[userId] ?? (s.user?.id === userId ? s.user : undefined) ?? Object.values(s.members).map((g) => g[userId]).find(Boolean)
  return shownName(user, member, s.notes[userId]?.nickname)
}

/** Hook form of `nameIn`. */
export function useNameIn(userId: string, guildId?: string | null): string {
  return useStore((s) => nameIn(s, userId, guildId))
}

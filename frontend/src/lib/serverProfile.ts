import type { Member } from './types'

/** A user as seen in one server: their server profile's avatar, banner, bio and pronouns win over the main ones. */
export function withServerProfile<T extends { avatar_url: string | null; banner_url?: string | null; bio?: string; pronouns?: string }>(u: T, m: Member | undefined): T {
  if (!m || (!m.guild_avatar && !m.guild_banner && !m.guild_bio && !m.guild_pronouns)) return u
  return { ...u, avatar_url: m.guild_avatar ?? u.avatar_url, banner_url: m.guild_banner ?? u.banner_url, bio: m.guild_bio || u.bio, pronouns: m.guild_pronouns || u.pronouns }
}

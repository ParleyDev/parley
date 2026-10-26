import type { Channel, Guild, Member, Role } from './types'

// Bit values mirror backend/src/perms.rs (and Discord's, for familiarity).
export const P = {
  CREATE_INVITE: 1 << 0,
  KICK_MEMBERS: 1 << 1,
  BAN_MEMBERS: 1 << 2,
  ADMINISTRATOR: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_GUILD: 1 << 5,
  ADD_REACTIONS: 1 << 6,
  STREAM: 1 << 9,
  VIEW_CHANNEL: 1 << 10,
  SEND_MESSAGES: 1 << 11,
  MANAGE_MESSAGES: 1 << 13,
  ATTACH_FILES: 1 << 15,
  MENTION_EVERYONE: 1 << 17,
  CONNECT: 1 << 20,
  SPEAK: 1 << 21,
  CHANGE_NICKNAME: 1 << 26,
  MANAGE_NICKNAMES: 1 << 27,
  MANAGE_ROLES: 1 << 28,
  MODERATE_MEMBERS: 1 << 29,
  MUTE_MEMBERS: 1 << 22,
  DEAFEN_MEMBERS: 1 << 23,
  MOVE_MEMBERS: 1 << 24,
} as const

export type PermKey = keyof typeof P
export const ALL = Object.values(P).reduce((a, b) => a | b, 0)

export interface PermInfo { key: PermKey; label: string; desc: string; group: 'General' | 'Membership' | 'Text' | 'Voice'; channel?: 'text' | 'voice' | 'both' }

/** Display catalogue, in Discord's order. `channel` marks which channel kinds the bit is meaningful for in overwrites. */
export const PERMS: PermInfo[] = [
  { key: 'VIEW_CHANNEL', label: 'View Channels', desc: 'Allows members to view channels by default (excluding private channels).', group: 'General', channel: 'both' },
  { key: 'MANAGE_CHANNELS', label: 'Manage Channels', desc: 'Allows members to create, edit, or delete channels.', group: 'General', channel: 'both' },
  { key: 'MANAGE_ROLES', label: 'Manage Roles', desc: 'Allows members to create new roles and edit or delete roles lower than their highest role. Also allows editing channel permissions.', group: 'General', channel: 'both' },
  { key: 'MANAGE_GUILD', label: 'Manage Server', desc: "Allows members to change this server's name and icon, and to view invites.", group: 'General' },
  { key: 'CREATE_INVITE', label: 'Create Invite', desc: 'Allows members to invite new people to this server.', group: 'Membership', channel: 'both' },
  { key: 'CHANGE_NICKNAME', label: 'Change Nickname', desc: 'Allows members to change their own nickname.', group: 'Membership' },
  { key: 'MANAGE_NICKNAMES', label: 'Manage Nicknames', desc: 'Allows members to change the nicknames of other members.', group: 'Membership' },
  { key: 'KICK_MEMBERS', label: 'Kick Members', desc: 'Allows members to remove other members from this server. Kicked members can rejoin with a new invite.', group: 'Membership' },
  { key: 'MODERATE_MEMBERS', label: 'Timeout Members', desc: 'Allows members to time other members out: they can read but not send messages, react, attach files or use voice until the timeout ends.', group: 'Membership' },
  { key: 'BAN_MEMBERS', label: 'Ban Members', desc: 'Allows members to permanently ban and unban other members from this server. Banned members cannot rejoin until unbanned.', group: 'Membership' },
  { key: 'SEND_MESSAGES', label: 'Send Messages', desc: 'Allows members to send messages in text channels and voice channel chats.', group: 'Text', channel: 'both' },
  { key: 'ATTACH_FILES', label: 'Attach Files', desc: 'Allows members to upload images and files.', group: 'Text', channel: 'both' },
  { key: 'ADD_REACTIONS', label: 'Add Reactions', desc: 'Allows members to add emoji reactions to messages.', group: 'Text', channel: 'both' },
  { key: 'MANAGE_MESSAGES', label: 'Manage Messages', desc: 'Allows members to delete messages by other members.', group: 'Text', channel: 'both' },
  { key: 'CONNECT', label: 'Connect', desc: 'Allows members to join voice channels and hear others.', group: 'Voice', channel: 'voice' },
  { key: 'SPEAK', label: 'Speak', desc: 'Allows members to talk in voice channels.', group: 'Voice', channel: 'voice' },
  { key: 'STREAM', label: 'Video', desc: 'Allows members to share their video and screen in voice channels.', group: 'Voice', channel: 'voice' },
  { key: 'MUTE_MEMBERS', label: 'Mute Members', desc: 'Allows members to mute other members in voice channels for everyone (a server mute).', group: 'Voice', channel: 'voice' },
  { key: 'DEAFEN_MEMBERS', label: 'Deafen Members', desc: 'Allows members to deafen other members in voice channels, so they can neither hear nor speak.', group: 'Voice', channel: 'voice' },
  { key: 'MOVE_MEMBERS', label: 'Move Members', desc: 'Allows members to move or disconnect other members between voice channels they can connect to, and to join full channels.', group: 'Voice', channel: 'voice' },
  { key: 'ADMINISTRATOR', label: 'Administrator', desc: 'Members with this permission have every permission and bypass all channel restrictions. This is a dangerous permission to grant.', group: 'General' },
]

/** Stable empty map so zustand selectors never return a fresh object (which re-renders forever). */
export const EMPTY_ROLES: Record<string, Role> = {}

export const has = (perms: number, bit: number) => (perms & bit) === bit

/** `mfa`: whether this member has two-factor authentication (known for yourself; undefined skips the 2FA rule). */
interface Ctx { guild: Guild; roles: Record<string, Role>; member: Member | undefined; mfa?: boolean }

/** Powers that need 2FA when the server requires it (mirrors perms::MFA_GATED). */
export const MFA_GATED = P.ADMINISTRATOR | P.KICK_MEMBERS | P.BAN_MEMBERS | P.MANAGE_CHANNELS | P.MANAGE_GUILD | P.MANAGE_MESSAGES | P.MANAGE_ROLES | P.MODERATE_MEMBERS

/** Guild-wide permissions for a member (0 if not a member). */
export function guildPerms({ guild, roles, member, mfa }: Ctx, userId: string): number {
  if (guild.owner_id === userId) return ALL
  if (!member) return 0
  let p = roles[guild.id]?.permissions ?? 0
  for (const rid of member.roles) p |= roles[rid]?.permissions ?? 0
  if (guild.mfa_level === 1 && mfa === false) p &= ~MFA_GATED
  return has(p, P.ADMINISTRATOR) ? ALL : p
}

/** Bits a timed-out member loses everywhere (mirrors perms::TIMEOUT_STRIP). */
export const TIMEOUT_STRIP = P.SEND_MESSAGES | P.ADD_REACTIONS | P.ATTACH_FILES | P.CONNECT | P.SPEAK | P.STREAM | P.CREATE_INVITE | P.CHANGE_NICKNAME | P.MENTION_EVERYONE

export const isTimedOut = (m: Member | undefined, now = Date.now()) => !!m?.timeout_until && new Date(m.timeout_until).getTime() > now

/** Apply a channel's overwrites to guild permissions. */
export function channelPerms(ctx: Ctx, userId: string, channel: Channel): number {
  const base = guildPerms(ctx, userId)
  if (has(base, P.ADMINISTRATOR)) return ALL
  let p = base
  const ows = channel.overwrites ?? []
  const everyone = ows.find((o) => o.id === ctx.guild.id)
  if (everyone) p = (p & ~everyone.deny) | everyone.allow
  let allow = 0, deny = 0
  for (const o of ows) {
    if (o.kind === 'role' && o.id !== ctx.guild.id && ctx.member?.roles.includes(o.id)) { allow |= o.allow; deny |= o.deny }
  }
  p = (p & ~deny) | allow
  const mine = ows.find((o) => o.kind === 'member' && o.id === userId)
  if (mine) p = (p & ~mine.deny) | mine.allow
  if (!has(p, P.VIEW_CHANNEL)) return 0
  return isTimedOut(ctx.member) ? p & ~TIMEOUT_STRIP : p
}

/** Highest role position a member holds (0 = only @everyone). Owner outranks all. */
export function highestPosition(ctx: Ctx, userId: string): number {
  if (ctx.guild.owner_id === userId) return Number.MAX_SAFE_INTEGER
  return Math.max(0, ...(ctx.member?.roles ?? []).map((r) => ctx.roles[r]?.position ?? 0))
}

export function canManageRole(ctx: Ctx, actorId: string, role: Role): boolean {
  return ctx.guild.owner_id === actorId || role.id === ctx.guild.id || role.position < highestPosition(ctx, actorId)
}

/** Sorted highest first, @everyone last. */
export function sortedRoles(roles: Record<string, Role>): Role[] {
  return Object.values(roles).sort((a, b) => b.position - a.position || a.created_at.localeCompare(b.created_at))
}

/** The colour a member's name should render in: their highest coloured role, else null. */
export function memberColor(roles: Record<string, Role>, member: Member | undefined): string | null {
  if (!member) return null
  let best: Role | null = null
  for (const rid of member.roles) {
    const r = roles[rid]
    if (r?.color && (!best || r.position > best.position)) best = r
  }
  return best?.color ?? null
}

/** The highest hoisted role, used to group the member list. */
export function hoistRole(roles: Record<string, Role>, member: Member): Role | null {
  let best: Role | null = null
  for (const rid of member.roles) {
    const r = roles[rid]
    if (r?.hoist && (!best || r.position > best.position)) best = r
  }
  return best
}

export const ROLE_COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b', '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457', '#c27c0e', '#a84300', '#992d22', '#979c9f', '#546e7a']

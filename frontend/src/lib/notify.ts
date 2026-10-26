import type { Channel, DmChannel, Guild, Message } from './types'

export type NotifLevel = 'default' | 'all' | 'mentions' | 'nothing'
export interface NotifSetting { target_id: string; level: NotifLevel; muted_until: string | null; suppress_everyone: boolean; suppress_roles?: boolean; mobile_push?: boolean; suppress_highlights?: boolean; mute_events?: boolean }
export interface Effective { level: 'all' | 'mentions' | 'nothing'; muted: boolean; suppressEveryone: boolean; suppressRoles: boolean }

const isMuted = (s?: NotifSetting) => !!s?.muted_until && new Date(s.muted_until).getTime() > Date.now()

/** Channel setting overrides its category's (or a thread's parent channel's), which overrides the server's, which
 *  falls back to the server's default for members (`guilds`, when given); DMs default to all messages. */
export function effective(settings: Record<string, NotifSetting>, channel: (Pick<Channel | DmChannel, 'id' | 'guild_id'> & { parent_id?: string | null; kind?: string }) | undefined, guilds?: Record<string, Guild>): Effective {
  if (!channel) return { level: 'all', muted: false, suppressEveryone: false, suppressRoles: false }
  // Without its own setting, a thread follows its parent channel and a channel its category; then the server.
  const own = settings[channel.id]
  const parent = channel.parent_id ? settings[channel.parent_id] : undefined
  const ch = own?.level && own.level !== 'default' ? own : parent?.level && parent.level !== 'default' ? parent : own ?? parent
  const g = channel.guild_id ? settings[channel.guild_id] : undefined
  const serverDefault = (channel.guild_id && guilds?.[channel.guild_id]?.default_notifications) || 'all'
  const level = (ch?.level && ch.level !== 'default' ? ch.level : g?.level && g.level !== 'default' ? g.level : serverDefault) as Effective['level']
  return { level, muted: isMuted(own) || isMuted(parent) || isMuted(g), suppressEveryone: !!(own?.suppress_everyone || parent?.suppress_everyone || g?.suppress_everyone), suppressRoles: !!(own?.suppress_roles || parent?.suppress_roles || g?.suppress_roles) }
}

export const mutedTarget = (settings: Record<string, NotifSetting>, id: string) => isMuted(settings[id])

/** Should this incoming message raise a desktop notification? */
export function shouldNotify(e: Effective, mentioned: boolean, m: Message, isDm: boolean): boolean {
  if (e.muted || e.level === 'nothing') return false
  if (isDm) return true
  if (e.level === 'mentions') return mentioned
  return !!(m.content || m.attachments?.length || m.sticker)
}

export const MUTE_OPTIONS: { label: string; minutes: number }[] = [
  { label: 'For 15 Minutes', minutes: 15 }, { label: 'For 1 Hour', minutes: 60 }, { label: 'For 8 Hours', minutes: 480 }, { label: 'For 24 Hours', minutes: 1440 }, { label: 'Until I turn it back on', minutes: 0 },
]
export const LEVEL_LABELS: Record<Exclude<NotifLevel, 'default'>, string> = { all: 'All Messages', mentions: 'Only @mentions', nothing: 'Nothing' }

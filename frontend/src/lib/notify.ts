import type { Channel, DmChannel, Message } from './types'

export type NotifLevel = 'default' | 'all' | 'mentions' | 'nothing'
export interface NotifSetting { target_id: string; level: NotifLevel; muted_until: string | null; suppress_everyone: boolean }
export interface Effective { level: 'all' | 'mentions' | 'nothing'; muted: boolean; suppressEveryone: boolean }

const isMuted = (s?: NotifSetting) => !!s?.muted_until && new Date(s.muted_until).getTime() > Date.now()

/** Channel setting overrides the server's; DMs default to all messages. */
export function effective(settings: Record<string, NotifSetting>, channel: Pick<Channel | DmChannel, 'id' | 'guild_id'> | undefined): Effective {
  if (!channel) return { level: 'all', muted: false, suppressEveryone: false }
  const ch = settings[channel.id], g = channel.guild_id ? settings[channel.guild_id] : undefined
  const level = (ch?.level && ch.level !== 'default' ? ch.level : g?.level && g.level !== 'default' ? g.level : 'all') as Effective['level']
  return { level, muted: isMuted(ch) || isMuted(g), suppressEveryone: !!(ch?.suppress_everyone || g?.suppress_everyone) }
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

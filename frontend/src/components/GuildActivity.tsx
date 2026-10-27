import { CalendarDays, MonitorUp, Volume2 } from 'lucide-react'
import { useT } from '../lib/i18n'
import { has, P } from '../lib/perms'
import { colorFor, initials } from '../lib/format'
import type { Guild, GuildEvent } from '../lib/types'
import { myChannelPerms, useStore } from '../store'
import Avatar from './Avatar'

export interface GuildActivity { voice: string[]; streaming: string[]; events: GuildEvent[] }

/**
 * What is happening in a server right now: who is in voice (only channels I can see), who is streaming or on
 * camera, and events that are live.
 */
export function useGuildActivity(guildId: string): GuildActivity {
  const voiceStates = useStore((s) => s.voiceStates)
  const events = useStore((s) => s.liveEvents[guildId])
  const s = useStore.getState()
  const voice: string[] = [], streaming: string[] = []
  for (const v of Object.values(voiceStates)) {
    if (v.guild_id !== guildId || !v.channel_id || !has(myChannelPerms(s, v.channel_id), P.VIEW_CHANNEL)) continue
    if (v.self_stream || v.self_video) streaming.push(v.user_id)
    else voice.push(v.user_id)
  }
  return { voice, streaming, events: events ?? [] }
}

export const hasActivity = (a: GuildActivity) => a.voice.length + a.streaming.length + a.events.length > 0

/** The small badge on a server icon: a live event, someone streaming or on camera, or people talking. */
export function ActivityBadge({ a, top }: { a: GuildActivity; top?: boolean }) {
  const kind = a.events.length ? 'event' : a.streaming.length ? 'stream' : a.voice.length ? 'voice' : null
  if (!kind) return null
  const Icon = kind === 'event' ? CalendarDays : kind === 'stream' ? MonitorUp : Volume2
  return (
    <span className={`absolute -right-1 ${top ? '-top-1' : '-bottom-1'} h-5 w-5 rounded-full ring-[3px] ring-bg-0 flex items-center justify-center ${kind === 'event' ? 'bg-success text-white' : 'bg-bg-0 text-text-0'}`} data-guild-activity={kind} aria-hidden>
      <Icon size={12} strokeWidth={2.5} />
    </span>
  )
}

function Faces({ ids, guildId }: { ids: string[]; guildId: string }) {
  const users = useStore((s) => s.users)
  const members = useStore((s) => s.members[guildId])
  const shown = ids.slice(0, 5)
  return (
    <span className="flex -space-x-1.5">
      {shown.map((id) => {
        const u = users[id] ?? (members?.[id] ? { id, display_name: members[id].display_name, avatar_url: members[id].avatar_url ?? null } : { id, display_name: '?', avatar_url: null })
        return <span key={id} className="rounded-full ring-2 ring-bg-0"><Avatar user={u} size={24} /></span>
      })}
      {ids.length > shown.length && <span className="h-6 min-w-6 px-1.5 rounded-full ring-2 ring-bg-0 bg-bg-3 text-[11px] font-bold flex items-center justify-center">+{ids.length - shown.length}</span>}
    </span>
  )
}

/** Hover card for a server icon: its name, then who is in voice, who is streaming and what event is live. */
export function GuildActivityCard({ guild, a }: { guild: Guild; a: GuildActivity }) {
  const t = useT()
  return (
    <div className="min-w-[200px] max-w-[280px] space-y-2" data-guild-activity-card>
      <div className="flex items-center gap-2 font-bold text-[15px]">
        <span className="h-5 w-5 rounded-md overflow-hidden shrink-0 flex items-center justify-center text-[9px] text-white" style={{ background: guild.icon_url ? undefined : colorFor(guild.id) }}>
          {guild.icon_url ? <img src={guild.icon_url} alt="" className="h-full w-full object-cover" /> : initials(guild.name)}
        </span>
        <span className="truncate">{guild.name}</span>
      </div>
      {a.voice.length > 0 && <div className="flex items-center gap-2" data-activity-row="voice" title={t('In voice')}><Volume2 size={18} className="text-text-2 shrink-0" /><Faces ids={a.voice} guildId={guild.id} /></div>}
      {a.streaming.length > 0 && <div className="flex items-center gap-2" data-activity-row="stream" title={t('Streaming or on camera')}><MonitorUp size={18} className="text-text-2 shrink-0" /><Faces ids={a.streaming} guildId={guild.id} /></div>}
      {a.events.map((e) => (
        <div key={e.id} className="flex items-center gap-2 text-sm font-medium" data-activity-row="event"><CalendarDays size={18} className="text-success shrink-0" /><span className="truncate">{e.name}</span><span className="shrink-0 rounded bg-success px-1 text-[10px] font-bold uppercase text-white">{t('Live')}</span></div>
      ))}
    </div>
  )
}

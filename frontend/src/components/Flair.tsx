import { Award, BadgeCheck, Flame, Server, ShieldCheck, Sparkles, Sprout, Waves, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import Tooltip from './Tooltip'
import { useT } from '../lib/i18n'

/** The user's clan tag as a small chip next to their name, or nothing. */
export function ClanTag({ userId, tag, tagGuild, className = '' }: { userId: string; tag?: string; tagGuild?: string | null; className?: string }) {
  const live = useStore((s) => s.users[userId]?.clan_tag)
  // A server's official tag: its badge, and its name on hover (when you're in it too).
  const liveGid = useStore((s) => s.users[userId]?.clan_tag_guild)
  const gid = liveGid !== undefined ? liveGid : tagGuild
  const guild = useStore((s) => (gid ? s.guilds[gid] : undefined))
  const t = live ?? tag ?? ''
  if (!t) return null
  return <span className={`inline-flex shrink-0 items-center gap-0.5 rounded bg-bg-4 px-1 text-[10px] font-bold leading-4 tracking-wide text-text-1 ${className}`} title={gid ? `Server tag${guild ? ` of ${guild.name}` : ''}` : undefined} data-clan-tag={t} data-server-tag={gid ?? undefined}>{guild?.tag_badge && <span className="text-[11px] leading-none">{guild.tag_badge}</span>}{t}</span>
}

const BADGES: Record<string, { label: string; icon: ReactNode; color: string }> = {
  admin: { label: 'Instance admin', icon: <ShieldCheck size={14} />, color: '#f0506e' },
  founder: { label: 'Founder: one of the first ten accounts', icon: <Sparkles size={14} />, color: '#f6b53d' },
  veteran: { label: 'Veteran: here for over a year', icon: <Award size={14} />, color: '#a78bfa' },
  host: { label: 'Host: owns a server', icon: <Server size={14} />, color: '#38bdf8' },
  verified: { label: 'Verified email', icon: <BadgeCheck size={14} />, color: '#3ccf7d' },
  secure: { label: 'Two-factor authentication on', icon: <Flame size={14} />, color: '#fb923c' },
  house_ember: { label: 'House of Ember', icon: <Zap size={14} />, color: '#f97316' },
  house_tide: { label: 'House of Tide', icon: <Waves size={14} />, color: '#22d3ee' },
  house_grove: { label: 'House of Grove', icon: <Sprout size={14} />, color: '#4ade80' },
}
/** The houses people can join for a badge (Settings → Profiles). */
export const HOUSES = [
  { id: 'ember', badge: 'house_ember', label: 'House of Ember', desc: 'For people who light things up.' },
  { id: 'tide', badge: 'house_tide', label: 'House of Tide', desc: 'For people who keep things flowing.' },
  { id: 'grove', badge: 'house_grove', label: 'House of Grove', desc: 'For people who help things grow.' },
] as const
export const badgeIcon = (b: string) => BADGES[b] ? <span className="flex h-5 w-5 items-center justify-center rounded-md bg-black/25" style={{ color: BADGES[b].color }}>{BADGES[b].icon}</span> : null

/** Row of profile badges with tooltips; nothing when the list is empty. */
export function Badges({ badges, className = '' }: { badges?: string[]; className?: string }) {
  const t = useT()
  const list = (badges ?? []).filter((b) => BADGES[b])
  if (!list.length) return null
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} data-badges={list.join(',')}>
      {list.map((b) => <Tooltip key={b} tip={t(BADGES[b].label)}><span className="flex h-5 w-5 items-center justify-center rounded-md bg-black/25" style={{ color: BADGES[b].color }} data-badge={b}>{BADGES[b].icon}</span></Tooltip>)}
    </span>
  )
}

import { Award, Check, ShieldCheck, Sparkles, Sprout, UserRound, Waves, Zap } from 'lucide-react'
import { useState, type HTMLAttributes, type ReactNode } from 'react'
import ServerTagCard from './ServerTagCard'
import { useStore } from '../store'
import Tooltip from './Tooltip'
import { useT } from '../lib/i18n'
import { customBadgeId, customBadgeTip, useCustomBadges, type CustomBadge } from '../lib/customBadges'

/** A tag chip: the badge, then the tag, tinted with the server's tag colour if it has one. */
export function TagPill({ tag, badge, color, className = '', ...rest }: { tag: string; badge?: string | null; color?: string | null; className?: string } & Omit<HTMLAttributes<HTMLSpanElement>, 'color'>) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-bold leading-4 tracking-wide ${color ? 'text-white' : 'bg-bg-4 text-text-1'} ${className}`}
      style={color ? { background: `color-mix(in srgb, ${color} 55%, #111214)`, boxShadow: `inset 0 0 0 1px ${color}` } : undefined} {...rest}>
      {badge && <span className="text-[11px] leading-none">{badge}</span>}{tag}
    </span>
  )
}

/** The user's clan tag as a small chip next to their name, or nothing. A server's tag opens that server's card. */
export function ClanTag({ userId, tag, tagGuild, className = '' }: { userId: string; tag?: string; tagGuild?: string | null; className?: string }) {
  const live = useStore((s) => s.users[userId]?.clan_tag)
  // A server's official tag: its badge, and its name on hover (when you're in it too).
  const liveGid = useStore((s) => s.users[userId]?.clan_tag_guild)
  const gid = liveGid !== undefined ? liveGid : tagGuild
  const guild = useStore((s) => (gid ? s.guilds[gid] : undefined))
  const [card, setCard] = useState<DOMRect | null>(null)
  const t = live ?? tag ?? ''
  if (!t) return null
  if (!gid) return <TagPill tag={t} className={className} data-clan-tag={t} />
  const open = (e: React.MouseEvent | React.KeyboardEvent) => { e.stopPropagation(); e.preventDefault(); setCard(card ? null : (e.currentTarget as HTMLElement).getBoundingClientRect()) }
  return (
    <>
      <TagPill tag={t} badge={guild?.tag_badge} color={guild?.tag_color} className={`cursor-pointer hover:brightness-125 ${className}`} title={`Server tag${guild ? ` of ${guild.name}` : ''}`}
        role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(e) }} data-clan-tag={t} data-server-tag={gid} />
      {card && <ServerTagCard guildId={gid} anchor={card} onClose={() => setCard(null)} />}
    </>
  )
}

const BADGES: Record<string, { label: string; icon: ReactNode; color: string }> = {
  guest: { label: 'Guest: trying Parley without an account', icon: <UserRound size={14} />, color: '#94a3b8' },
  admin: { label: 'Instance admin', icon: <ShieldCheck size={14} />, color: '#f0506e' },
  founder: { label: 'Founder: one of the first ten accounts', icon: <Sparkles size={14} />, color: '#f6b53d' },
  veteran: { label: 'Veteran: here for over a year', icon: <Award size={14} />, color: '#a78bfa' },
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
/** A custom badge's look: its picture or emoji on a tile tinted with its colour. */
export function CustomBadgeIcon({ badge, size = 20 }: { badge: Pick<CustomBadge, 'emoji' | 'icon_url' | 'color'>; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md" style={{ width: size, height: size, background: `color-mix(in srgb, ${badge.color} 30%, rgb(0 0 0 / 0.25))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${badge.color} 60%, transparent)` }}>
      {badge.icon_url ? <img src={badge.icon_url} alt="" className="rounded-sm object-contain" style={{ width: size * 0.75, height: size * 0.75 }} draggable={false} /> : <span className="leading-none" style={{ fontSize: size * 0.62 }}>{badge.emoji}</span>}
    </span>
  )
}

/** The tag beside the instance's own account ("Parley"), wherever its name shows: ✓ OFFICIAL. */
export function OfficialTag({ className = '' }: { className?: string }) {
  const t = useT()
  return <span className={`inline-flex shrink-0 items-center gap-0.5 rounded bg-accent px-1 py-px text-[10px] font-bold uppercase leading-[14px] text-white ${className}`} data-system-tag title={t('An official message from this Parley server')}><Check size={10} strokeWidth={3} />{t('Official')}</span>
}

export function Badges({ badges, className = '' }: { badges?: string[]; className?: string }) {
  const t = useT()
  const custom = useCustomBadges()
  // Built-in ones by name; custom ones (custom:<id>) from the instance's catalog. Anything unknown (a badge Parley no
  // longer shows, or one deleted a moment ago) is skipped.
  const list = (badges ?? []).flatMap((b) => {
    if (BADGES[b]) return [{ key: b, tip: t(BADGES[b].label), el: <span className="flex h-5 w-5 items-center justify-center rounded-md bg-black/25" style={{ color: BADGES[b].color }}>{BADGES[b].icon}</span> }]
    const id = customBadgeId(b); const c = id ? custom.find((x) => x.id === id) : undefined
    return c ? [{ key: b, tip: customBadgeTip(c), el: <CustomBadgeIcon badge={c} /> }] : []
  })
  if (!list.length) return null
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} data-badges={list.map((b) => b.key).join(',')}>
      {list.map((b) => <Tooltip key={b.key} tip={b.tip}><span className="flex" data-badge={b.key}>{b.el}</span></Tooltip>)}
    </span>
  )
}

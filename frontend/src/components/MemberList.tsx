import { StatusEmojiText } from './StatusText'
import { Circle, Crown, Mic, TimerReset, X } from 'lucide-react'
import Tooltip from './Tooltip'
import { useParams } from 'react-router-dom'
import { channelPerms, has, P } from '../lib/perms'
import { anchorOf } from '../lib/anchor'
import { useStore } from '../store'
import type { Member, Role } from '../lib/types'
import { hoistRole, isTimedOut, sortedRoles, EMPTY_ROLES } from '../lib/perms'
import StyledName from './StyledName'
import RoleIcon from './RoleIcon'
import Avatar from './Avatar'
import { ClanTag } from './Flair'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import { useT } from '../lib/i18n'
import { nameplateClass } from '../lib/cosmetics'
import { ActivityLine } from './SpotifyActivity'
import { isAssetNameplate, NameplateVideo } from './Nameplate'

export default function MemberList({ guildId }: { guildId: string }) {
  const t = useT()
  const members = useStore((s) => s.members[guildId])
  const online = useStore((s) => s.online)
  const users = useStore((s) => s.users)
  const activities = useStore((s) => s.activities)
  const guild = useStore((s) => s.guilds[guildId])
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const openModal = useStore((s) => s.openModal)
  const open = useStore((s) => s.membersOpen)
  const setOpen = useStore((s) => s.setMembersOpen)
  const ctx = useContextMenu()
  const userMenu = useUserMenu(guildId)
  const { channelId } = useParams()
  // A thread shows the members of the channel it lives in.
  const channel = useStore((s) => { const c = channelId ? s.channels[channelId] : undefined; return c?.kind === 'thread' && c.parent_id ? s.channels[c.parent_id] ?? c : c })
  const voiceStates = useStore((s) => s.voiceStates)
  const all = Object.values(members ?? {})
  const visible = (id: string) => online[id] && (users[id]?.status ?? '') !== 'invisible'
  // Header totals: who can read the current channel and is online, everyone, and who is in voice here.
  const canView = (m: Member) => !guild || !channel || channel.guild_id !== guildId || has(channelPerms({ guild, roles, member: m }, m.user_id, channel), P.VIEW_CHANNEL)
  // Like Discord, only members who can see this channel are listed.
  const list = all.filter(canView).sort((a, b) => (a.nickname || a.display_name).localeCompare(b.nickname || b.display_name))
  const onlineHere = list.filter((m) => visible(m.user_id)).length
  const inVoice = Object.values(voiceStates).filter((v) => v.guild_id === guildId && v.channel_id).length

  // Discord grouping: online members under their highest hoisted role, the rest under "Online", offline all together.
  const groups: { key: string; label: string; role: Role | null; members: Member[] }[] = []
  const hoisted = sortedRoles(roles).filter((r) => r.hoist)
  for (const r of hoisted) groups.push({ key: r.id, label: r.name, role: r, members: [] })
  const onlineGroup = { key: 'online', label: t('Online'), role: null, members: [] as Member[] }
  const offlineGroup = { key: 'offline', label: t('Offline'), role: null, members: [] as Member[] }
  for (const m of list) {
    if (!visible(m.user_id)) { offlineGroup.members.push(m); continue }
    const h = hoistRole(roles, m)
    const g = h ? groups.find((x) => x.key === h.id) : undefined
    ;(g ?? onlineGroup).members.push(m)
  }
  const sections = [...groups.filter((g) => g.members.length), onlineGroup, offlineGroup].filter((g) => g.members.length)

  const Row = ({ m, dim }: { m: Member; dim?: boolean }) => {
    const status = users[m.user_id]?.custom_status ?? m.custom_status ?? ''
    const activity = !dim ? activities[m.user_id] : undefined
    return (
      <button data-motion-row onClick={(e) => openModal({ kind: 'profile', userId: m.user_id, anchor: anchorOf(e) })} onContextMenu={(e) => ctx.open(e, userMenu({ id: m.user_id, display_name: m.display_name, nickname: m.nickname }, e.currentTarget.getBoundingClientRect()))} data-member-row={m.user_id} data-nameplate={(!dim && (m.nameplate ?? users[m.user_id]?.nameplate)) || undefined} className={`w-full flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-3 text-left ${dim ? '' : nameplateClass(m.nameplate ?? users[m.user_id]?.nameplate)} ${!dim && isAssetNameplate(m.nameplate ?? users[m.user_id]?.nameplate) ? 'relative isolate overflow-hidden' : ''} ${dim ? 'opacity-40 hover:opacity-100' : ''}`}>
        {!dim && <NameplateVideo value={m.nameplate ?? users[m.user_id]?.nameplate} />}
        <Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.guild_avatar ?? m.avatar_url }} size={32} presence />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1"><StyledName userId={m.user_id} guildId={guildId} className="truncate text-[15px] font-medium text-text-1">{m.nickname || m.display_name}</StyledName><RoleIcon guildId={guildId} userId={m.user_id} size={14} /><ClanTag userId={m.user_id} tag={m.clan_tag} />{guild?.owner_id === m.user_id && <Crown size={14} className="text-warn shrink-0" />}{voiceStates[m.user_id]?.self_stream && <span className="shrink-0 rounded bg-danger px-1 text-[9px] font-extrabold text-white" title={t('Streaming')} data-member-live>{t('LIVE')}</span>}{isTimedOut(m) && <span title={m.quarantined ? t('Quarantined') : t('Timed out until {when}', { when: new Date(m.timeout_until!).toLocaleString() })} className="shrink-0 text-danger" data-member-timeout><TimerReset size={14} /></span>}{m.flags?.includes('raid') && <span title={t('Joined during a raid')} className="shrink-0 rounded bg-warn/20 px-1 text-[9px] font-bold text-warn" data-member-flag="raid">{t('RAID')}</span>}</span>
          {status && !dim ? <span className="block truncate text-xs text-text-2" title={status} data-member-status><StatusEmojiText text={status} /></span> : activity && <ActivityLine activity={activity} />}
        </span>
      </button>
    )
  }

  if (!open) return null
  return (
    <aside aria-label={t('Members')} className="w-[280px] shrink-0 bg-bg-1 overflow-y-auto px-4 pt-4 flex flex-col max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-auto max-lg:pt-0 tab:left-auto tab:w-[300px] tab:shadow-2xl tab:border-l tab:border-line" data-member-list data-layer="lg">
      <div className="lg:hidden h-12 -mx-2 mb-2 px-3 flex items-center gap-2 border-b border-line bg-bg-1 sticky top-0">
        <span className="font-bold">{t('Members')}</span>
        <button onClick={() => setOpen(false)} className="ml-auto h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0"><X size={20} /></button>
      </div>
      {sections.map((g) => (
        <div key={g.key} className="mb-5">
          <h3 className="px-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{g.label} — {g.members.length}</h3>
          <div className="space-y-0.5">{g.members.map((m) => <Row key={m.user_id} m={m} dim={g.key === 'offline'} />)}</div>
        </div>
      ))}
      {/* Parley's counts (online here, members, in voice): a quiet line under the list rather than above it. */}
      <div className="mt-auto pt-2 pb-3 flex items-center gap-4 px-2 text-xs font-semibold text-text-2" data-member-stats>
        <Tooltip tip={t('{n} online in this channel', { n: onlineHere })}><span className="flex items-center gap-1.5 text-success" data-member-stat="online-here" data-member-stat-value={onlineHere}><Circle size={12} className="fill-current" />{onlineHere}</span></Tooltip>
        <Tooltip tip={t('{n} total server members', { n: all.length })}><span className="flex items-center gap-1.5 text-text-2" data-member-stat="total" data-member-stat-value={all.length}><Circle size={12} />{all.length}</span></Tooltip>
        <Tooltip tip={t('{n} members in voice', { n: inVoice })}><span className="flex items-center gap-1.5 text-text-2" data-member-stat="voice" data-member-stat-value={inVoice}><Mic size={13} />{inVoice}</span></Tooltip>
      </div>
      {ctx.menu && <ContextMenu {...ctx.menu} onClose={ctx.close} />}
    </aside>
  )
}

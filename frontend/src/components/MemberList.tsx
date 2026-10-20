import { Circle, Crown, Mic, TimerReset, X } from 'lucide-react'
import Tooltip from './Tooltip'
import { useParams } from 'react-router-dom'
import { channelPerms, has, P } from '../lib/perms'
import { anchorOf } from '../lib/anchor'
import { useStore } from '../store'
import type { Member, Role } from '../lib/types'
import { hoistRole, isTimedOut, sortedRoles, EMPTY_ROLES } from '../lib/perms'
import StyledName from './StyledName'
import Avatar from './Avatar'
import { ClanTag } from './Flair'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import { useT } from '../lib/i18n'

export default function MemberList({ guildId }: { guildId: string }) {
  const t = useT()
  const members = useStore((s) => s.members[guildId])
  const online = useStore((s) => s.online)
  const users = useStore((s) => s.users)
  const guild = useStore((s) => s.guilds[guildId])
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const openModal = useStore((s) => s.openModal)
  const open = useStore((s) => s.membersOpen)
  const setOpen = useStore((s) => s.setMembersOpen)
  const ctx = useContextMenu()
  const userMenu = useUserMenu(guildId)
  const { channelId } = useParams()
  const channel = useStore((s) => (channelId ? s.channels[channelId] : undefined))
  const voiceStates = useStore((s) => s.voiceStates)
  const list = Object.values(members ?? {}).sort((a, b) => (a.nickname ?? a.display_name).localeCompare(b.nickname ?? b.display_name))
  const visible = (id: string) => online[id] && (users[id]?.status ?? '') !== 'invisible'
  // Header totals: who can read the current channel and is online, everyone, and who is in voice here.
  const canView = (m: Member) => !guild || !channel || channel.guild_id !== guildId || has(channelPerms({ guild, roles, member: m }, m.user_id, channel), P.VIEW_CHANNEL)
  const onlineHere = list.filter((m) => visible(m.user_id) && canView(m)).length
  const inVoice = Object.values(voiceStates).filter((v) => v.guild_id === guildId && v.channel_id).length

  // Discord grouping: online members under their highest hoisted role, the rest under "Online", offline all together.
  const groups: { key: string; label: string; role: Role | null; members: Member[] }[] = []
  const hoisted = sortedRoles(roles).filter((r) => r.hoist)
  for (const r of hoisted) groups.push({ key: r.id, label: r.name, role: r, members: [] })
  const onlineGroup = { key: 'online', label: 'Online', role: null, members: [] as Member[] }
  const offlineGroup = { key: 'offline', label: 'Offline', role: null, members: [] as Member[] }
  for (const m of list) {
    if (!visible(m.user_id)) { offlineGroup.members.push(m); continue }
    const h = hoistRole(roles, m)
    const g = h ? groups.find((x) => x.key === h.id) : undefined
    ;(g ?? onlineGroup).members.push(m)
  }
  const sections = [...groups.filter((g) => g.members.length), onlineGroup, offlineGroup].filter((g) => g.members.length)

  const Row = ({ m, dim }: { m: Member; dim?: boolean }) => {
    const status = users[m.user_id]?.custom_status ?? m.custom_status ?? ''
    return (
      <button onClick={(e) => openModal({ kind: 'profile', userId: m.user_id, anchor: anchorOf(e) })} onContextMenu={(e) => ctx.open(e, userMenu({ id: m.user_id, display_name: m.display_name, nickname: m.nickname }, e.currentTarget.getBoundingClientRect()))} data-member-row={m.user_id} className={`w-full flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-3 text-left ${dim ? 'opacity-40 hover:opacity-100' : ''}`}>
        <Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }} size={32} presence />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1"><StyledName userId={m.user_id} guildId={guildId} className="truncate text-[15px] font-medium text-text-1">{m.nickname ?? m.display_name}</StyledName><ClanTag userId={m.user_id} tag={m.clan_tag} />{guild?.owner_id === m.user_id && <Crown size={14} className="text-warn shrink-0" />}{isTimedOut(m) && <span title={`Timed out until ${new Date(m.timeout_until!).toLocaleString()}`} className="shrink-0 text-danger" data-member-timeout><TimerReset size={14} /></span>}</span>
          {status && <span className="block truncate text-xs text-text-2" data-member-status>{status}</span>}
        </span>
      </button>
    )
  }

  if (!open) return null
  return (
    <aside className="w-[280px] shrink-0 bg-bg-1 overflow-y-auto px-4 pt-4 max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-auto max-lg:pt-0 tab:left-auto tab:w-[300px] tab:shadow-2xl tab:border-l tab:border-line" data-member-list>
      <div className="lg:hidden h-12 -mx-2 mb-2 px-3 flex items-center gap-2 border-b border-line bg-bg-1 sticky top-0">
        <span className="font-bold">{t('Members')}</span>
        <button onClick={() => setOpen(false)} className="ml-auto h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0"><X size={20} /></button>
      </div>
      <div className="mb-4 flex items-center gap-4 px-1 text-sm font-semibold" data-member-stats>
        <Tooltip tip={`${onlineHere} online in this channel`}><span className="flex items-center gap-1.5 text-success" data-member-stat="online-here" data-member-stat-value={onlineHere}><Circle size={12} className="fill-current" />{onlineHere}</span></Tooltip>
        <Tooltip tip={`${list.length} total server members`}><span className="flex items-center gap-1.5 text-text-2" data-member-stat="total" data-member-stat-value={list.length}><Circle size={12} />{list.length}</span></Tooltip>
        <Tooltip tip={`${inVoice} members in voice`}><span className="flex items-center gap-1.5 text-text-2" data-member-stat="voice" data-member-stat-value={inVoice}><Mic size={13} />{inVoice}</span></Tooltip>
      </div>
      {sections.map((g) => (
        <div key={g.key} className="mb-5">
          <h3 className="px-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{g.label} — {g.members.length}</h3>
          <div className="space-y-0.5">{g.members.map((m) => <Row key={m.user_id} m={m} dim={g.key === 'offline'} />)}</div>
        </div>
      ))}
      {ctx.menu && <ContextMenu {...ctx.menu} onClose={ctx.close} />}
    </aside>
  )
}

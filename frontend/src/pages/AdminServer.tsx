import { Network } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { globalName } from '../lib/names'
import { can, useAccess } from './adminAccess'
import { NetAvatar, networkLink } from './AdminNetwork'

interface ServerOverview {
  server: {
    id: string; name: string; icon_url: string | null; created_at: string; owner: { id: string; username: string; display_name: string }; state: string
    deletion_scheduled_for: string | null; discovery_status: string | null; members: number; text_channels: number; voice_channels: number
  }
  activity: { messages: number; last_week: number; active_week: number; daily: { day: string; count: number }[] }
  standing: { reports_open: number; reports: number; bans: number; bots: number; friendships_inside: number | null }
  members: { id: string; username: string; display_name: string; avatar_url: string | null; bot: boolean; suspended: boolean; joined_at: string; role: string | null; servers: number; friends_here: number | null }[]
  overlap: { id: string; name: string; icon_url: string | null; owner_username: string; members: number; shared: number }[]
  can_network: boolean
}

function Card({ title, action, children, testid, wide }: { title: string; action?: ReactNode; children: ReactNode; testid: string; wide?: boolean }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-bg-1 p-4 ${wide ? 'md:col-span-2 xl:col-span-3' : ''}`} data-admin-card={testid}>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-2">{title}{action && <span className="ml-auto normal-case tracking-normal">{action}</span>}</h2>
      {children}
    </section>
  )
}
function Stat({ label, value, testid }: { label: string; value: ReactNode; testid?: string }) {
  return <div className="min-w-0"><div className="text-xl font-bold tabular-nums text-text-0" data-admin-stat={testid}>{value}</div><div className="text-xs text-text-2">{label}</div></div>
}
export function NetworkButton({ id, label }: { id: string; label: string }) {
  return <NavLink to={networkLink(id)} className="btn-ghost inline-flex items-center gap-1.5 py-1 text-xs" data-admin-network-link={id}><Network size={14} /> {label}</NavLink>
}

/** /admin/servers/:id — one server at a glance: what it is, how active, its standing, its members and its overlap with other servers. */
export default function ServerDetailPane() {
  const t = useT()
  const a = useAccess()
  const { id } = useParams()
  const navigate = useNavigate()
  const [o, setO] = useState<ServerOverview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'members' | 'overlap'>('members')
  const [filter, setFilter] = useState('')
  useEffect(() => { setO(null); setErr(null); setFilter(''); api.get<ServerOverview>(`/admin/guilds/${id}/overview`).then(setO).catch((e: Error) => setErr(e.message)) }, [id])
  if (err) return <p className="text-sm text-danger">{err}</p>
  if (!o) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  const s = o.server
  const net = o.can_network && can(a, 'network_read')
  const max = Math.max(1, ...o.activity.daily.map((d) => d.count))
  const f = filter.trim().toLowerCase()
  const members = o.members.filter((m) => !f || globalName(m).toLowerCase().includes(f) || m.username.toLowerCase().includes(f))
  const overlap = o.overlap.filter((g) => !f || g.name.toLowerCase().includes(f))
  const link = 'text-xs text-sky-400 hover:underline whitespace-nowrap'
  return (
    <div className="space-y-4" data-admin-server-detail={s.id}>
      <NavLink to="/admin/servers" className="text-xs text-sky-400 hover:underline">{t('← Servers')}</NavLink>
      <div className="flex flex-wrap items-center gap-4">
        <NetAvatar id={s.id} name={s.name} url={s.icon_url} server size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold" data-admin-server-name>{s.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-2">
            <span>{t('Owned by {name}', { name: globalName(s.owner) })}</span>
            <span>· {t('Created {date}', { date: new Date(s.created_at).toLocaleDateString() })}</span>
            <span>· {t('{n} members', { n: s.members })}</span>
            {s.state === 'taken_down' && <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold text-danger" data-badge="taken-down">{t('TAKEN DOWN')}</span>}
            {s.state === 'pending_deletion' && <span className="rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-bold text-warn" data-badge="pending-deletion">{t('DELETING {date}', { date: s.deletion_scheduled_for ? new Date(s.deletion_scheduled_for).toLocaleDateString() : '' })}</span>}
          </div>
        </div>
        {net && <NetworkButton id={s.id} label={t('View in Network')} />}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title={t('Server')} testid="server">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-text-2">{t('Owner')}</dt><dd className="truncate"><NavLink to={`/admin/users/${s.owner.id}`} className="text-sky-400 hover:underline" data-admin-server-owner>{globalName(s.owner)}</NavLink> <span className="text-xs text-text-2">@{s.owner.username}</span></dd>
            <dt className="text-text-2">{t('Server ID')}</dt><dd className="truncate font-mono text-xs">{s.id}</dd>
            <dt className="text-text-2">{t('Channels')}</dt><dd>{t('{text} text · {voice} voice', { text: s.text_channels, voice: s.voice_channels })}</dd>
            <dt className="text-text-2">{t('Discover')}</dt><dd>{s.discovery_status ?? '—'}</dd>
          </dl>
        </Card>
        <Card title={t('Activity')} testid="activity">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('messages')} value={o.activity.messages.toLocaleString()} testid="server-messages" />
            <Stat label={t('last 7 days')} value={o.activity.last_week.toLocaleString()} />
            <Stat label={t('active this week')} value={o.activity.active_week} />
          </div>
          <div className="mt-3 flex h-12 items-end gap-[2px]" title={t('Messages per day, last 30 days')}>
            {o.activity.daily.map((d) => <span key={d.day} className="flex-1 rounded-sm bg-accent/70" style={{ height: `${Math.max(4, (d.count / max) * 100)}%`, opacity: d.count ? 1 : 0.25 }} title={`${new Date(d.day).toLocaleDateString()}: ${d.count}`} />)}
          </div>
        </Card>
        <Card title={t('Standing')} testid="server-standing">
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t('open reports')} value={o.standing.reports_open} testid="server-reports" />
            <Stat label={t('bans')} value={o.standing.bans} testid="server-bans" />
            <Stat label={t('bots')} value={o.standing.bots} />
            {o.standing.friendships_inside !== null && <Stat label={t('friendships inside')} value={o.standing.friendships_inside} testid="server-friendships" />}
          </div>
        </Card>
        <Card title={t('People and overlap')} testid="people" wide>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {(['members', 'overlap'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} data-admin-server-tab={k}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === k ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`}>
                {k === 'members' ? t('Members · {n}', { n: s.members }) : t('Shares members with · {n}', { n: o.overlap.length })}
              </button>
            ))}
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Filter')} aria-label={t('Filter')} className="input ml-auto h-8 w-44 max-w-full text-xs" />
          </div>
          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-line" data-admin-server-list={tab}>
            {tab === 'members' && members.map((m) => (
              <div key={m.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-sm last:border-b-0 hover:bg-bg-3/40 md:grid-cols-[28px_minmax(0,1fr)_auto_auto_auto]" data-admin-server-member={m.id}>
                <NetAvatar id={m.id} name={globalName(m)} url={m.avatar_url} />
                <div className="min-w-0">
                  <b className="block truncate font-semibold">{globalName(m)}{m.bot && <span className="ml-1.5 rounded bg-accent/20 px-1 py-px text-[10px] font-bold text-accent">{t('BOT')}</span>}{m.suspended && <span className="ml-1.5 rounded bg-danger/20 px-1 py-px text-[10px] font-bold text-danger">{t('SUSPENDED')}</span>}</b>
                  <small className="text-[11px] text-text-2">{m.friends_here !== null ? t('{friends} friends here · in {servers} servers', { friends: m.friends_here, servers: m.servers }) : t('in {servers} servers', { servers: m.servers })}</small>
                </div>
                <span className="text-xs text-text-2 max-md:hidden">{m.id === s.owner.id ? <span className="rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-bold text-warn">{t('OWNER')}</span> : (m.role ?? t('Member'))}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-text-2 max-md:hidden">{t('joined {date}', { date: new Date(m.joined_at).toLocaleDateString() })}</span>
                <span className="flex gap-2.5">
                  <button type="button" className={link} onClick={() => navigate(`/admin/users/${m.id}`)} data-admin-open-user={m.id}>{t('Details')}</button>
                  {net && <NavLink to={networkLink(m.id)} className={link}>{t('Network')}</NavLink>}
                </span>
              </div>
            ))}
            {tab === 'members' && o.members.length < s.members && !f && <p className="px-3 py-2 text-xs text-text-2">{t('Showing the first {n} members.', { n: o.members.length })}</p>}
            {tab === 'overlap' && overlap.map((g) => (
              <div key={g.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line px-3 py-2 text-sm last:border-b-0 hover:bg-bg-3/40 md:grid-cols-[28px_minmax(0,1fr)_auto_auto_auto]" data-admin-server-overlap={g.id}>
                <NetAvatar id={g.id} name={g.name} url={g.icon_url} server />
                <div className="min-w-0"><b className="block truncate font-semibold">{g.name}</b><small className="text-[11px] text-text-2">{t('{n} members · owned by @{owner}', { n: g.members, owner: g.owner_username })}</small></div>
                <span className="text-xs text-text-2 max-md:hidden">{t('{n} shared', { n: g.shared })}</span>
                <span className="text-xs tabular-nums text-text-2 max-md:hidden">{t('{pct}% of this server', { pct: Math.round((g.shared / Math.max(1, s.members)) * 100) })}</span>
                <span className="flex gap-2.5">
                  <button type="button" className={link} onClick={() => navigate(`/admin/servers/${g.id}`)}>{t('Details')}</button>
                  {net && <NavLink to={networkLink(g.id)} className={link}>{t('Network')}</NavLink>}
                </span>
              </div>
            ))}
            {((tab === 'members' && !members.length) || (tab === 'overlap' && !overlap.length)) && <p className="px-3 py-3 text-xs text-text-2">{t('Nothing here.')}</p>}
          </div>
        </Card>
      </div>
    </div>
  )
}

import { Eye, FolderOpen, LogOut, UserCheck, UserX } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import CropImg from '../components/CropImg'
import { api } from '../lib/api'
import { colorFor, initials } from '../lib/format'
import { useT } from '../lib/i18n'
import { formatBytes } from '../lib/upload'
import { useStore } from '../store'
import { can, useAccess } from './adminAccess'
import { globalName } from '../lib/names'

const MIN_WHY = 10

interface Overview {
  user: {
    id: string; username: string; display_name: string; avatar_url: string | null; email: string | null; email_verified_at: string | null; created_at: string
    account_state: string; deletion_scheduled_for: string | null; suspended_at: string | null; is_admin: boolean; bot: boolean; guest: boolean; guest_seen_at: string | null
    mfa_enabled: boolean; status: string; custom_status: string; age_group: string; online: boolean; platforms: string[]; last_seen_at: string | null
  }
  messages: { total: number; in_servers: number; in_dms: number; last_day: number; last_week: number; last_month: number; first_at: string | null; last_at: string | null; daily: { day: string; count: number }[]; reactions: number }
  social: { servers: number; servers_owned: number; friends: number; blocked: number; blocked_by: number; apps_owned: number; server_list: { id: string; name: string; icon_url: string | null; owner: boolean; joined_at: string }[] | null }
  standing: { reports_against: number; reports_open: number; reports_filed: number; server_bans: number; audit: { action: string; actor: string; details: Record<string, unknown>; at: string }[] }
  storage: { attachments: number; attachment_bytes: number; images: number; image_bytes: number }
  devices: { active_sessions: number; addresses: number; clients: number; passkeys: number; connections: number; authorized_apps: number; push: { platform: string; count: number; seen_at: string | null }[] }
  can_reveal: boolean
}
interface Signals {
  email: string | null; email_domain: string | null; retention_days: number
  addresses: { ip: string; hits: number; clients: number; first_seen: string; last_seen: string; other_accounts: number }[]
  clients: { user_agent: string; platform: string; hits: number; first_seen: string; last_seen: string; addresses: number }[]
  shared: { id: string; username: string; display_name: string; created_at: string; account_state: string; suspended_at: string | null; guest: boolean; ips: string[] }[]
  connections: { provider: string; name: string; url: string; created_at: string }[]
  push: { platform: string; created_at: string; seen_at: string }[]
  passkeys: { name: string; created_at: string }[]
}

/** "Chrome 131 · Windows", "Parley desktop · macOS", "Safari · iPhone" from a user agent. */
export function describeAgent(ua: string): string {
  if (!ua) return 'Unknown client'
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows NT/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  const v = (re: RegExp) => ua.match(re)?.[1]?.split('.')[0]
  const app = /Tauri|Parley\//i.test(ua) ? 'Parley desktop' : /Capacitor|ParleyApp/i.test(ua) ? 'Parley app'
    : /Edg\//.test(ua) ? `Edge ${v(/Edg\/([\d.]+)/) ?? ''}` : /OPR\//.test(ua) ? `Opera ${v(/OPR\/([\d.]+)/) ?? ''}` : /Firefox\//.test(ua) ? `Firefox ${v(/Firefox\/([\d.]+)/) ?? ''}`
    : /Chrome\//.test(ua) ? `Chrome ${v(/Chrome\/([\d.]+)/) ?? ''}` : /Safari\//.test(ua) ? `Safari ${v(/Version\/([\d.]+)/) ?? ''}` : /curl|python|node|okhttp|Go-http/i.test(ua) ? 'Script / API client' : 'Other'
  return [app.trim(), os].filter(Boolean).join(' · ')
}

const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : '—')
const ago = (d: string | null | undefined) => {
  if (!d) return '—'
  const s = (Date.now() - new Date(d).getTime()) / 1000
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`
}

function Card({ title, children, testid }: { title: string; children: ReactNode; testid: string }) {
  return <section className="rounded-xl border border-line bg-bg-1 p-4" data-admin-card={testid}><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-2">{title}</h2>{children}</section>
}
function Stat({ label, value, sub, testid }: { label: string; value: ReactNode; sub?: ReactNode; testid?: string }) {
  return <div className="min-w-0"><div className="text-xl font-bold tabular-nums text-text-0" data-admin-stat={testid}>{value}</div><div className="text-xs text-text-2">{label}</div>{sub && <div className="text-[11px] text-text-2">{sub}</div>}</div>
}

/** /admin/users/:id — one account at a glance: who, how active, its standing, its devices, and (revealed) where from. */
export default function UserDetailPane() {
  const t = useT()
  const a = useAccess()
  const { id } = useParams()
  const navigate = useNavigate()
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const [o, setO] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sig, setSig] = useState<Signals | null>(null)
  const [why, setWhy] = useState('')
  const [asking, setAsking] = useState(false)
  const load = async () => { try { setO(await api.get<Overview>(`/admin/users/${id}/overview`)) } catch (e) { setErr((e as Error).message) } }
  useEffect(() => { setO(null); setSig(null); setErr(null); setAsking(false); load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <p className="text-sm text-danger">{err}</p>
  if (!o) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  const u = o.user
  const act = can(a, 'content_action')
  const reveal = async (e: FormEvent) => {
    e.preventDefault()
    try { setSig(await api.post<Signals>(`/admin/users/${u.id}/signals`, { justification: why.trim() })); setAsking(false) } catch (x) { pushToast((x as Error).message, 'error') }
  }
  const suspend = async () => {
    try { await api.patch(`/admin/users/${u.id}`, { suspended: !u.suspended_at }); pushToast(u.suspended_at ? t('@{username} unsuspended', { username: u.username }) : t('@{username} suspended', { username: u.username })); load() } catch (x) { pushToast((x as Error).message, 'error') }
  }
  const logoutAll = async () => {
    try { const r = await api.delete<{ revoked: number }>(`/admin/users/${u.id}/sessions`); pushToast(t('Logged out of {n} devices', { n: r.revoked })); load() } catch (x) { pushToast((x as Error).message, 'error') }
  }
  const max = Math.max(1, ...o.messages.daily.map((d) => d.count))
  const badge = (cls: string, label: string, key: string) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`} data-badge={key}>{label}</span>
  return (
    <div className="space-y-4" data-admin-user-detail={u.id}>
      <NavLink to="/admin/users" className="text-xs text-sky-400 hover:underline">{t('← Users')}</NavLink>
      <div className="flex flex-wrap items-center gap-4">
        <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full flex items-center justify-center text-xl font-bold text-white" style={{ background: u.avatar_url ? undefined : colorFor(u.id) }}>
          {u.avatar_url ? <CropImg src={u.avatar_url} alt="" className="h-full w-full object-cover" /> : initials(globalName(u))}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">{globalName(u)} <span className="text-base font-normal text-text-2">@{u.username}</span></h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-2">
            <span className={`h-2 w-2 rounded-full ${u.online ? 'bg-success' : 'bg-text-2'}`} />
            <span data-admin-detail-presence>{u.online ? t('Online now on {platforms}', { platforms: u.platforms.join(', ') || 'web' }) : t('Last seen {when}', { when: ago(u.last_seen_at) })}</span>
            <span>· {t('Joined {date}', { date: new Date(u.created_at).toLocaleDateString() })}</span>
            {u.guest && badge('bg-text-2/20 text-text-1', t('GUEST'), 'guest')}
            {u.bot && badge('bg-accent/20 text-accent', t('BOT'), 'bot')}
            {u.is_admin && badge('bg-success/20 text-success', t('ADMIN'), 'admin')}
            {u.suspended_at && badge('bg-danger/20 text-danger', t('SUSPENDED'), 'suspended')}
            {u.account_state !== 'active' && badge('bg-danger/20 text-danger', u.account_state === 'deleted' ? t('DELETED') : t('DELETING'), 'state')}
            {u.mfa_enabled && badge('bg-sky-500/20 text-sky-300', t('2FA'), 'mfa')}
            {!u.email_verified_at && !u.bot && !u.guest && badge('bg-warn/20 text-warn', t('UNVERIFIED'), 'unverified')}
          </div>
          {u.custom_status && <div className="mt-1 text-sm text-text-1">“{u.custom_status}”</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {act && u.id !== me?.id && u.account_state !== 'deleted' && <button type="button" className={u.suspended_at ? 'btn-ghost py-1.5 text-sm' : 'btn-danger py-1.5 text-sm'} onClick={suspend} data-admin-detail-suspend>{u.suspended_at ? <><UserCheck size={14} /> {t('Unsuspend')}</> : <><UserX size={14} /> {t('Suspend')}</>}</button>}
          {act && <button type="button" className="btn-ghost py-1.5 text-sm" onClick={logoutAll} data-admin-detail-logout><LogOut size={14} /> {t('Log out everywhere')}</button>}
          <button type="button" className="btn-ghost py-1.5 text-sm" onClick={() => navigate(`/admin/users/${u.id}/content`)} data-admin-detail-content><FolderOpen size={14} /> {t('Uploads and sessions')}</button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title={t('Account')} testid="account">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-text-2">{t('Email')}</dt><dd className="truncate" data-admin-detail-email>{u.email ?? '—'} {u.email_verified_at ? <span className="text-xs text-success">✓</span> : null}</dd>
            <dt className="text-text-2">{t('Account ID')}</dt><dd className="truncate font-mono text-xs">{u.id}</dd>
            <dt className="text-text-2">{t('Created')}</dt><dd>{when(u.created_at)}</dd>
            <dt className="text-text-2">{t('Age group')}</dt><dd>{u.age_group}</dd>
            <dt className="text-text-2">{t('Status')}</dt><dd>{u.status}</dd>
            {u.suspended_at && <><dt className="text-text-2">{t('Suspended')}</dt><dd>{when(u.suspended_at)}</dd></>}
            {u.guest && <><dt className="text-text-2">{t('Guest active')}</dt><dd>{when(u.guest_seen_at)}</dd></>}
            {u.deletion_scheduled_for && <><dt className="text-text-2">{t('Deletion')}</dt><dd>{when(u.deletion_scheduled_for)}</dd></>}
          </dl>
        </Card>

        <Card title={t('Messages')} testid="messages">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('total')} value={o.messages.total.toLocaleString()} testid="messages-total" />
            <Stat label={t('last 7 days')} value={o.messages.last_week.toLocaleString()} sub={t('{n} today', { n: o.messages.last_day })} />
            <Stat label={t('last 30 days')} value={o.messages.last_month.toLocaleString()} />
          </div>
          <div className="mt-3 flex h-12 items-end gap-[2px]" title={t('Messages per day, last 30 days')} data-admin-activity>
            {o.messages.daily.map((d) => <span key={d.day} className="flex-1 rounded-sm bg-accent/70" style={{ height: `${Math.max(4, (d.count / max) * 100)}%`, opacity: d.count ? 1 : 0.25 }} title={`${new Date(d.day).toLocaleDateString()}: ${d.count}`} />)}
          </div>
          <div className="mt-2 text-xs text-text-2">{t('{servers} in servers · {dms} in DMs · {reactions} reactions', { servers: o.messages.in_servers.toLocaleString(), dms: o.messages.in_dms.toLocaleString(), reactions: o.messages.reactions.toLocaleString() })}</div>
          <div className="text-xs text-text-2">{t('First {first} · latest {last}', { first: when(o.messages.first_at), last: when(o.messages.last_at) })}</div>
        </Card>

        <Card title={t('Standing')} testid="standing">
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t('reports against them')} value={o.standing.reports_against} sub={o.standing.reports_open ? t('{n} open', { n: o.standing.reports_open }) : undefined} testid="reports" />
            <Stat label={t('reports they filed')} value={o.standing.reports_filed} />
            <Stat label={t('banned from servers')} value={o.standing.server_bans} testid="server-bans" />
            <Stat label={t('blocked by people')} value={o.social.blocked_by} testid="blocked-by" />
          </div>
        </Card>

        <Card title={t('Social')} testid="social">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('servers')} value={o.social.servers} sub={o.social.servers_owned ? t('{n} owned', { n: o.social.servers_owned }) : undefined} testid="servers" />
            <Stat label={t('friends')} value={o.social.friends} />
            <Stat label={t('blocked')} value={o.social.blocked} />
          </div>
          {o.social.server_list && o.social.server_list.length > 0 && (
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm" data-admin-detail-servers>
              {o.social.server_list.map((g) => <li key={g.id} className="flex items-center gap-2"><span className="h-5 w-5 shrink-0 overflow-hidden rounded-md text-[9px] font-bold text-white flex items-center justify-center" style={{ background: g.icon_url ? undefined : colorFor(g.id) }}>{g.icon_url ? <CropImg src={g.icon_url} alt="" className="h-full w-full object-cover" /> : initials(g.name)}</span><span className="truncate">{g.name}</span>{g.owner && <span className="text-[10px] font-bold text-warn">{t('OWNER')}</span>}<span className="ml-auto shrink-0 text-xs text-text-2">{new Date(g.joined_at).toLocaleDateString()}</span></li>)}
            </ul>
          )}
        </Card>

        <Card title={t('Devices and sign-in')} testid="devices">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('active sessions')} value={o.devices.active_sessions} testid="sessions" />
            <Stat label={t('IP addresses')} value={o.devices.addresses} sub={t('last 90 days')} testid="addresses" />
            <Stat label={t('browsers / apps')} value={o.devices.clients} testid="clients" />
            <Stat label={t('passkeys')} value={o.devices.passkeys} />
            <Stat label={t('linked accounts')} value={o.devices.connections} />
            <Stat label={t('authorized apps')} value={o.devices.authorized_apps} />
          </div>
          {o.devices.push.length > 0 && <div className="mt-2 text-xs text-text-2">{t('Push:')} {o.devices.push.map((p) => `${p.platform} × ${p.count}`).join(', ')}</div>}
        </Card>

        <Card title={t('Storage')} testid="storage">
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t('attachments')} value={o.storage.attachments} sub={formatBytes(o.storage.attachment_bytes)} />
            <Stat label={t('profile and emoji images')} value={o.storage.images} sub={formatBytes(o.storage.image_bytes)} />
          </div>
        </Card>
      </div>

      <section className="rounded-xl border border-line bg-bg-1 p-4" data-admin-signals>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-text-2">{t('Where they connect from')}</h2>
          {!sig && o.can_reveal && !asking && <button type="button" className="btn-ghost ml-auto py-1 text-xs" onClick={() => setAsking(true)} data-admin-signals-reveal><Eye size={14} /> {t('Reveal')}</button>}
        </div>
        {!sig && !o.can_reveal && <p className="mt-2 text-sm text-text-2">{t('IP addresses, devices and linked accounts need the PII reveal permission.')}</p>}
        {!sig && o.can_reveal && !asking && <p className="mt-2 text-sm text-text-2">{t('IP addresses, browsers, push devices, linked accounts and other accounts on the same addresses are hidden. Revealing them is logged with your reason.')}</p>}
        {asking && (
          <form onSubmit={reveal} className="mt-3 flex flex-wrap gap-2" data-admin-signals-form>
            <input className="input min-w-0 flex-1" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('Reason (for example, a support ticket number)')} autoFocus data-admin-signals-why />
            <button type="button" className="btn-ghost py-1.5" onClick={() => setAsking(false)}>{t('Cancel')}</button>
            <button className="btn-primary py-1.5" disabled={why.trim().length < MIN_WHY} data-admin-signals-go>{t('Reveal')}</button>
          </form>
        )}
        {sig && (
          <div className="mt-3 space-y-4 text-sm" data-admin-signals-shown>
            <div><span className="text-text-2">{t('Email:')}</span> <b data-admin-signals-email>{sig.email ?? '—'}</b>{sig.email_domain && <span className="text-text-2"> · {t('domain')} {sig.email_domain}</span>}</div>
            <div>
              <h3 className="mb-1 font-semibold">{t('IP addresses ({n}, last {days} days)', { n: sig.addresses.length, days: sig.retention_days })}</h3>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-xs"><thead className="bg-bg-0/40 text-left text-text-2"><tr><th className="px-2 py-1.5">{t('Address')}</th><th className="px-2 py-1.5">{t('Connections')}</th><th className="px-2 py-1.5">{t('Clients')}</th><th className="px-2 py-1.5">{t('First seen')}</th><th className="px-2 py-1.5">{t('Last seen')}</th><th className="px-2 py-1.5">{t('Other accounts')}</th></tr></thead>
                  <tbody>{sig.addresses.map((x) => <tr key={x.ip} className="border-t border-line" data-admin-signal-ip={x.ip}><td className="px-2 py-1.5 font-mono"><button type="button" className="text-sky-400 hover:underline" onClick={() => navigate(`/admin/users?ip=${encodeURIComponent(x.ip)}`)}>{x.ip}</button></td><td className="px-2 py-1.5">{x.hits}</td><td className="px-2 py-1.5">{x.clients}</td><td className="px-2 py-1.5">{when(x.first_seen)}</td><td className="px-2 py-1.5">{when(x.last_seen)}</td><td className={`px-2 py-1.5 ${x.other_accounts ? 'font-bold text-warn' : ''}`}>{x.other_accounts}</td></tr>)}</tbody></table>
                {sig.addresses.length === 0 && <p className="p-2 text-xs text-text-2">{t('None recorded.')}</p>}
              </div>
            </div>
            <div>
              <h3 className="mb-1 font-semibold">{t('Browsers and apps ({n})', { n: sig.clients.length })}</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">{sig.clients.map((c, i) => <li key={i} className="px-2 py-1.5" data-admin-signal-client><div className="font-medium">{describeAgent(c.user_agent)}{c.platform && <span className="ml-1 text-xs text-text-2">({c.platform})</span>}</div><div className="truncate text-[11px] text-text-2" title={c.user_agent}>{c.user_agent || '—'}</div><div className="text-[11px] text-text-2">{t('{hits} connections from {n} addresses · {first} → {last}', { hits: c.hits, n: c.addresses, first: when(c.first_seen), last: when(c.last_seen) })}</div></li>)}</ul>
            </div>
            <div>
              <h3 className="mb-1 font-semibold">{t('Other accounts on the same addresses ({n})', { n: sig.shared.length })}</h3>
              {sig.shared.length === 0 ? <p className="text-xs text-text-2">{t('None.')}</p> : (
                <ul className="divide-y divide-line rounded-lg border border-line" data-admin-signal-shared>{sig.shared.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5"><button type="button" className="font-semibold text-sky-400 hover:underline" onClick={() => navigate(`/admin/users/${s.id}`)} data-admin-shared-user={s.username}>{globalName(s)} <span className="font-normal text-text-2">@{s.username}</span></button>{s.guest && <span className="text-[10px] font-bold text-text-2">{t('GUEST')}</span>}{s.suspended_at && <span className="text-[10px] font-bold text-danger">{t('SUSPENDED')}</span>}{s.account_state !== 'active' && <span className="text-[10px] font-bold text-danger">{s.account_state.toUpperCase()}</span>}<span className="ml-auto font-mono text-[11px] text-text-2">{s.ips.join(', ')}</span></li>)}</ul>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div><h3 className="mb-1 font-semibold">{t('Linked accounts')}</h3>{sig.connections.length === 0 ? <p className="text-xs text-text-2">{t('None.')}</p> : <ul className="text-xs">{sig.connections.map((c) => <li key={c.provider + c.name}><b className="capitalize">{c.provider}</b> {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{c.name}</a> : c.name}</li>)}</ul>}</div>
              <div><h3 className="mb-1 font-semibold">{t('Push devices')}</h3>{sig.push.length === 0 ? <p className="text-xs text-text-2">{t('None.')}</p> : <ul className="text-xs">{sig.push.map((p, i) => <li key={i}>{p.platform} · {t('since {date}', { date: new Date(p.created_at).toLocaleDateString() })} · {t('seen {date}', { date: new Date(p.seen_at).toLocaleDateString() })}</li>)}</ul>}</div>
              <div><h3 className="mb-1 font-semibold">{t('Passkeys')}</h3>{sig.passkeys.length === 0 ? <p className="text-xs text-text-2">{t('None.')}</p> : <ul className="text-xs">{sig.passkeys.map((p, i) => <li key={i}>{p.name} · {new Date(p.created_at).toLocaleDateString()}</li>)}</ul>}</div>
            </div>
          </div>
        )}
      </section>

      {o.standing.audit.length > 0 && (
        <Card title={t('Admin actions on this account')} testid="audit">
          <ul className="space-y-1 text-sm">{o.standing.audit.map((x, i) => <li key={i} className="flex flex-wrap gap-2"><span className="font-mono text-xs">{x.action}</span><span className="text-text-2">{t('by {name}', { name: x.actor })}</span><span className="ml-auto text-xs text-text-2">{when(x.at)}</span></li>)}</ul>
        </Card>
      )}
    </div>
  )
}

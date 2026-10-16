import { Compass, FileSearch, Flag, FolderOpen, Gavel, KeyRound, LayoutDashboard, LogOut, ScrollText, Megaphone, Server, ShieldCheck, ShieldOff, Trash2, UserCheck, Users, UserX } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import SplitLayout, { useShowContent } from '../components/SplitLayout'
import { MobileBack } from '../components/HeaderBits'
import { api } from '../lib/api'
import { formatBytes } from '../lib/upload'
import { colorFor, initials } from '../lib/format'
import { useStore } from '../store'

/** Root console for Parley admins: stats, users, servers, instance settings. */
export default function AdminPage() {
  const item = (active: boolean) => `flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium ${active ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`
  const showContent = useShowContent()
  return (
    <SplitLayout defaultPane="nav" testid={{ 'data-admin': '' }} sidebar={
          <aside className="w-[272px] max-md:flex-1 shrink-0 bg-bg-1 flex flex-col">
            <div className="h-12 px-4 flex items-center gap-2 font-bold text-lg border-b border-line"><ShieldCheck size={20} className="text-success" /> Admin Console</div>
            <nav className="p-2 space-y-0.5">
              <NavLink to="/admin" end onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="overview"><LayoutDashboard size={20} /> Overview</NavLink>
              <NavLink to="/admin/users" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="users"><Users size={20} /> Users</NavLink>
              <NavLink to="/admin/servers" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="servers"><Server size={20} /> Servers</NavLink>
              <NavLink to="/discover/review" onClick={showContent} className={() => item(false)} data-admin-nav="discovery"><Compass size={20} /> Discovery Queue</NavLink>
              <NavLink to="/admin/settings" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="settings"><Megaphone size={20} /> Instance Settings</NavLink>
              <NavLink to="/admin/messages" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="messages"><FileSearch size={20} /> Messages</NavLink>
              <NavLink to="/admin/reports" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="reports"><Flag size={20} /> Reports</NavLink>
              <NavLink to="/admin/audit" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="audit"><ScrollText size={20} /> Audit Log</NavLink>
            </nav>
          </aside>
    }>
      <div className="md:hidden h-12 shrink-0 px-2 flex items-center gap-1 border-b border-line"><MobileBack /><span className="font-bold">Admin Console</span></div>
      <div className="flex-1 min-h-0 overflow-y-auto px-10 py-8 max-md:px-4 max-md:py-5">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="users" element={<UsersPane />} />
          <Route path="servers" element={<ServersPane />} />
          <Route path="settings" element={<SettingsPane />} />
          <Route path="audit" element={<AuditPane />} />
          <Route path="reports" element={<ReportsPane />} />
          <Route path="messages" element={<MessagesPane />} />
          <Route path="users/:id" element={<UserContentPane />} />
        </Routes>
      </div>
    </SplitLayout>
  )
}

interface Stats { users: number; admins: number; suspended: number; online: number; guilds: number; messages: number; discovery_pending: number; discovery_approved: number; upload_bytes: number; reports_open?: number }

function Overview() {
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => { api.get<Stats>('/admin/stats').then(setS).catch(() => {}) }, [])
  const cards = s ? [
    ['Users', s.users.toLocaleString(), `${s.online} online · ${s.admins} admin${s.admins === 1 ? '' : 's'} · ${s.suspended} suspended`],
    ['Servers', s.guilds.toLocaleString(), `${s.discovery_approved} in Discover · ${s.discovery_pending} pending review`],
    ['Messages', s.messages.toLocaleString(), 'across all servers and DMs'],
    ['Uploads', formatBytes(s.upload_bytes), 'attachments, avatars, emoji and stickers'],
    ['Reports', String(s.reports_open ?? 0), 'open reports waiting for review'],
  ] : []
  return (
    <div data-admin-overview>
      <h1 className="text-2xl font-bold">Overview</h1>
      <p className="text-sm text-text-2 mt-1">You are acting as a Parley admin. Changes here apply to everyone on this instance.</p>
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {cards.map(([t, v, sub]) => (
          <div key={t} className="rounded-xl border border-line bg-bg-1 p-4" data-stat={t}>
            <div className="text-xs font-bold uppercase tracking-wider text-text-2">{t}</div>
            <div className="text-3xl font-black mt-1">{v}</div>
            <div className="text-xs text-text-2 mt-1">{sub}</div>
          </div>
        ))}
        {!s && <p className="text-sm text-text-2">Loading…</p>}
      </div>
    </div>
  )
}

interface AdminUser { id: string; username: string; display_name: string; email: string; created_at: string; is_admin: boolean; suspended_at: string | null; email_verified_at?: string | null; mfa_enabled?: boolean; guild_count: number; online: boolean }

function UsersPane() {
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [q, setQ] = useState('')
  const [list, setList] = useState<AdminUser[] | null>(null)
  const load = () => api.get<AdminUser[]>(`/admin/users?q=${encodeURIComponent(q.trim())}`).then(setList).catch((e: Error) => pushToast(e.message, 'error'))
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = useNavigate()
  const logoutAll = async (u: AdminUser) => {
    try { const r = await api.delete<{ revoked: number }>(`/admin/users/${u.id}/sessions`); pushToast(`@${u.username} logged out of ${r.revoked} device${r.revoked === 1 ? '' : 's'}`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const patch = async (u: AdminUser, body: { is_admin?: boolean; suspended?: boolean; mfa?: boolean }, label: string) => {
    try { await api.patch(`/admin/users/${u.id}`, body); pushToast(label); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const del = (u: AdminUser) => openModal({ kind: 'confirm', title: `Delete @${u.username}`, body: `This permanently deletes ${u.display_name}'s account, the servers they own, their messages and uploads. This cannot be undone.`, danger: true, confirmLabel: 'Delete Account',
    action: async () => { try { await api.delete(`/admin/users/${u.id}`); pushToast('Account deleted'); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <div data-admin-users>
      <h1 className="text-2xl font-bold">Users</h1>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username, display name or email" data-admin-user-search className="input mt-4 max-w-md" />
      <div className="mt-4 rounded-xl border border-line overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_90px_110px_200px] gap-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-2 bg-bg-0/40 max-md:hidden"><span>User</span><span>Email</span><span>Servers</span><span>Joined</span><span /></div>
        {list === null && <p className="p-4 text-sm text-text-2">Loading…</p>}
        {list?.length === 0 && <p className="p-4 text-sm text-text-2">No users match.</p>}
        {list?.map((u) => (
          <div key={u.id} className="grid grid-cols-[1fr_1fr_90px_110px_200px] max-md:grid-cols-1 gap-3 items-center px-3 py-2 border-t border-line hover:bg-bg-3/40" data-admin-user={u.username}>
            <div className="min-w-0 flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full shrink-0 ${u.online ? 'bg-success' : 'bg-text-2'}`} />
              <span className="min-w-0"><span className="block truncate font-semibold">{u.display_name}</span><span className="block truncate text-xs text-text-2">@{u.username}</span></span>
              {u.is_admin && <span className="rounded bg-success/20 text-success px-1.5 py-0.5 text-[10px] font-bold" data-badge="admin">ADMIN</span>}
              {u.suspended_at && <span className="rounded bg-danger/20 text-danger px-1.5 py-0.5 text-[10px] font-bold" data-badge="suspended">SUSPENDED</span>}
              {u.mfa_enabled && <span className="rounded bg-sky-500/20 text-sky-300 px-1.5 py-0.5 text-[10px] font-bold" data-badge="mfa">2FA</span>}
              {!u.email_verified_at && <span className="rounded bg-warn/20 text-warn px-1.5 py-0.5 text-[10px] font-bold" data-badge="unverified">UNVERIFIED</span>}
            </div>
            <div className="text-sm text-text-1 truncate"><span className="md:hidden text-text-2">Email: </span>{u.email}</div>
            <div className="text-sm text-text-1"><span className="md:hidden text-text-2">Servers: </span>{u.guild_count}</div>
            <div className="text-xs text-text-2"><span className="md:hidden">Joined: </span>{new Date(u.created_at).toLocaleDateString()}</div>
            <div className="flex items-center justify-end gap-1">
              {u.id !== me?.id && (
                <>
                  <Tool label={u.is_admin ? 'Remove admin' : 'Make admin'} onClick={() => patch(u, { is_admin: !u.is_admin }, u.is_admin ? `@${u.username} is no longer an admin` : `@${u.username} is now an admin`)} testid="toggle-admin">{u.is_admin ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}</Tool>
                  <Tool label={u.suspended_at ? 'Unsuspend' : 'Suspend'} onClick={() => patch(u, { suspended: !u.suspended_at }, u.suspended_at ? `@${u.username} unsuspended` : `@${u.username} suspended`)} testid="toggle-suspend" danger={!u.suspended_at}>{u.suspended_at ? <UserCheck size={16} /> : <UserX size={16} />}</Tool>
                  <Tool label="Messages and uploads" onClick={() => navigate(`/admin/users/${u.id}`)} testid="content"><FolderOpen size={16} /></Tool>
                  <Tool label="Log out of all devices" onClick={() => logoutAll(u)} testid="logout-all"><LogOut size={16} /></Tool>
                  {u.mfa_enabled && <Tool label="Clear two-factor auth" onClick={() => patch(u, { mfa: false }, `Two-factor authentication cleared for @${u.username}`)} testid="clear-mfa" danger><KeyRound size={16} /></Tool>}
                  <Tool label="Delete account" onClick={() => del(u)} testid="delete-user" danger><Trash2 size={16} /></Tool>
                </>
              )}
              {u.id === me?.id && <span className="text-xs text-text-2">you</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface AdminGuild { id: string; name: string; icon_url: string | null; created_at: string; owner_id: string; owner_username: string; member_count: number; message_count: number; discovery_status: string | null }

function ServersPane() {
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [q, setQ] = useState('')
  const [list, setList] = useState<AdminGuild[] | null>(null)
  const load = () => api.get<AdminGuild[]>(`/admin/guilds?q=${encodeURIComponent(q.trim())}`).then(setList).catch((e: Error) => pushToast(e.message, 'error'))
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const del = (g: AdminGuild) => openModal({ kind: 'confirm', title: `Delete '${g.name}'`, body: `This permanently deletes the server, its channels and ${g.message_count.toLocaleString()} messages for all ${g.member_count} members. This cannot be undone.`, danger: true, confirmLabel: 'Delete Server',
    action: async () => { try { await api.delete(`/admin/guilds/${g.id}`); pushToast('Server deleted'); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <div data-admin-servers>
      <h1 className="text-2xl font-bold">Servers</h1>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by server name or owner" data-admin-guild-search className="input mt-4 max-w-md" />
      <div className="mt-4 rounded-xl border border-line overflow-hidden">
        <div className="grid grid-cols-[1fr_160px_100px_110px_120px_60px] gap-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-2 bg-bg-0/40 max-md:hidden"><span>Server</span><span>Owner</span><span>Members</span><span>Messages</span><span>Discover</span><span /></div>
        {list === null && <p className="p-4 text-sm text-text-2">Loading…</p>}
        {list?.length === 0 && <p className="p-4 text-sm text-text-2">No servers match.</p>}
        {list?.map((g) => (
          <div key={g.id} className="grid grid-cols-[1fr_160px_100px_110px_120px_60px] max-md:grid-cols-1 gap-3 items-center px-3 py-2 border-t border-line hover:bg-bg-3/40" data-admin-guild={g.name}>
            <div className="min-w-0 flex items-center gap-2">
              <span className="h-8 w-8 rounded-xl overflow-hidden flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: g.icon_url ? undefined : colorFor(g.id) }}>{g.icon_url ? <img src={g.icon_url} alt="" className="h-full w-full object-cover" /> : initials(g.name)}</span>
              <span className="min-w-0"><span className="block truncate font-semibold">{g.name}</span><span className="block truncate text-xs text-text-2">{new Date(g.created_at).toLocaleDateString()}</span></span>
            </div>
            <div className="text-sm text-text-1 truncate"><span className="md:hidden text-text-2">Owner: </span>@{g.owner_username}</div>
            <div className="text-sm text-text-1"><span className="md:hidden text-text-2">Members: </span>{g.member_count}</div>
            <div className="text-sm text-text-1"><span className="md:hidden text-text-2">Messages: </span>{g.message_count.toLocaleString()}</div>
            <div className="text-xs"><span className="md:hidden text-text-2">Discover: </span>{g.discovery_status ? <span className={`rounded px-1.5 py-0.5 font-bold uppercase ${g.discovery_status === 'approved' ? 'bg-success/20 text-success' : g.discovery_status === 'rejected' ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn'}`}>{g.discovery_status}</span> : <span className="text-text-2">—</span>}</div>
            <div className="flex justify-end"><Tool label="Delete server" onClick={() => del(g)} testid="delete-guild" danger><Gavel size={16} /></Tool></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsPane() {
  const pushToast = useStore((s) => s.pushToast)
  const instance = useStore((s) => s.instance)
  const setInstance = useStore((s) => s.setInstance)
  const [reg, setReg] = useState(instance.registration_enabled)
  const [ann, setAnn] = useState(instance.announcement)
  const [reqVerify, setReqVerify] = useState(!!instance.require_email_verification)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<{ registration_enabled: boolean; announcement: string; require_email_verification?: boolean }>('/admin/settings').then((s) => { setReg(s.registration_enabled); setAnn(s.announcement); setReqVerify(!!s.require_email_verification) }).catch(() => {}) }, [])
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { const s = await api.put<{ registration_enabled: boolean; announcement: string; require_email_verification?: boolean; mail_enabled?: boolean }>('/admin/settings', { registration_enabled: reg, announcement: ann, require_email_verification: reqVerify }); setInstance(s); pushToast('Instance settings saved') } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className="max-w-xl space-y-6" data-admin-settings>
      <div><h1 className="text-2xl font-bold">Instance Settings</h1><p className="text-sm text-text-2 mt-1">Apply to every user of this Parley instance.</p></div>
      <label className="flex items-center justify-between rounded-xl border border-line bg-bg-1 p-4 cursor-pointer">
        <span><span className="block font-semibold">Open registration</span><span className="block text-sm text-text-2">When off, the register page is closed; existing accounts can still log in.</span></span>
        <input type="checkbox" checked={reg} onChange={(e) => setReg(e.target.checked)} className="h-5 w-5 accent-accent" data-admin-registration />
      </label>
      <label className="flex items-center justify-between rounded-xl border border-line bg-bg-1 p-4 cursor-pointer">
        <span><span className="block font-semibold">Require a verified email</span><span className="block text-sm text-text-2">Unverified accounts can chat but cannot create servers or use Discover until they confirm their address.{instance.mail_enabled === false ? ' This server cannot send mail (MAIL_MODE=off), so leave this off.' : ''}</span></span>
        <input type="checkbox" checked={reqVerify} onChange={(e) => setReqVerify(e.target.checked)} className="h-5 w-5 accent-accent" data-admin-require-verify />
      </label>
      <div>
        <label className="label">Announcement banner</label>
        <input className="input" value={ann} onChange={(e) => setAnn(e.target.value)} maxLength={300} placeholder="Shown at the top of the app for everyone; leave blank to hide" data-admin-announcement />
      </div>
      <button className="btn-primary" disabled={busy} data-admin-settings-save>{busy ? 'Saving…' : 'Save Settings'}</button>
    </form>
  )
}

function Tool({ children, label, onClick, danger, testid }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean; testid: string }) {
  return <button type="button" title={label} onClick={onClick} data-admin-action={testid} className={`h-8 w-8 rounded-md flex items-center justify-center hover:bg-bg-3 ${danger ? 'text-text-2 hover:text-danger' : 'text-text-2 hover:text-text-0'}`}>{children}</button>
}

interface AuditRow { id: string; actor_id: string | null; actor_name: string; action: string; target_kind: string; target_id: string | null; target_name: string; details: Record<string, unknown>; created_at: string }

const ACTION_LABELS: Record<string, string> = {
  'user.promote': 'made admin', 'user.demote': 'removed admin from', 'user.suspend': 'suspended', 'user.unsuspend': 'unsuspended',
  'user.delete': 'deleted account', 'user.clear_mfa': 'cleared 2FA for', 'user.logout_all': 'logged out all devices of',
  'guild.delete': 'deleted server', 'settings.update': 'changed instance settings',
  'discovery.approved': 'approved Discover listing', 'discovery.rejected': 'rejected Discover listing', 'discovery.pending': 'reset Discover listing',
}

function AuditPane() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<AuditRow[]>([])
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = async (before?: string) => {
    setBusy(true)
    try {
      const page = await api.get<AuditRow[]>(`/admin/audit?q=${encodeURIComponent(q)}${before ? `&before=${before}` : ''}`)
      setRows((r) => before ? [...r, ...page] : page); setDone(page.length < 100)
    } catch { /* keep what we have */ } finally { setBusy(false) }
  }
  useEffect(() => { const t = setTimeout(() => load(), 200); return () => clearTimeout(t) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const detail = (r: AuditRow) => {
    const d = r.details ?? {}
    if (r.action === 'settings.update') return Object.entries(d).map(([k, v]) => `${k} → ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`).join(', ')
    if (typeof d.note === 'string' && d.note) return `note: ${d.note}`
    if (typeof d.revoked === 'number') return `${d.revoked} session${d.revoked === 1 ? '' : 's'}`
    return ''
  }
  return (
    <div data-admin-audit>
      <h1 className="text-2xl font-bold">Audit Log</h1>
      <p className="text-sm text-text-2 mt-1">Every action taken in this console, newest first. Names are recorded at the time, so entries survive deletions.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by admin, action or target" data-admin-audit-search className="input mt-4 max-w-md" />
      <div className="mt-4 rounded-xl border border-line bg-bg-1 overflow-hidden">
        {rows.length === 0 && <div className="px-3 py-6 text-sm text-text-2 text-center" data-admin-audit-empty>{busy ? 'Loading…' : 'Nothing logged yet.'}</div>}
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[170px_1fr] max-md:grid-cols-1 gap-x-4 gap-y-0.5 px-3 py-2 border-t border-line first:border-t-0 text-sm" data-admin-audit-row data-audit-action={r.action}>
            <div className="text-xs text-text-2 pt-0.5" title={r.created_at}>{new Date(r.created_at).toLocaleString()}</div>
            <div className="min-w-0">
              <span className="font-semibold">@{r.actor_name || 'unknown'}</span> <span className="text-text-1">{ACTION_LABELS[r.action] ?? r.action}</span>
              {r.target_name && <span className="font-semibold"> {r.target_kind === 'user' ? '@' : ''}{r.target_name}</span>}
              {detail(r) && <div className="text-xs text-text-2 truncate" data-audit-detail>{detail(r)}</div>}
            </div>
          </div>
        ))}
      </div>
      {!done && rows.length > 0 && <button type="button" className="btn-ghost mt-3" disabled={busy} onClick={() => load(rows[rows.length - 1].id)} data-admin-audit-more>Load more</button>}
    </div>
  )
}

interface Report { id: string; reporter_id: string | null; reporter_username: string | null; kind: 'message' | 'user'; target_user_id: string | null; target_username: string; message_id: string | null; channel_id: string | null; channel_name: string; guild_id: string | null; guild_name: string; content: string; reason: string; status: 'open' | 'resolved' | 'dismissed'; note: string; created_at: string; resolved_at: string | null; message_exists: boolean; target_suspended: boolean }

function ReportsPane() {
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed' | 'all'>('open')
  const [rows, setRows] = useState<Report[] | null>(null)
  const pushToast = useStore((s) => s.pushToast)
  const load = async () => { try { setRows(await api.get<Report[]>(`/admin/reports?status=${status}`)) } catch (e) { pushToast((e as Error).message, 'error') } }
  useEffect(() => { setRows(null); load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); pushToast(done); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const setState = (r: Report, s: 'resolved' | 'dismissed' | 'open') => act(() => api.patch(`/admin/reports/${r.id}`, { status: s }), s === 'open' ? 'Report reopened' : `Report ${s}`)
  return (
    <div data-admin-reports>
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="text-sm text-text-2 mt-1">Messages and users reported by members. Resolve once handled, dismiss if nothing is wrong.</p>
      <div className="mt-4 flex gap-1.5" data-admin-report-filters>
        {(['open', 'resolved', 'dismissed', 'all'] as const).map((s) => <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${status === s ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-admin-report-filter={s}>{s}</button>)}
      </div>
      <div className="mt-4 space-y-3">
        {rows === null && <p className="text-sm text-text-2">Loading…</p>}
        {rows?.length === 0 && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2" data-admin-reports-empty>No {status === 'all' ? '' : status} reports.</div>}
        {rows?.map((r) => (
          <div key={r.id} className="rounded-xl border border-line bg-bg-1 p-4" data-admin-report={r.id} data-report-status={r.status} data-report-kind={r.kind}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${r.status === 'open' ? 'bg-warn/20 text-warn' : r.status === 'resolved' ? 'bg-success/20 text-success' : 'bg-bg-3 text-text-2'}`}>{r.status}</span>
              <span className="font-semibold">{r.kind === 'message' ? 'Message' : 'User'} report</span>
              <span className="text-text-2">· @{r.reporter_username ?? 'deleted user'} reported <b className="text-text-0">@{r.target_username || 'unknown'}</b>{r.target_suspended && <span className="ml-1 rounded bg-danger/20 text-danger px-1 text-[10px] font-bold">SUSPENDED</span>}</span>
              <span className="ml-auto text-xs text-text-2">{new Date(r.created_at).toLocaleString()}</span>
            </div>
            <div className="mt-2 text-sm"><span className="text-text-2">Reason: </span><span data-report-reason>{r.reason}</span></div>
            {r.kind === 'message' && (
              <div className="mt-2 rounded-lg bg-bg-0/60 border border-line p-3 text-sm" data-report-context>
                <div className="text-xs text-text-2 mb-1">{r.guild_id ? `${r.guild_name} · #${r.channel_name}` : 'Direct message'}{!r.message_exists && <span className="ml-2 rounded bg-bg-3 px-1 text-[10px] font-bold">DELETED</span>}</div>
                <div className="whitespace-pre-wrap break-words">{r.content || <i className="text-text-2">(no text)</i>}</div>
              </div>
            )}
            {r.note && <div className="mt-2 text-xs text-text-2">Note: {r.note}</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {r.kind === 'message' && r.message_exists && <button type="button" className="btn-danger py-1 text-xs" onClick={() => act(() => api.delete(`/admin/messages/${r.message_id}`), 'Message deleted')} data-report-delete-message>Delete message</button>}
              {r.target_user_id && !r.target_suspended && <button type="button" className="btn-danger py-1 text-xs" onClick={() => act(() => api.patch(`/admin/users/${r.target_user_id}`, { suspended: true }), `@${r.target_username} suspended`)} data-report-suspend>Suspend @{r.target_username}</button>}
              {r.guild_id && r.channel_id && <a className="btn-ghost py-1 text-xs" href={`/channels/${r.guild_id}/${r.channel_id}?message=${r.message_id}`} target="_blank" rel="noreferrer">Open channel</a>}
              {r.status === 'open' ? (
                <>
                  <button type="button" className="btn-primary py-1 text-xs" onClick={() => setState(r, 'resolved')} data-report-resolve>Resolve</button>
                  <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setState(r, 'dismissed')} data-report-dismiss>Dismiss</button>
                </>
              ) : <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setState(r, 'open')} data-report-reopen>Reopen</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface AdminHit { id: string; channel_id: string; content: string; created_at: string; author: { id: string; username: string; display_name: string }; attachments: { id: string; filename: string; url: string; size: number }[]; guild_id: string | null; guild_name: string; channel_name: string }

function HitRow({ m, onDeleted }: { m: AdminHit; onDeleted: () => void }) {
  const pushToast = useStore((s) => s.pushToast)
  const del = async () => { try { await api.delete(`/admin/messages/${m.id}`); pushToast('Message deleted'); onDeleted() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="px-3 py-2 border-t border-line first:border-t-0 text-sm" data-admin-msg={m.id}>
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-2">
        <span className="font-semibold text-text-0">@{m.author.username}</span>
        <span>{m.guild_id ? `${m.guild_name} · #${m.channel_name}` : 'Direct message'}</span>
        <span title={m.created_at}>{new Date(m.created_at).toLocaleString()}</span>
        <a className="text-sky-400 hover:underline" href={`/channels/${m.guild_id ?? '@me'}/${m.channel_id}?message=${m.id}`} target="_blank" rel="noreferrer">open</a>
        <button type="button" onClick={del} className="ml-auto text-danger hover:underline" data-admin-msg-delete>Delete</button>
      </div>
      <div className="whitespace-pre-wrap break-words mt-0.5">{m.content || <i className="text-text-2">(no text)</i>}</div>
      {m.attachments?.length > 0 && <div className="text-xs text-text-2 mt-0.5">📎 {m.attachments.map((a) => <a key={a.id} className="hover:underline mr-2" href={a.url} target="_blank" rel="noreferrer">{a.filename}</a>)}</div>}
    </div>
  )
}

function MessagesPane() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<AdminHit[] | null>(null)
  const load = async () => { if (!q.trim()) { setRows(null); return } try { setRows(await api.get<AdminHit[]>(`/admin/messages?q=${encodeURIComponent(q.trim())}`)) } catch { setRows([]) } }
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div data-admin-messages>
      <h1 className="text-2xl font-bold">Messages</h1>
      <p className="text-sm text-text-2 mt-1">Find any message on this instance by its words (prefix match) and delete it. Members of that channel see it disappear.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search message text" data-admin-msg-search className="input mt-4 max-w-md" />
      <div className="mt-4 rounded-xl border border-line bg-bg-1 overflow-hidden">
        {rows === null && <p className="p-4 text-sm text-text-2">Type to search.</p>}
        {rows?.length === 0 && <p className="p-4 text-sm text-text-2" data-admin-msg-empty>No messages match.</p>}
        {rows?.map((m) => <HitRow key={m.id} m={m} onDeleted={load} />)}
      </div>
    </div>
  )
}

interface UserContent { user: { id: string; username: string; display_name: string }; messages: AdminHit[]; uploads: { id: string; filename: string; content_type: string; size: number; url: string; message_id: string | null; created_at: string }[]; images: { id: string; kind: string; size: number; url: string; created_at: string }[]; totals: { messages: number; attachments: number; attachment_bytes: number; images: number; image_bytes: number } }

function UserContentPane() {
  const { id } = useParams()
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const [data, setData] = useState<UserContent | null>(null)
  const [tab, setTab] = useState<'messages' | 'uploads'>('messages')
  const load = async () => { try { setData(await api.get<UserContent>(`/admin/users/${id}/content`)) } catch (e) { pushToast((e as Error).message, 'error') } }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <p className="text-sm text-text-2">Loading…</p>
  const { user, totals } = data
  const purgeMessages = () => openModal({ kind: 'confirm', title: `Delete all messages by @${user.username}`, body: `This deletes all ${totals.messages.toLocaleString()} messages ${user.display_name} has ever sent, everywhere. This cannot be undone.`, danger: true, confirmLabel: 'Delete All Messages',
    action: async () => { try { const r = await api.delete<{ deleted: number }>(`/admin/users/${user.id}/messages`); pushToast(`${r.deleted} messages deleted`); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  const purgeUploads = () => openModal({ kind: 'confirm', title: `Purge uploads by @${user.username}`, body: `Removes all ${totals.attachments} attachments (${formatBytes(totals.attachment_bytes)}) and their profile images. Their messages stay, without the files. This cannot be undone.`, danger: true, confirmLabel: 'Purge Uploads',
    action: async () => { try { const r = await api.delete<{ attachments: number; images: number }>(`/admin/users/${user.id}/uploads`); pushToast(`${r.attachments} attachments and ${r.images} images removed`); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <div data-admin-user-content={user.id}>
      <NavLink to="/admin/users" className="text-xs text-sky-400 hover:underline">← Users</NavLink>
      <h1 className="text-2xl font-bold mt-1">{user.display_name} <span className="text-base font-normal text-text-2">@{user.username}</span></h1>
      <p className="text-sm text-text-2 mt-1" data-admin-content-totals>{totals.messages.toLocaleString()} messages · {totals.attachments} attachments ({formatBytes(totals.attachment_bytes)}) · {totals.images} profile/expression images ({formatBytes(totals.image_bytes)})</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-danger py-1 text-xs" onClick={purgeMessages} disabled={totals.messages === 0} data-admin-purge-messages>Delete all messages</button>
        <button type="button" className="btn-danger py-1 text-xs" onClick={purgeUploads} disabled={totals.attachments === 0 && totals.images === 0} data-admin-purge-uploads>Purge uploads</button>
      </div>
      <div className="mt-5 flex gap-1.5">
        {(['messages', 'uploads'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${tab === t ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-admin-content-tab={t}>{t}</button>)}
      </div>
      {tab === 'messages' ? (
        <div className="mt-3 rounded-xl border border-line bg-bg-1 overflow-hidden" data-admin-content-messages>
          {data.messages.length === 0 && <p className="p-4 text-sm text-text-2">No messages.</p>}
          {data.messages.map((m) => <HitRow key={m.id} m={m} onDeleted={load} />)}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-line bg-bg-1 overflow-hidden" data-admin-content-uploads>
          {data.uploads.length === 0 && data.images.length === 0 && <p className="p-4 text-sm text-text-2">No uploads.</p>}
          {data.uploads.map((u) => (
            <div key={u.id} className="px-3 py-2 border-t border-line first:border-t-0 text-sm flex items-center gap-3" data-admin-upload={u.id}>
              <a className="text-sky-400 hover:underline truncate" href={u.url} target="_blank" rel="noreferrer">{u.filename}</a>
              <span className="text-xs text-text-2">{u.content_type} · {formatBytes(u.size)} · {new Date(u.created_at).toLocaleString()}</span>
            </div>
          ))}
          {data.images.map((i) => (
            <div key={i.id} className="px-3 py-2 border-t border-line text-sm flex items-center gap-3" data-admin-image={i.id}>
              <img src={i.url} alt="" className="h-8 w-8 rounded object-cover bg-bg-0" />
              <span className="capitalize">{i.kind}</span>
              <span className="text-xs text-text-2">{formatBytes(i.size)} · {new Date(i.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

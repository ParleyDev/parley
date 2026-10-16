import { Compass, Gavel, LayoutDashboard, Megaphone, Server, ShieldCheck, ShieldOff, Trash2, UserCheck, Users, UserX } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
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
        </Routes>
      </div>
    </SplitLayout>
  )
}

interface Stats { users: number; admins: number; suspended: number; online: number; guilds: number; messages: number; discovery_pending: number; discovery_approved: number; upload_bytes: number }

function Overview() {
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => { api.get<Stats>('/admin/stats').then(setS).catch(() => {}) }, [])
  const cards = s ? [
    ['Users', s.users.toLocaleString(), `${s.online} online · ${s.admins} admin${s.admins === 1 ? '' : 's'} · ${s.suspended} suspended`],
    ['Servers', s.guilds.toLocaleString(), `${s.discovery_approved} in Discover · ${s.discovery_pending} pending review`],
    ['Messages', s.messages.toLocaleString(), 'across all servers and DMs'],
    ['Uploads', formatBytes(s.upload_bytes), 'attachments, avatars, emoji and stickers'],
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

interface AdminUser { id: string; username: string; display_name: string; email: string; created_at: string; is_admin: boolean; suspended_at: string | null; email_verified_at?: string | null; guild_count: number; online: boolean }

function UsersPane() {
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [q, setQ] = useState('')
  const [list, setList] = useState<AdminUser[] | null>(null)
  const load = () => api.get<AdminUser[]>(`/admin/users?q=${encodeURIComponent(q.trim())}`).then(setList).catch((e: Error) => pushToast(e.message, 'error'))
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const patch = async (u: AdminUser, body: { is_admin?: boolean; suspended?: boolean }, label: string) => {
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

import { Compass, FileSearch, Flag, FolderOpen, Gavel, KeyRound, LayoutDashboard, LogOut, Mail, RefreshCw, ScrollText, Megaphone, Server, ShieldCheck, ShieldOff, Trash2, UserCheck, Users, UserX, HardDrive, Upload } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
          <aside className="w-[var(--sidebar-w)] tab:w-[224px] max-md:flex-1 shrink-0 bg-bg-1 flex flex-col">
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
              <NavLink to="/admin/mail" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="mail"><Mail size={20} /> Mail</NavLink>
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
          <Route path="mail" element={<MailPane />} />
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

interface AdminUser { id: string; username: string; display_name: string; email: string; created_at: string; is_admin: boolean; suspended_at: string | null; email_verified_at?: string | null; mfa_enabled?: boolean; upload_quota_bytes?: number | null; max_upload_bytes?: number | null; last_seen_at?: string | null; guild_count: number; online: boolean }
type Tri = '' | 'true' | 'false'
interface UserFilters { admin: Tri; suspended: Tri; verified: Tri; mfa: Tri; online: Tri; joined_before: string; joined_after: string; inactive_days: string; ip: string }
const EMPTY_FILTERS: UserFilters = { admin: '', suspended: '', verified: '', mfa: '', online: '', joined_before: '', joined_after: '', inactive_days: '', ip: '' }
const PAGE = 100

function UsersPane() {
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [q, setQ] = useState('')
  const [params] = useSearchParams()
  const [filters, setFilters] = useState<UserFilters>({ ...EMPTY_FILTERS, ip: params.get('ip') ?? '' })
  const [list, setList] = useState<AdminUser[] | null>(null)
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const query = (offset: number) => {
    const p = new URLSearchParams({ q: q.trim(), offset: String(offset), limit: String(PAGE) })
    for (const [k, v] of Object.entries(filters)) if (v !== '') p.set(k, v)
    return `/admin/users?${p.toString()}`
  }
  const load = async (append = false) => {
    try {
      const { data, headers } = await api.getWithHeaders<AdminUser[]>(query(append ? (list?.length ?? 0) : 0))
      setTotal(Number(headers.get('x-total-count') ?? data.length))
      setList((cur) => (append && cur ? [...cur, ...data] : data))
      if (!append) setSelected(new Set())
    } catch (e) { pushToast((e as Error).message, 'error') }
  }
  useEffect(() => { const t = setTimeout(() => load(), 250); return () => clearTimeout(t) }, [q, filters]) // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = useNavigate()
  const logoutAll = async (u: AdminUser) => {
    try { const r = await api.delete<{ revoked: number }>(`/admin/users/${u.id}/sessions`); pushToast(`@${u.username} logged out of ${r.revoked} device${r.revoked === 1 ? '' : 's'}`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const patch = async (u: AdminUser, body: { is_admin?: boolean; suspended?: boolean; mfa?: boolean }, label: string) => {
    try { await api.patch(`/admin/users/${u.id}`, body); pushToast(label); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const [limitFor, setLimitFor] = useState<AdminUser | null>(null)
  const [limitMb, setLimitMb] = useState('')
  const saveLimit = async (mode: 'set' | 'default') => {
    if (!limitFor) return
    const body = mode === 'default' ? null : Math.round(Number(limitMb) * 1024 * 1024)
    if (mode === 'set' && (!Number.isFinite(body as number) || (body as number) <= 0)) { pushToast('Enter a size in MB', 'error'); return }
    try { await api.patch(`/admin/users/${limitFor.id}`, { max_upload_bytes: body }); pushToast(mode === 'default' ? `@${limitFor.username} uses the instance upload limit` : `@${limitFor.username} may upload files up to ${limitMb} MB`); setLimitFor(null); await load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const [quotaFor, setQuotaFor] = useState<AdminUser | null>(null)
  const [quotaMb, setQuotaMb] = useState('')
  const saveQuota = async (mode: 'set' | 'unlimited' | 'default') => {
    if (!quotaFor) return
    const body = mode === 'default' ? null : mode === 'unlimited' ? 0 : Math.round(Number(quotaMb) * 1024 * 1024)
    if (mode === 'set' && (!Number.isFinite(body as number) || (body as number) <= 0)) { pushToast('Enter a size in MB', 'error'); return }
    try { await api.patch(`/admin/users/${quotaFor.id}`, { upload_quota_bytes: body }); pushToast(mode === 'default' ? `@${quotaFor.username} uses the instance default quota` : mode === 'unlimited' ? `@${quotaFor.username} has unlimited storage` : `@${quotaFor.username} may store ${quotaMb} MB`); setQuotaFor(null); setQuotaMb('') } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const del = (u: AdminUser) => openModal({ kind: 'confirm', title: `Delete @${u.username}`, body: `This permanently deletes ${u.display_name}'s account, the servers they own, their messages and uploads. This cannot be undone.`, danger: true, confirmLabel: 'Delete Account',
    action: async () => { try { await api.delete(`/admin/users/${u.id}`); pushToast('Account deleted'); load() } catch (e) { pushToast((e as Error).message, 'error') } } })

  // ---- bulk mode ----
  const selectable = (list ?? []).filter((u) => u.id !== me?.id)
  const allSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((u) => u.id)))
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const runBulk = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      const r = await api.post<{ done: number; failed: { id: string; error: string }[] }>('/admin/users/bulk', { ids: [...selected], action, ...extra })
      pushToast(`${r.done} account${r.done === 1 ? '' : 's'} updated${r.failed.length ? `, ${r.failed.length} skipped (${r.failed[0].error})` : ''}`, r.failed.length ? 'error' : 'info')
      await load()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const bulk = (action: string, label: string, body: string, danger = false, extra: Record<string, unknown> = {}) =>
    openModal({ kind: 'confirm', title: `${label} ${selected.size} account${selected.size === 1 ? '' : 's'}`, body, danger, confirmLabel: label, action: () => runBulk(action, extra) })
  const bulkQuota = () => { const mb = window.prompt('Storage quota in MB for the selected accounts (0 = unlimited, empty = instance default)', ''); if (mb === null) return; const v = mb.trim() === '' ? null : Math.round(Number(mb) * 1024 * 1024); if (v !== null && !Number.isFinite(v)) { pushToast('Enter a number of MB', 'error'); return } runBulk('quota', { upload_quota_bytes: v }) }
  const tri = (k: keyof UserFilters, label: string, yes: string, no: string) => (
    <select className="input w-auto py-1 text-xs" value={filters[k]} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })} data-admin-filter={k} aria-label={label}>
      <option value="">{label}: any</option><option value="true">{yes}</option><option value="false">{no}</option>
    </select>
  )
  const activeFilters = Object.values(filters).filter((v) => v !== '').length
  return (
    <div data-admin-users>
      <h1 className="text-2xl font-bold">Users</h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username, display name or email" data-admin-user-search className="input max-w-md" />
        {tri('admin', 'Role', 'Admins', 'Not admins')}
        {tri('suspended', 'Status', 'Suspended', 'Active')}
        {tri('verified', 'Email', 'Verified', 'Unverified')}
        {tri('mfa', '2FA', 'Enabled', 'Not enabled')}
        {tri('online', 'Presence', 'Online now', 'Offline')}
        <label className="flex items-center gap-1 text-xs text-text-2">Joined after <input type="date" className="input w-auto py-1 text-xs" value={filters.joined_after} onChange={(e) => setFilters({ ...filters, joined_after: e.target.value })} data-admin-filter="joined_after" /></label>
        <label className="flex items-center gap-1 text-xs text-text-2">before <input type="date" className="input w-auto py-1 text-xs" value={filters.joined_before} onChange={(e) => setFilters({ ...filters, joined_before: e.target.value })} data-admin-filter="joined_before" /></label>
        <label className="flex items-center gap-1 text-xs text-text-2">Inactive for <input type="number" min={1} className="input w-20 py-1 text-xs" value={filters.inactive_days} onChange={(e) => setFilters({ ...filters, inactive_days: e.target.value })} placeholder="days" data-admin-filter="inactive_days" /> days</label>
        <label className="flex items-center gap-1 text-xs text-text-2">IP <input className="input w-36 py-1 text-xs" value={filters.ip} onChange={(e) => setFilters({ ...filters, ip: e.target.value })} placeholder="203.0.113.7" data-admin-filter-ip /></label>
        {activeFilters > 0 && <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setFilters(EMPTY_FILTERS)} data-admin-filter-clear>Clear filters</button>}
        <span className="ml-auto text-xs text-text-2" data-admin-user-total>{list ? `${list.length} of ${total}` : '…'}</span>
      </div>
      {limitFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setLimitFor(null)} data-admin-limit-dialog>
          <div className="pop w-full max-w-md rounded-xl bg-bg-1 border border-line p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Upload size limit for @{limitFor.username}</h3>
            <p className="text-sm text-text-2">The largest single file they can attach. The instance limit applies unless you set one here.</p>
            <div className="flex items-center gap-2"><input type="number" min={1} className="input w-32" placeholder="MB" value={limitMb} onChange={(e) => setLimitMb(e.target.value)} data-admin-limit-mb /><span className="text-sm text-text-2">MB</span><button type="button" className="btn-primary py-1.5" onClick={() => saveLimit('set')} data-admin-limit-set>Set</button></div>
            <div className="flex gap-2"><button type="button" className="btn-ghost py-1.5" onClick={() => saveLimit('default')} data-admin-limit-default>Use instance limit</button><button type="button" className="btn-ghost py-1.5 ml-auto" onClick={() => setLimitFor(null)}>Cancel</button></div>
          </div>
        </div>
      )}
      {quotaFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setQuotaFor(null)} data-admin-quota-dialog>
          <div className="pop w-full max-w-md rounded-xl bg-bg-1 border border-line p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Storage quota for @{quotaFor.username}</h3>
            <p className="text-sm text-text-2">Attachments and profile images together. The instance default applies unless you set one here.</p>
            <div className="flex items-center gap-2"><input type="number" min={1} className="input w-32" placeholder="MB" value={quotaMb} onChange={(e) => setQuotaMb(e.target.value)} data-admin-quota-mb /><span className="text-sm text-text-2">MB</span><button type="button" className="btn-primary py-1.5" onClick={() => saveQuota('set')} data-admin-quota-set>Set</button></div>
            <div className="flex gap-2"><button type="button" className="btn-ghost py-1.5" onClick={() => saveQuota('unlimited')} data-admin-quota-unlimited>Unlimited</button><button type="button" className="btn-ghost py-1.5" onClick={() => saveQuota('default')} data-admin-quota-default>Use instance default</button><button type="button" className="btn-ghost py-1.5 ml-auto" onClick={() => setQuotaFor(null)}>Cancel</button></div>
          </div>
        </div>
      )}
      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm" data-admin-bulk-bar>
          <span className="font-semibold" data-admin-bulk-count>{selected.size} selected</span>
          <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => bulk('suspend', 'Suspend', 'Suspended accounts are logged out everywhere and cannot log in until unsuspended.', true)} data-admin-bulk="suspend">Suspend</button>
          <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => bulk('unsuspend', 'Unsuspend', 'They will be able to log in again.')} data-admin-bulk="unsuspend">Unsuspend</button>
          <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => bulk('logout', 'Log out', 'Every session of the selected accounts is revoked.')} data-admin-bulk="logout">Log out everywhere</button>
          <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => bulk('clear_mfa', 'Clear 2FA', 'Two-factor authentication is removed from the selected accounts; they log in with just their password.', true)} data-admin-bulk="clear_mfa">Clear 2FA</button>
          <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={bulkQuota} data-admin-bulk="quota">Set quota</button>
          <button type="button" className="btn-danger py-1 text-xs" disabled={busy} onClick={() => bulk('delete', 'Delete', 'This permanently deletes the selected accounts, the servers they own, their messages and uploads. This cannot be undone.', true)} data-admin-bulk="delete">Delete</button>
          <button type="button" className="ml-auto text-xs text-text-2 hover:text-text-0" onClick={() => setSelected(new Set())} data-admin-bulk-clear>Clear selection</button>
        </div>
      )}
      <div className="mt-4 rounded-xl border border-line overflow-hidden">
        <div className="grid grid-cols-[28px_1fr_1fr_90px_110px_200px] gap-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-2 bg-bg-0/40 max-md:hidden items-center">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={allSelected} onChange={toggleAll} aria-label="Select all" data-admin-select-all />
          <span>User</span><span>Email</span><span>Servers</span><span>Joined</span><span />
        </div>
        {list === null && <p className="p-4 text-sm text-text-2">Loading…</p>}
        {list?.length === 0 && <p className="p-4 text-sm text-text-2">No users match.</p>}
        {list?.map((u) => (
          <div key={u.id} className={`grid grid-cols-[28px_1fr_1fr_90px_110px_200px] max-md:grid-cols-1 gap-3 items-center px-3 py-2 border-t border-line hover:bg-bg-3/40 ${selected.has(u.id) ? 'bg-accent/5' : ''}`} data-admin-user={u.username} data-selected={selected.has(u.id) ? '1' : '0'}>
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={selected.has(u.id)} disabled={u.id === me?.id} onChange={() => toggle(u.id)} aria-label={`Select @${u.username}`} data-admin-select />
            <div className="min-w-0 flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full shrink-0 ${u.online ? 'bg-success' : 'bg-text-2'}`} />
              <span className="min-w-0"><span className="block truncate font-semibold">{u.display_name}</span><span className="block truncate text-xs text-text-2">@{u.username}{u.last_seen_at ? ` · seen ${new Date(u.last_seen_at).toLocaleDateString()}` : ''}</span></span>
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
                  <Tool label="Storage quota" onClick={() => setQuotaFor(u)} testid="quota"><HardDrive size={16} /></Tool>
                  <Tool label="Upload size limit" onClick={() => { setLimitFor(u); setLimitMb(u.max_upload_bytes ? String(Math.round(u.max_upload_bytes / 1048576)) : '') }} testid="upload-limit"><Upload size={16} /></Tool>
                  {u.mfa_enabled && <Tool label="Clear two-factor auth" onClick={() => patch(u, { mfa: false }, `Two-factor authentication cleared for @${u.username}`)} testid="clear-mfa" danger><KeyRound size={16} /></Tool>}
                  <Tool label="Delete account" onClick={() => del(u)} testid="delete-user" danger><Trash2 size={16} /></Tool>
                </>
              )}
              {u.id === me?.id && <span className="text-xs text-text-2">you</span>}
            </div>
          </div>
        ))}
        {list && list.length < total && <button type="button" className="w-full py-2 text-sm text-sky-400 hover:bg-bg-3 border-t border-line" onClick={() => load(true)} data-admin-user-more>Load more ({total - list.length} remaining)</button>}
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
  const [lkUrl, setLkUrl] = useState('')
  const [lkKey, setLkKey] = useState('')
  const [lkSecret, setLkSecret] = useState('')
  const [sttUrl, setSttUrl] = useState('')
  const [sttKey, setSttKey] = useState('')
  const [sttModel, setSttModel] = useState('')
  const [fcm, setFcm] = useState('')
  const [fcmEndpoint, setFcmEndpoint] = useState('')
  const [oauth, setOauth] = useState<Record<string, { client_id: string; client_secret: string }>>({})
  const [oauthOverride, setOauthOverride] = useState('')
  const [maxUploadMb, setMaxUploadMb] = useState('')
  const [avAddr, setAvAddr] = useState('')
  const [avClosed, setAvClosed] = useState(false)
  const [rl, setRl] = useState<Record<string, string>>({})
  const [rlDefaults, setRlDefaults] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<{ registration_enabled: boolean; announcement: string; require_email_verification?: boolean; livekit_url?: string; livekit_api_key?: string; livekit_api_secret?: string; stt_url?: string; stt_api_key?: string; stt_model?: string; rate_limits?: Record<string, string>; rate_limit_defaults?: Record<string, string>; av_addr?: string; av_fail_closed?: boolean; fcm_service_account?: string; fcm_endpoint?: string; push?: boolean; oauth_providers?: Record<string, { client_id: string; client_secret: string }>; oauth_endpoint_override?: string; max_upload_bytes?: number }>('/admin/settings').then((s) => { setMaxUploadMb(s.max_upload_bytes ? String(Math.round(s.max_upload_bytes / 1048576)) : ''); setOauth(s.oauth_providers && typeof s.oauth_providers === 'object' ? s.oauth_providers : {}); setOauthOverride(s.oauth_endpoint_override ?? ''); setAvAddr(s.av_addr ?? ''); setAvClosed(!!s.av_fail_closed); setFcm(s.fcm_service_account ?? ''); setFcmEndpoint(s.fcm_endpoint ?? ''); setReg(s.registration_enabled); setAnn(s.announcement); setReqVerify(!!s.require_email_verification); setLkUrl(s.livekit_url ?? ''); setLkKey(s.livekit_api_key ?? ''); setLkSecret(s.livekit_api_secret ?? ''); setSttUrl(s.stt_url ?? ''); setSttKey(s.stt_api_key ?? ''); setSttModel(s.stt_model ?? ''); setRl(s.rate_limits ?? {}); setRlDefaults(s.rate_limit_defaults ?? {}) }).catch(() => {}) }, [])
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { const s = await api.put<{ registration_enabled: boolean; announcement: string; require_email_verification?: boolean; mail_enabled?: boolean; voice_mode?: 'mesh' | 'sfu'; livekit_url?: string; transcription?: boolean }>('/admin/settings', { registration_enabled: reg, announcement: ann, require_email_verification: reqVerify, livekit_url: lkUrl, livekit_api_key: lkKey, livekit_api_secret: lkSecret, stt_url: sttUrl, stt_api_key: sttKey, stt_model: sttModel, rate_limits: rl, av_addr: avAddr, av_fail_closed: avClosed, fcm_service_account: fcm, fcm_endpoint: fcmEndpoint, oauth_providers: oauth, oauth_endpoint_override: oauthOverride, max_upload_bytes: maxUploadMb ? Math.round(Number(maxUploadMb) * 1048576) : 0 }); setInstance({ ...s, livekit_url: s.livekit_url }); pushToast('Instance settings saved') } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
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
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-voice>
        <div><span className="block font-semibold">Voice: LiveKit SFU</span><span className="block text-sm text-text-2">Leave empty for peer-to-peer calls (fine up to about six people). Enter a LiveKit server to route all voice, video and screen share through it; the server mints join tokens from the channel permissions.</span></div>
        <div><label className="label">LiveKit URL (what browsers connect to)</label><input className="input" value={lkUrl} onChange={(e) => setLkUrl(e.target.value)} placeholder="wss://livekit.example.com or ws://localhost:7880" data-admin-livekit-url /></div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div><label className="label">API key</label><input className="input" value={lkKey} onChange={(e) => setLkKey(e.target.value)} placeholder="devkey" autoComplete="off" data-admin-livekit-key /></div>
          <div><label className="label">API secret</label><input className="input" type="password" value={lkSecret} onChange={(e) => setLkSecret(e.target.value)} placeholder="secret" autoComplete="new-password" data-admin-livekit-secret /></div>
        </div>
        <div className="text-xs text-text-2">Current mode: <b data-admin-voice-mode>{instance.voice_mode === 'sfu' ? 'SFU' : 'peer-to-peer mesh'}</b></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-stt>
        <div><span className="block font-semibold">Voice message transcription</span><span className="block text-sm text-text-2">Any OpenAI-compatible speech-to-text server (<code>POST /v1/audio/transcriptions</code>): the bundled Whisper container (<code>docker compose --profile stt up -d</code>, URL <code>http://stt:8000</code>), or a hosted API with a key. Leave the URL empty to turn it off.</span></div>
        <div><label className="label">Transcription server URL</label><input className="input" value={sttUrl} onChange={(e) => setSttUrl(e.target.value)} placeholder="http://stt:8000 or https://api.openai.com" data-admin-stt-url /></div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div><label className="label">API key (optional)</label><input className="input" type="password" value={sttKey} onChange={(e) => setSttKey(e.target.value)} autoComplete="new-password" data-admin-stt-key /></div>
          <div><label className="label">Model</label><input className="input" value={sttModel} onChange={(e) => setSttModel(e.target.value)} placeholder="Systran/faster-whisper-base.en or whisper-1" data-admin-stt-model /></div>
        </div>
        <div className="text-xs text-text-2">Transcription: <b data-admin-stt-state>{instance.transcription ? 'on' : 'off'}</b></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-push>
        <div><span className="block font-semibold">Push notifications (iOS / Android apps)</span><span className="block text-sm text-text-2">Paste the Firebase <b>service account</b> JSON (Project settings → Service accounts → Generate new private key). DMs and mentions are pushed to members who have no app or browser open. Leave empty to turn push off.</span></div>
        <textarea className="input resize-y font-mono text-xs" rows={4} value={fcm} onChange={(e) => setFcm(e.target.value)} placeholder='{"type":"service_account","project_id":"…","client_email":"…","private_key":"-----BEGIN PRIVATE KEY-----…"}' autoComplete="off" data-admin-fcm />
        <div><label className="label">FCM endpoint override (tests only)</label><input className="input" value={fcmEndpoint} onChange={(e) => setFcmEndpoint(e.target.value)} placeholder="leave empty for Google" data-admin-fcm-endpoint /></div>
        <div className="text-xs text-text-2">Push: <b data-admin-push-state>{fcm.trim() ? 'on' : 'off'}</b></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-oauth>
        <div><span className="block font-semibold">Linked accounts (OAuth)</span><span className="block text-sm text-text-2">Let members connect GitHub and Twitch from Settings → Connections. Register an OAuth app at each provider with the callback URL <code>{instance.app_url ?? ''}/api/connections/&lt;provider&gt;/callback</code> and paste its keys.</span></div>
        {(['github', 'twitch'] as const).map((p) => (
          <div key={p} className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <div><label className="label capitalize">{p} client ID</label><input className="input" value={oauth[p]?.client_id ?? ''} onChange={(e) => setOauth({ ...oauth, [p]: { client_id: e.target.value, client_secret: oauth[p]?.client_secret ?? '' } })} autoComplete="off" data-admin-oauth-id={p} /></div>
            <div><label className="label capitalize">{p} client secret</label><input className="input" type="password" value={oauth[p]?.client_secret ?? ''} onChange={(e) => setOauth({ ...oauth, [p]: { client_id: oauth[p]?.client_id ?? '', client_secret: e.target.value } })} autoComplete="off" data-admin-oauth-secret={p} /></div>
          </div>
        ))}
        <div><label className="label">Provider endpoint override (tests only)</label><input className="input" value={oauthOverride} onChange={(e) => setOauthOverride(e.target.value)} placeholder="leave empty for the real providers" data-admin-oauth-override /></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-uploads>
        <div><span className="block font-semibold">Uploads</span><span className="block text-sm text-text-2">The largest single file anyone may attach. Leave empty for 25 MB. Individual users can be given their own limit from the users table.</span></div>
        <div className="flex items-center gap-2"><input type="number" min={1} className="input w-32" placeholder="25" value={maxUploadMb} onChange={(e) => setMaxUploadMb(e.target.value)} data-admin-max-upload /><span className="text-sm text-text-2">MB per file</span></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-av>
        <div><span className="block font-semibold">Antivirus (ClamAV)</span><span className="block text-sm text-text-2">Every upload (attachments, voice messages, profile images, emoji) is scanned by a ClamAV daemon before it is stored. <code>docker compose --profile av up -d</code> runs one; enter <code>clamav:3310</code>. Leave empty to skip scanning.</span></div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div><label className="label">clamd address (host:port)</label><input className="input" value={avAddr} onChange={(e) => setAvAddr(e.target.value)} placeholder="clamav:3310" data-admin-av-addr /></div>
          <label className="flex items-center justify-between rounded-xl border border-line bg-bg-0/40 p-3 cursor-pointer"><span><span className="block text-sm font-semibold">Fail closed</span><span className="block text-xs text-text-2">Refuse uploads while the scanner is unreachable (otherwise they pass with an error logged).</span></span><input type="checkbox" checked={avClosed} onChange={(e) => setAvClosed(e.target.checked)} className="h-5 w-5 accent-accent" data-admin-av-closed /></label>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-rate-limits>
        <div><span className="block font-semibold">Rate limits</span><span className="block text-sm text-text-2">Requests allowed per window as <code>count/seconds</code>, e.g. <code>10/5</code>. Blank uses the server's RL_* environment value (shown as the placeholder). Applies immediately on this instance; other instances pick it up on restart.</span></div>
        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          {([['register', 'Registrations (per IP)'], ['login', 'Logins (per IP)'], ['login_fail', 'Failed logins (per IP)'], ['messages', 'Messages (per user)'], ['uploads', 'Uploads (per user)'], ['gifs', 'GIF searches (per user)'], ['mail', 'Emails sent (per user)']] as const).map(([k, label]) => (
            <div key={k}><label className="label">{label}</label><input className="input" value={rl[k] ?? ''} onChange={(e) => setRl({ ...rl, [k]: e.target.value })} placeholder={rlDefaults[k] ?? ''} data-admin-rl={k} /></div>
          ))}
        </div>
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

interface SentMail { id: string; to: string; subject: string; body: string; sent_at: string; status?: 'sent' | 'failed' | 'logged' | 'off'; error?: string | null }
const KEEP_OPTIONS: [number, string][] = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year'], [0, 'Until deleted']]
const MAIL_STATUS: Record<string, { label: string; cls: string; hint: string }> = {
  sent: { label: 'Sent', cls: 'bg-success/15 text-success', hint: 'The mail server accepted it. Delivery to the inbox is tracked by your mail provider.' },
  failed: { label: 'Failed', cls: 'bg-danger/15 text-danger', hint: 'The mail server refused it or the mail settings are wrong.' },
  logged: { label: 'Logged', cls: 'bg-bg-4 text-text-1', hint: 'MAIL_MODE=log: written to the backend log instead of being sent.' },
  off: { label: 'Not sent', cls: 'bg-bg-4 text-text-2', hint: 'MAIL_MODE=off: email is switched off.' },
}

/** Every email the server tried to send, newest first, with what happened to each; kept for the chosen period. */
function MailPane() {
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<SentMail[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [keep, setKeep] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const pushToast = useStore((s) => s.pushToast)
  const filter = to.trim() ? `to=${encodeURIComponent(to.trim())}` : ''
  const load = async () => {
    setBusy(true)
    try { setRows(await api.get<SentMail[]>(`/admin/mail?limit=500${filter ? `&${filter}` : ''}`)); setOpen(null) } catch { setRows((r) => r ?? []) } finally { setBusy(false) }
  }
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get<{ retention_days: number }>('/admin/mail/settings').then((r) => setKeep(r.retention_days)).catch(() => {}) }, [])
  const saveKeep = async (days: number) => {
    try { await api.put('/admin/mail/settings', { retention_days: days }); setKeep(days); pushToast(days ? `Emails are now kept for ${KEEP_OPTIONS.find(([d]) => d === days)?.[1] ?? `${days} days`}` : 'Emails are now kept until deleted'); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const remove = async (id: string) => {
    try { await api.delete(`/admin/mail/${id}`); setRows((r) => r?.filter((m) => m.id !== id) ?? r); setOpen(null) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const clearAll = async () => {
    try { const r = await api.delete<{ removed: number }>(`/admin/mail${filter ? `?${filter}` : ''}`); setConfirmClear(false); pushToast(`Deleted ${r.removed} email${r.removed === 1 ? '' : 's'}`); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const failed = rows?.filter((m) => m.status === 'failed').length ?? 0
  return (
    <div data-admin-mail>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Mail</h1>
        <button type="button" onClick={load} disabled={busy} className="btn-ghost ml-auto py-1.5" data-admin-mail-refresh><RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Refresh</button>
      </div>
      <p className="text-sm text-text-2 mt-1 max-w-2xl">Every email this server tried to send, newest first, kept through restarts until it expires or you delete it. Whether a sent email reached the inbox is tracked by your mail provider (for SendGrid, its Activity Feed).</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Filter by recipient email" type="email" className="input max-w-md" data-admin-mail-search />
        <label className="flex items-center gap-2 text-sm text-text-1">Keep emails for
          <select className="input w-auto py-1.5" value={keep ?? ''} disabled={keep === null} onChange={(e) => saveKeep(Number(e.target.value))} data-admin-mail-keep>
            {keep !== null && !KEEP_OPTIONS.some(([d]) => d === keep) && <option value={keep}>{keep} days</option>}
            {KEEP_OPTIONS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
          </select>
        </label>
        {(rows?.length ?? 0) > 0 && (confirmClear ? (
          <span className="flex items-center gap-2 text-sm" data-admin-mail-clear-confirm>{filter ? `Delete every email to ${to.trim()}?` : 'Delete every logged email?'}
            <button type="button" className="btn-primary bg-danger hover:bg-danger/80 py-1" onClick={clearAll}>Delete</button><button type="button" className="btn-ghost py-1" onClick={() => setConfirmClear(false)}>Cancel</button></span>
        ) : (
          <button type="button" className="btn-ghost py-1.5 text-danger" onClick={() => setConfirmClear(true)} data-admin-mail-clear>{filter ? 'Delete these' : 'Delete all'}</button>
        ))}
      </div>
      {failed > 0 && <p className="mt-3 text-sm text-danger" data-admin-mail-failed>{failed} of these failed. Open one to see the error, and check SMTP_URL and MAIL_FROM.</p>}
      <div className="mt-4 rounded-xl border border-line bg-bg-1 overflow-hidden">
        {(rows?.length ?? 0) === 0 && <div className="px-3 py-6 text-sm text-text-2 text-center" data-admin-mail-empty>{rows === null || busy ? 'Loading…' : to.trim() ? 'No emails to that address yet.' : 'No emails logged.'}</div>}
        {rows?.map((m, i) => {
          const st = MAIL_STATUS[m.status ?? 'logged'] ?? MAIL_STATUS.logged
          return (
            <div key={m.id} className="border-t border-line first:border-t-0" data-admin-mail-row data-mail-status={m.status ?? 'logged'}>
              <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full grid grid-cols-[76px_170px_minmax(0,1fr)] max-md:grid-cols-[76px_minmax(0,1fr)] gap-x-4 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-bg-3">
                <span className={`self-start justify-self-start rounded px-1.5 py-0.5 text-[11px] font-bold ${st.cls}`} title={st.hint}>{st.label}</span>
                <span className="text-xs text-text-2 pt-0.5 max-md:hidden" title={m.sent_at}>{new Date(m.sent_at).toLocaleString()}</span>
                <span className="min-w-0"><span className="block truncate font-semibold">{m.subject}</span><span className="block truncate text-xs text-text-2">to {m.to}<span className="md:hidden"> · {new Date(m.sent_at).toLocaleString()}</span></span></span>
              </button>
              {open === i && (
                <div className="px-3 pb-3 text-sm" data-admin-mail-detail>
                  {m.error && <p className="mb-2 rounded-md bg-danger/10 px-3 py-2 text-danger break-words" data-admin-mail-error>{m.error}</p>}
                  <pre className="whitespace-pre-wrap break-words rounded-md bg-bg-0 px-3 py-2 font-sans text-text-1">{m.body}</pre>
                  <button type="button" className="btn-ghost mt-2 py-1 text-danger" onClick={() => remove(m.id)} data-admin-mail-delete>Delete this email</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
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

interface UserContent { user: { id: string; username: string; display_name: string }; quota: number | null; quota_override: number | null; messages: AdminHit[]; uploads: { id: string; filename: string; content_type: string; size: number; url: string; message_id: string | null; created_at: string }[]; images: { id: string; kind: string; size: number; url: string; created_at: string }[]; totals: { messages: number; attachments: number; attachment_bytes: number; images: number; image_bytes: number } }

interface AdminSession { id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string }

function UserContentPane() {
  const { id } = useParams()
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const [data, setData] = useState<UserContent | null>(null)
  const [tab, setTab] = useState<'messages' | 'uploads' | 'sessions'>('messages')
  const [sessions, setSessions] = useState<AdminSession[] | null>(null)
  const loadSessions = async () => { try { setSessions(await api.get<AdminSession[]>(`/admin/users/${id}/sessions`)) } catch { setSessions([]) } }
  const load = async () => { try { setData(await api.get<UserContent>(`/admin/users/${id}/content`)); loadSessions() } catch (e) { pushToast((e as Error).message, 'error') } }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = useNavigate()
  const logoutOne = async (sid: string) => { try { await api.delete(`/admin/users/${id}/sessions/${sid}`); pushToast('Device logged out'); loadSessions() } catch (e) { pushToast((e as Error).message, 'error') } }
  const logoutAll = async () => { try { const r = await api.delete<{ revoked: number }>(`/admin/users/${id}/sessions`); pushToast(`Logged out of ${r.revoked} device${r.revoked === 1 ? '' : 's'}`); loadSessions() } catch (e) { pushToast((e as Error).message, 'error') } }
  if (!data) return <p className="text-sm text-text-2">Loading…</p>
  const { user, totals } = data
  const used = totals.attachment_bytes + totals.image_bytes
  const setQuota = async (mb: string) => {
    const v = mb.trim() === '' ? null : Math.round(Number(mb) * 1024 * 1024)
    if (v !== null && (!Number.isFinite(v) || v < 0)) { pushToast('Enter a size in MB (0 = unlimited)', 'error'); return }
    try { await api.patch(`/admin/users/${user.id}`, { upload_quota_bytes: v }); pushToast(v === null ? 'Quota reset to the default' : v === 0 ? 'Quota removed' : `Quota set to ${formatBytes(v)}`); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const purgeMessages = () => openModal({ kind: 'confirm', title: `Delete all messages by @${user.username}`, body: `This deletes all ${totals.messages.toLocaleString()} messages ${user.display_name} has ever sent, everywhere. This cannot be undone.`, danger: true, confirmLabel: 'Delete All Messages',
    action: async () => { try { const r = await api.delete<{ deleted: number }>(`/admin/users/${user.id}/messages`); pushToast(`${r.deleted} messages deleted`); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  const purgeUploads = () => openModal({ kind: 'confirm', title: `Purge uploads by @${user.username}`, body: `Removes all ${totals.attachments} attachments (${formatBytes(totals.attachment_bytes)}) and their profile images. Their messages stay, without the files. This cannot be undone.`, danger: true, confirmLabel: 'Purge Uploads',
    action: async () => { try { const r = await api.delete<{ attachments: number; images: number }>(`/admin/users/${user.id}/uploads`); pushToast(`${r.attachments} attachments and ${r.images} images removed`); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <div data-admin-user-content={user.id}>
      <NavLink to="/admin/users" className="text-xs text-sky-400 hover:underline">← Users</NavLink>
      <h1 className="text-2xl font-bold mt-1">{user.display_name} <span className="text-base font-normal text-text-2">@{user.username}</span></h1>
      <p className="text-sm text-text-2 mt-1" data-admin-content-totals>{totals.messages.toLocaleString()} messages · {totals.attachments} attachments ({formatBytes(totals.attachment_bytes)}) · {totals.images} profile/expression images ({formatBytes(totals.image_bytes)})</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-admin-quota-row>
        <span className="text-text-2">Storage: <b className="text-text-0" data-admin-quota-used>{formatBytes(used)}</b> of <b className="text-text-0" data-admin-quota-value>{data.quota === null ? 'unlimited' : formatBytes(data.quota)}</b>{data.quota_override !== null && <span className="ml-1 rounded bg-warn/20 text-warn px-1 text-[10px] font-bold">CUSTOM</span>}</span>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); setQuota((e.currentTarget.elements.namedItem('mb') as HTMLInputElement).value) }}>
          <input name="mb" className="input w-28 py-1 text-xs" placeholder="MB" inputMode="decimal" data-admin-quota-input />
          <button className="btn-ghost py-1 text-xs" data-admin-quota-save>Set quota</button>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setQuota('')} data-admin-quota-reset>Default</button>
        </form>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-danger py-1 text-xs" onClick={purgeMessages} disabled={totals.messages === 0} data-admin-purge-messages>Delete all messages</button>
        <button type="button" className="btn-danger py-1 text-xs" onClick={purgeUploads} disabled={totals.attachments === 0 && totals.images === 0} data-admin-purge-uploads>Purge uploads</button>
      </div>
      <div className="mt-5 flex gap-1.5">
        {(['messages', 'uploads', 'sessions'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${tab === t ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-admin-content-tab={t}>{t}</button>)}
      </div>
      {tab === 'sessions' ? (
        <div className="mt-3 rounded-xl border border-line bg-bg-1 overflow-hidden" data-admin-sessions>
          <div className="flex items-center justify-between px-3 py-2 border-b border-line text-xs text-text-2">
            <span>{sessions ? `${sessions.length} active device${sessions.length === 1 ? '' : 's'} (last 30 days)` : 'Loading…'}</span>
            {!!sessions?.length && <button type="button" className="btn-danger py-1 text-xs" onClick={logoutAll} data-admin-logout-all>Log out all</button>}
          </div>
          {sessions?.length === 0 && <p className="p-4 text-sm text-text-2">No active sessions.</p>}
          {sessions?.map((sn) => (
            <div key={sn.id} className="px-3 py-2 border-t border-line first:border-t-0 text-sm flex items-center gap-3" data-admin-session={sn.id}>
              <div className="min-w-0 flex-1">
                <div className="truncate" title={sn.user_agent}>{sn.user_agent || 'Unknown client'}</div>
                <div className="text-xs text-text-2">
                  <button type="button" className="text-sky-400 hover:underline" title="Users seen from this IP" onClick={() => navigate(`/admin/users?ip=${encodeURIComponent(sn.ip)}`)} data-admin-session-ip>{sn.ip}</button>
                  {' · '}signed in {new Date(sn.created_at).toLocaleString()} · last seen {new Date(sn.last_seen_at).toLocaleString()}
                </div>
              </div>
              <button type="button" className="btn-ghost py-1 text-xs text-danger" onClick={() => logoutOne(sn.id)} data-admin-session-logout>Log out</button>
            </div>
          ))}
        </div>
      ) : tab === 'messages' ? (
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

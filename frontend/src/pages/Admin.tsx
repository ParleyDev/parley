import BlockedLinksPane from './AdminBlockedLinks'
import AppsPane from './AdminApps'
import { Ban, Bot, Compass, Eraser, FileSearch, Flag, FolderOpen, Gavel, KeyRound, LayoutDashboard, LogOut, Mail, RefreshCw, ScrollText, Megaphone, Eye, UserCog, Briefcase, Server, ShieldCheck, ShieldOff, Trash2, UserCheck, Users, UserX, HardDrive, Upload } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { AccessCtx, can, useAccess, type AdminAccess } from './adminAccess'
import { MetaRow, type MetaHit, type OpenedMsg } from './AdminCases'
import CasesPane, { CasePane } from './AdminCases'
import { NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import SplitLayout, { useShowContent } from '../components/SplitLayout'
import { MobileBack } from '../components/HeaderBits'
import { api } from '../lib/api'
import { formatBytes } from '../lib/upload'
import { colorFor, initials } from '../lib/format'
import { useStore } from '../store'
import { useT, t as tr, tn } from '../lib/i18n'

/** Root console for Parley admins: stats, users, servers, instance settings. */
export default function AdminPage() {
  const t = useT()
  const [access, setAccess] = useState<AdminAccess | null>(null)
  useEffect(() => { api.get<AdminAccess>('/admin/access').then(setAccess).catch(() => setAccess({ roles: [], perms: [], all_roles: [] })) }, [])
  const a = access
  const item = (active: boolean) => `flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium ${active ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`
  const showContent = useShowContent()
  return (
    <AccessCtx.Provider value={access}>
    <SplitLayout defaultPane="nav" testid={{ 'data-admin': '' }} sidebar={
          <aside className="w-[var(--sidebar-w)] tab:w-[224px] max-md:flex-1 shrink-0 bg-bg-1 flex flex-col">
            <div className="h-12 px-4 flex items-center gap-2 font-bold text-lg border-b border-line"><ShieldCheck size={20} className="text-success" /> {t('Admin Console')}</div>
            <nav className="p-2 space-y-0.5">
              <NavLink to="/admin" end onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="overview"><LayoutDashboard size={20} /> {t('Overview')}</NavLink>
              {can(a, 'account_metadata_read') && <NavLink to="/admin/users" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="users"><Users size={20} /> {t('Users')}</NavLink>}
              {can(a, 'conversation_metadata_read') && <NavLink to="/admin/servers" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="servers"><Server size={20} /> {t('Servers')}</NavLink>}
              {can(a, 'instance_manage') && <NavLink to="/discover/review" onClick={showContent} className={() => item(false)} data-admin-nav="discovery"><Compass size={20} /> {t('Discovery Queue')}</NavLink>}
              {can(a, 'instance_manage') && <NavLink to="/admin/settings" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="settings"><Megaphone size={20} /> {t('Instance Settings')}</NavLink>}
              {can(a, 'content_search_public') && <NavLink to="/admin/messages" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="messages"><FileSearch size={20} /> {t('Search')}</NavLink>}
              {can(a, 'report_context_read', 'case_approve') && <NavLink to="/admin/cases" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="cases"><Briefcase size={20} /> {t('Cases')}</NavLink>}
              {can(a, 'report_context_read') && <NavLink to="/admin/reports" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="reports"><Flag size={20} /> {t('Reports')}</NavLink>}
              {can(a, 'instance_manage') && <NavLink to="/admin/blocked-links" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="blocked-links"><Ban size={20} /> {t('Blocked Links')}</NavLink>}
              {can(a, 'instance_manage') && <NavLink to="/admin/apps" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="apps"><Bot size={20} /> {t('Apps')}</NavLink>}
              {can(a, 'audit_read_own', 'audit_read_team', 'audit_read_all') && <NavLink to="/admin/audit" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="audit"><ScrollText size={20} /> {t('Audit Log')}</NavLink>}
              {can(a, 'account_pii_reveal') && <NavLink to="/admin/mail" onClick={showContent} className={({ isActive }) => item(isActive)} data-admin-nav="mail"><Mail size={20} /> {t('Mail')}</NavLink>}
            </nav>
          </aside>
    }>
      <div className="md:hidden h-12 shrink-0 px-2 flex items-center gap-1 border-b border-line"><MobileBack /><span className="font-bold">{t('Admin Console')}</span></div>
      <div className="flex-1 min-h-0 overflow-y-auto px-10 py-8 max-md:px-4 max-md:py-5">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="users" element={<UsersPane />} />
          <Route path="servers" element={<ServersPane />} />
          <Route path="settings" element={<SettingsPane />} />
          <Route path="audit" element={<AuditPane />} />
          <Route path="mail" element={<MailPane />} />
          <Route path="reports" element={<ReportsPane />} />
          <Route path="cases" element={<CasesPane />} />
          <Route path="cases/:id" element={<CasePane />} />
          <Route path="blocked-links" element={<BlockedLinksPane />} />
          <Route path="apps" element={<AppsPane />} />
          <Route path="messages" element={<MessagesPane />} />
          <Route path="users/:id" element={<UserContentPane />} />
        </Routes>
      </div>
    </SplitLayout>
    </AccessCtx.Provider>
  )
}

interface Stats { users: number; admins: number; suspended: number; online: number; guilds: number; messages: number; discovery_pending: number; discovery_approved: number; upload_bytes: number; reports_open?: number }

function Overview() {
  const t = useT()
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => { api.get<Stats>('/admin/stats').then(setS).catch(() => {}) }, [])
  const cards = s ? [
    [t('Users'), s.users.toLocaleString(), t('{online} online · {admins} · {suspended} suspended', { online: s.online, admins: s.admins === 1 ? t('1 admin') : t('{n} admins', { n: s.admins }), suspended: s.suspended })],
    [t('Servers'), s.guilds.toLocaleString(), t('{approved} in Discover · {pending} pending review', { approved: s.discovery_approved, pending: s.discovery_pending })],
    [t('Messages'), s.messages.toLocaleString(), t('across all servers and DMs')],
    [t('Uploads'), formatBytes(s.upload_bytes), t('attachments, avatars, emoji and stickers')],
    [t('Reports'), String(s.reports_open ?? 0), t('open reports waiting for review')],
  ] : []
  return (
    <div data-admin-overview>
      <h1 className="text-2xl font-bold">{t('Overview')}</h1>
      <p className="text-sm text-text-2 mt-1">{t('You are acting as a Parley admin. Changes here apply to everyone on this instance.')}</p>
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {cards.map(([label, v, sub]) => (
          <div key={label} className="rounded-xl border border-line bg-bg-1 p-4" data-stat={label}>
            <div className="text-xs font-bold uppercase tracking-wider text-text-2">{label}</div>
            <div className="text-3xl font-black mt-1">{v}</div>
            <div className="text-xs text-text-2 mt-1">{sub}</div>
          </div>
        ))}
        {!s && <p className="text-sm text-text-2">{t('Loading…')}</p>}
      </div>
    </div>
  )
}

interface AdminUser { id: string; username: string; display_name: string; email: string | null; created_at: string; is_admin: boolean; bot?: boolean; account_state?: 'active' | 'pending_deletion' | 'deleted'; deletion_scheduled_for?: string | null; suspended_at: string | null; email_verified_at?: string | null; mfa_enabled?: boolean; upload_quota_bytes?: number | null; max_upload_bytes?: number | null; last_seen_at?: string | null; guild_count: number; online: boolean }
type Tri = '' | 'true' | 'false'
interface UserFilters { admin: Tri; suspended: Tri; verified: Tri; mfa: Tri; online: Tri; joined_before: string; joined_after: string; inactive_days: string; ip: string }
const EMPTY_FILTERS: UserFilters = { admin: '', suspended: '', verified: '', mfa: '', online: '', joined_before: '', joined_after: '', inactive_days: '', ip: '' }
const PAGE = 100

function UsersPane() {
  const t = useT()
  const a = useAccess()
  const act = can(a, 'content_action'), inst = can(a, 'instance_manage'), manage = can(a, 'admin_roles_manage')
  const [rolesFor, setRolesFor] = useState<AdminUser | null>(null)
  const [revealFor, setRevealFor] = useState<AdminUser | null>(null)
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [q, setQ] = useState('')
  const [params] = useSearchParams()
  const [filters, setFilters] = useState<UserFilters>({ ...EMPTY_FILTERS, ip: params.get('ip') ?? '' })
  // People and bots are listed apart; deleted (anonymized) accounts only when asked for.
  const [kind, setKind] = useState<'people' | 'bots'>('people')
  const [withDeleted, setWithDeleted] = useState(false)
  const [list, setList] = useState<AdminUser[] | null>(null)
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const query = (offset: number) => {
    const p = new URLSearchParams({ q: q.trim(), offset: String(offset), limit: String(PAGE) })
    for (const [k, v] of Object.entries(filters)) if (v !== '') p.set(k, v)
    p.set('kind', kind)
    if (withDeleted) p.set('include_deleted', 'true')
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
  useEffect(() => { const h = setTimeout(() => load(), 250); return () => clearTimeout(h) }, [q, filters, kind, withDeleted]) // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = useNavigate()
  const logoutAll = async (u: AdminUser) => {
    try { const r = await api.delete<{ revoked: number }>(`/admin/users/${u.id}/sessions`); pushToast(r.revoked === 1 ? t('@{username} logged out of 1 device', { username: u.username }) : t('@{username} logged out of {n} devices', { username: u.username, n: r.revoked })) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const patch = async (u: AdminUser, body: { is_admin?: boolean; suspended?: boolean; mfa?: boolean }, label: string) => {
    try { await api.patch(`/admin/users/${u.id}`, body); pushToast(label); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const [limitFor, setLimitFor] = useState<AdminUser | null>(null)
  const [limitMb, setLimitMb] = useState('')
  const saveLimit = async (mode: 'set' | 'default') => {
    if (!limitFor) return
    const body = mode === 'default' ? null : Math.round(Number(limitMb) * 1024 * 1024)
    if (mode === 'set' && (!Number.isFinite(body as number) || (body as number) <= 0)) { pushToast(t('Enter a size in MB'), 'error'); return }
    try { await api.patch(`/admin/users/${limitFor.id}`, { max_upload_bytes: body }); pushToast(mode === 'default' ? t('@{username} uses the instance upload limit', { username: limitFor.username }) : t('@{username} may upload files up to {mb} MB', { username: limitFor.username, mb: limitMb })); setLimitFor(null); await load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const [quotaFor, setQuotaFor] = useState<AdminUser | null>(null)
  const [quotaMb, setQuotaMb] = useState('')
  const saveQuota = async (mode: 'set' | 'unlimited' | 'default') => {
    if (!quotaFor) return
    const body = mode === 'default' ? null : mode === 'unlimited' ? 0 : Math.round(Number(quotaMb) * 1024 * 1024)
    if (mode === 'set' && (!Number.isFinite(body as number) || (body as number) <= 0)) { pushToast(t('Enter a size in MB'), 'error'); return }
    try { await api.patch(`/admin/users/${quotaFor.id}`, { upload_quota_bytes: body }); pushToast(mode === 'default' ? t('@{username} uses the instance default quota', { username: quotaFor.username }) : mode === 'unlimited' ? t('@{username} has unlimited storage', { username: quotaFor.username }) : t('@{username} may store {mb} MB', { username: quotaFor.username, mb: quotaMb })); setQuotaFor(null); setQuotaMb('') } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const del = (u: AdminUser) => openModal({ kind: 'confirm', title: t('Delete @{username}', { username: u.username }), body: t("This deletes {name}'s account now: the servers and apps they own are deleted, and their account is anonymized (their messages stay, as \"Deleted User\"). This cannot be undone.", { name: u.display_name }), danger: true, confirmLabel: t('Delete Account'),
    action: async () => { try { await api.delete(`/admin/users/${u.id}`); pushToast(t('Account deleted')); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  // Purge: the account and everything it made, messages included (for spam); deleted accounts can be purged too.
  const purge = (u: AdminUser) => openModal({ kind: 'confirm', title: t('Purge @{username}', { username: u.username }), body: t('This removes the account and everything it made, messages and uploads included, as if it never existed. Use it for spam and abuse. This cannot be undone.'), danger: true, confirmLabel: t('Purge'),
    action: async () => { try { await api.post(`/admin/users/${u.id}/purge`); pushToast(t('Account purged')); load() } catch (e) { pushToast((e as Error).message, 'error') } } })

  // ---- bulk mode ----
  const selectable = (list ?? []).filter((u) => u.id !== me?.id && u.account_state !== 'deleted')
  const allSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((u) => u.id)))
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const runBulk = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      const r = await api.post<{ done: number; failed: { id: string; error: string }[] }>('/admin/users/bulk', { ids: [...selected], action, ...extra })
      pushToast((r.done === 1 ? t('1 account updated') : t('{n} accounts updated', { n: r.done })) + (r.failed.length ? t(', {n} skipped ({error})', { n: r.failed.length, error: r.failed[0].error }) : ''), r.failed.length ? 'error' : 'info')
      await load()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const bulk = (action: string, label: string, body: string, danger = false, extra: Record<string, unknown> = {}) =>
    openModal({ kind: 'confirm', title: selected.size === 1 ? t('{label} 1 account', { label }) : t('{label} {n} accounts', { label, n: selected.size }), body, danger, confirmLabel: label, action: () => runBulk(action, extra) })
  const bulkQuota = () => { const mb = window.prompt(t('Storage quota in MB for the selected accounts (0 = unlimited, empty = instance default)'), ''); if (mb === null) return; const v = mb.trim() === '' ? null : Math.round(Number(mb) * 1024 * 1024); if (v !== null && !Number.isFinite(v)) { pushToast(t('Enter a number of MB'), 'error'); return } runBulk('quota', { upload_quota_bytes: v }) }
  const tri = (k: keyof UserFilters, label: string, yes: string, no: string) => (
    <select className="input w-auto py-1 text-xs" value={filters[k]} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })} data-admin-filter={k} aria-label={label}>
      <option value="">{t('{label}: any', { label })}</option><option value="true">{yes}</option><option value="false">{no}</option>
    </select>
  )
  const activeFilters = Object.values(filters).filter((v) => v !== '').length
  return (
    <div data-admin-users>
      <h1 className="text-2xl font-bold">{t('Users')}</h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line overflow-hidden text-sm" role="tablist" aria-label={t('Account type')}>
          {(['people', 'bots'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`px-3 py-1.5 font-medium ${kind === k ? 'bg-accent text-white' : 'text-text-1 hover:bg-bg-3'}`} data-admin-kind={k}>{k === 'people' ? t('People') : t('Bots')}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by username, display name or email')} data-admin-user-search className="input max-w-md" />
        {tri('admin', t('Role'), t('Admins'), t('Not admins'))}
        {tri('suspended', t('Status'), t('Suspended'), t('Active'))}
        {tri('verified', t('Email'), t('Verified'), t('Unverified'))}
        {tri('mfa', t('2FA'), t('Enabled'), t('Not enabled'))}
        {tri('online', t('Presence'), t('Online now'), t('Offline'))}
        <label className="flex items-center gap-1 text-xs text-text-2">{t('Joined after')} <input type="date" className="input w-auto py-1 text-xs" value={filters.joined_after} onChange={(e) => setFilters({ ...filters, joined_after: e.target.value })} data-admin-filter="joined_after" /></label>
        <label className="flex items-center gap-1 text-xs text-text-2">{t('before')} <input type="date" className="input w-auto py-1 text-xs" value={filters.joined_before} onChange={(e) => setFilters({ ...filters, joined_before: e.target.value })} data-admin-filter="joined_before" /></label>
        <label className="flex items-center gap-1 text-xs text-text-2">{t('Inactive for')} <input type="number" min={1} className="input w-20 py-1 text-xs" value={filters.inactive_days} onChange={(e) => setFilters({ ...filters, inactive_days: e.target.value })} placeholder={t('days')} data-admin-filter="inactive_days" /> {t('days')}</label>
        <label className="flex items-center gap-1 text-xs text-text-2">{t('IP')} <input className="input w-36 py-1 text-xs" value={filters.ip} onChange={(e) => setFilters({ ...filters, ip: e.target.value })} placeholder="203.0.113.7" data-admin-filter-ip /></label>
        <label className="flex items-center gap-1.5 text-xs text-text-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={withDeleted} onChange={(e) => setWithDeleted(e.target.checked)} data-admin-include-deleted />{t('Include deleted')}</label>
        {activeFilters > 0 && <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setFilters(EMPTY_FILTERS)} data-admin-filter-clear>{t('Clear filters')}</button>}
        <span className="ml-auto text-xs text-text-2" data-admin-user-total>{list ? `${list.length} of ${total}` : '…'}</span>
      </div>
      {limitFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 safe-pad" onClick={() => setLimitFor(null)} data-admin-limit-dialog>
          <div className="pop w-full max-w-md rounded-xl bg-bg-1 border border-line p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{t('Upload size limit for @{username}', { username: limitFor.username })}</h3>
            <p className="text-sm text-text-2">{t('The largest single file they can attach. The instance limit applies unless you set one here.')}</p>
            <div className="flex items-center gap-2"><input type="number" min={1} className="input w-32" placeholder="MB" value={limitMb} onChange={(e) => setLimitMb(e.target.value)} data-admin-limit-mb /><span className="text-sm text-text-2">{t('MB')}</span><button type="button" className="btn-primary py-1.5" onClick={() => saveLimit('set')} data-admin-limit-set>{t('Set')}</button></div>
            <div className="flex gap-2"><button type="button" className="btn-ghost py-1.5" onClick={() => saveLimit('default')} data-admin-limit-default>{t('Use instance limit')}</button><button type="button" className="btn-ghost py-1.5 ml-auto" onClick={() => setLimitFor(null)}>{t('Cancel')}</button></div>
          </div>
        </div>
      )}
      {quotaFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 safe-pad" onClick={() => setQuotaFor(null)} data-admin-quota-dialog>
          <div className="pop w-full max-w-md rounded-xl bg-bg-1 border border-line p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{t('Storage quota for @{username}', { username: quotaFor.username })}</h3>
            <p className="text-sm text-text-2">{t('Attachments and profile images together. The instance default applies unless you set one here.')}</p>
            <div className="flex items-center gap-2"><input type="number" min={1} className="input w-32" placeholder="MB" value={quotaMb} onChange={(e) => setQuotaMb(e.target.value)} data-admin-quota-mb /><span className="text-sm text-text-2">{t('MB')}</span><button type="button" className="btn-primary py-1.5" onClick={() => saveQuota('set')} data-admin-quota-set>{t('Set')}</button></div>
            <div className="flex gap-2"><button type="button" className="btn-ghost py-1.5" onClick={() => saveQuota('unlimited')} data-admin-quota-unlimited>{t('Unlimited')}</button><button type="button" className="btn-ghost py-1.5" onClick={() => saveQuota('default')} data-admin-quota-default>{t('Use instance default')}</button><button type="button" className="btn-ghost py-1.5 ml-auto" onClick={() => setQuotaFor(null)}>{t('Cancel')}</button></div>
          </div>
        </div>
      )}
      {rolesFor && <RolesDialog user={rolesFor} all={a?.all_roles ?? []} onClose={() => setRolesFor(null)} onSaved={() => { setRolesFor(null); load() }} />}
      {revealFor && <RevealDialog user={revealFor} onClose={() => setRevealFor(null)} />}
      {selected.size > 0 && (act || inst) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm" data-admin-bulk-bar>
          <span className="font-semibold" data-admin-bulk-count>{t('{n} selected', { n: selected.size })}</span>
          {act && <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => bulk('suspend', t('Suspend'), t('Suspended accounts are logged out everywhere and cannot log in until unsuspended.'), true)} data-admin-bulk="suspend">{t('Suspend')}</button>}
          {act && <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => bulk('unsuspend', t('Unsuspend'), t('They will be able to log in again.'))} data-admin-bulk="unsuspend">{t('Unsuspend')}</button>}
          {act && <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => bulk('logout', t('Log out'), t('Every session of the selected accounts is revoked.'))} data-admin-bulk="logout">{t('Log out everywhere')}</button>}
          {act && <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => bulk('clear_mfa', t('Clear 2FA'), t('Two-factor authentication is removed from the selected accounts; they log in with just their password.'), true)} data-admin-bulk="clear_mfa">{t('Clear 2FA')}</button>}
          {inst && <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={bulkQuota} data-admin-bulk="quota">{t('Set quota')}</button>}
          {act && <button type="button" className="btn-danger py-1 text-xs" disabled={busy} onClick={() => bulk('delete', t('Delete'), t('This deletes the selected accounts now: the servers and apps they own are deleted, and the accounts are anonymized (their messages stay, as "Deleted User"). This cannot be undone.'), true)} data-admin-bulk="delete">{t('Delete')}</button>}
          <button type="button" className="ml-auto text-xs text-text-2 hover:text-text-0" onClick={() => setSelected(new Set())} data-admin-bulk-clear>{t('Clear selection')}</button>
        </div>
      )}
      <div className="mt-4 rounded-xl border border-line overflow-hidden">
        <div className="grid grid-cols-[28px_1fr_1fr_90px_110px_200px] gap-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-2 bg-bg-0/40 max-md:hidden items-center">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={allSelected} onChange={toggleAll} aria-label={t('Select all')} data-admin-select-all />
          <span>{t('User')}</span><span>{t('Email')}</span><span>{t('Servers')}</span><span>{t('Joined')}</span><span />
        </div>
        {list === null && <p className="p-4 text-sm text-text-2">{t('Loading…')}</p>}
        {list?.length === 0 && <p className="p-4 text-sm text-text-2">{t('No users match.')}</p>}
        {list?.map((u) => (
          <div key={u.id} className={`grid grid-cols-[28px_1fr_1fr_90px_110px_200px] max-md:grid-cols-1 gap-3 items-center px-3 py-2 border-t border-line hover:bg-bg-3/40 ${selected.has(u.id) ? 'bg-accent/5' : ''}`} data-admin-user={u.username} data-selected={selected.has(u.id) ? '1' : '0'}>
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={selected.has(u.id)} disabled={u.id === me?.id || u.account_state === 'deleted'} onChange={() => toggle(u.id)} aria-label={t('Select @{username}', { username: u.username })} data-admin-select />
            <div className="min-w-0 flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full shrink-0 ${u.online ? 'bg-success' : 'bg-text-2'}`} />
              <span className="min-w-0"><span className="block truncate font-semibold">{u.display_name}</span><span className="block truncate text-xs text-text-2">@{u.username}{u.last_seen_at ? ` · ${t('seen {date}', { date: new Date(u.last_seen_at).toLocaleDateString() })}` : ''}</span></span>
              {u.bot && <span className="rounded bg-accent/20 text-accent px-1.5 py-0.5 text-[10px] font-bold" data-badge="bot">{t('BOT')}</span>}
              {u.account_state === 'deleted' && <span className="rounded bg-text-2/20 text-text-2 px-1.5 py-0.5 text-[10px] font-bold" data-badge="deleted">{t('DELETED')}</span>}
              {u.account_state === 'pending_deletion' && <span className="rounded bg-danger/20 text-danger px-1.5 py-0.5 text-[10px] font-bold" title={u.deletion_scheduled_for ? new Date(u.deletion_scheduled_for).toLocaleString() : undefined} data-badge="pending-deletion">{t('DELETING {date}', { date: u.deletion_scheduled_for ? new Date(u.deletion_scheduled_for).toLocaleDateString() : '' })}</span>}
              {u.is_admin && <span className="rounded bg-success/20 text-success px-1.5 py-0.5 text-[10px] font-bold" data-badge="admin">{t('ADMIN')}</span>}
              {u.suspended_at && <span className="rounded bg-danger/20 text-danger px-1.5 py-0.5 text-[10px] font-bold" data-badge="suspended">{t('SUSPENDED')}</span>}
              {u.mfa_enabled && <span className="rounded bg-sky-500/20 text-sky-300 px-1.5 py-0.5 text-[10px] font-bold" data-badge="mfa">{t('2FA')}</span>}
              {!u.email_verified_at && !u.bot && u.account_state !== 'deleted' && <span className="rounded bg-warn/20 text-warn px-1.5 py-0.5 text-[10px] font-bold" data-badge="unverified">{t('UNVERIFIED')}</span>}
            </div>
            <div className="text-sm text-text-1 truncate"><span className="md:hidden text-text-2">{t('Email:')} </span>{u.email ?? '—'}{u.email?.includes('***') && can(a, 'account_pii_reveal') && <button type="button" className="ml-1.5 inline-flex align-middle text-text-2 hover:text-text-0" title={t('Reveal email and devices')} aria-label={t('Reveal email and devices')} onClick={() => setRevealFor(u)} data-admin-reveal><Eye size={14} /></button>}</div>
            <div className="text-sm text-text-1"><span className="md:hidden text-text-2">{t('Servers:')} </span>{u.guild_count}</div>
            <div className="text-xs text-text-2"><span className="md:hidden">{t('Joined:')} </span>{new Date(u.created_at).toLocaleDateString()}</div>
            <div className="flex items-center justify-end gap-1">
              {u.account_state === 'deleted' && act && <Tool label={t('Purge account')} onClick={() => purge(u)} testid="purge-user" danger><Eraser size={16} /></Tool>}
              {u.id !== me?.id && u.account_state !== 'deleted' && (
                <>
                  {manage && <Tool label={u.is_admin ? t('Remove admin') : t('Make admin')} onClick={() => patch(u, { is_admin: !u.is_admin }, u.is_admin ? t('@{username} is no longer an admin', { username: u.username }) : t('@{username} is now an admin', { username: u.username }))} testid="toggle-admin">{u.is_admin ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}</Tool>}
                  {manage && <Tool label={t('Admin roles')} onClick={() => setRolesFor(u)} testid="roles"><UserCog size={16} /></Tool>}
                  {act && <Tool label={u.suspended_at ? t('Unsuspend') : t('Suspend')} onClick={() => patch(u, { suspended: !u.suspended_at }, u.suspended_at ? t('@{username} unsuspended', { username: u.username }) : t('@{username} suspended', { username: u.username }))} testid="toggle-suspend" danger={!u.suspended_at}>{u.suspended_at ? <UserCheck size={16} /> : <UserX size={16} />}</Tool>}
                  {can(a, 'account_metadata_read') && <Tool label={t('Storage and devices')} onClick={() => navigate(`/admin/users/${u.id}`)} testid="content"><FolderOpen size={16} /></Tool>}
                  {act && <Tool label={t('Log out of all devices')} onClick={() => logoutAll(u)} testid="logout-all"><LogOut size={16} /></Tool>}
                  {inst && <Tool label={t('Storage quota')} onClick={() => setQuotaFor(u)} testid="quota"><HardDrive size={16} /></Tool>}
                  {inst && <Tool label={t('Upload size limit')} onClick={() => { setLimitFor(u); setLimitMb(u.max_upload_bytes ? String(Math.round(u.max_upload_bytes / 1048576)) : '') }} testid="upload-limit"><Upload size={16} /></Tool>}
                  {u.mfa_enabled && act && <Tool label={t('Clear two-factor auth')} onClick={() => patch(u, { mfa: false }, t('Two-factor authentication cleared for @{username}', { username: u.username }))} testid="clear-mfa" danger><KeyRound size={16} /></Tool>}
                  {act && <Tool label={t('Delete account')} onClick={() => del(u)} testid="delete-user" danger><Trash2 size={16} /></Tool>}
                  {act && <Tool label={t('Purge account')} onClick={() => purge(u)} testid="purge-user" danger><Eraser size={16} /></Tool>}
                </>
              )}
              {u.id === me?.id && <span className="text-xs text-text-2">{t('you')}</span>}
            </div>
          </div>
        ))}
        {list && list.length < total && <button type="button" className="w-full py-2 text-sm text-sky-400 hover:bg-bg-3 border-t border-line" onClick={() => load(true)} data-admin-user-more>{t('Load more ({n} remaining)', { n: total - list.length })}</button>}
      </div>
    </div>
  )
}

/** Grant or take away admin roles (SUPER_ADMIN). Any role opens the console; none closes it. */
function RolesDialog({ user, all, onClose, onSaved }: { user: AdminUser; all: string[]; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [roles, setRoles] = useState<Set<string> | null>(null)
  useEffect(() => { api.get<{ id: string; roles: string[] }[]>('/admin/roles').then((l) => setRoles(new Set(l.find((x) => x.id === user.id)?.roles ?? []))).catch((e) => pushToast((e as Error).message, 'error')) }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const about: Record<string, string> = {
    SUPPORT: t('Account details; email and devices only through a logged reveal.'),
    MODERATOR: t('Reports and their context, content actions, their own audit entries.'),
    TS_LEAD: t('Everything a moderator can do, plus account PII, approving case grants and their team\'s audit entries.'),
    LEGAL: t('Case-bound content, exports with an approved case, the whole audit log.'),
    SUPER_ADMIN: t('Roles and instance settings. No access to content.'),
    AUDITOR: t('Read-only access to the audit log.'),
    SUPER_ADMIN_TEMP: t('Temporary: admin message search, until case-based access replaces it.'),
  }
  const save = async () => {
    try { await api.put(`/admin/users/${user.id}/roles`, { roles: [...(roles ?? [])] }); pushToast(t('Roles updated for @{username}', { username: user.username })); onSaved() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 safe-pad" onClick={onClose} data-admin-roles-dialog>
      <div className="pop w-full max-w-md rounded-xl bg-bg-1 border border-line p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{t('Admin roles for @{username}', { username: user.username })}</h3>
        {roles === null ? <p className="text-sm text-text-2">{t('Loading…')}</p> : (
          <div className="space-y-1.5">
            {all.map((r) => (
              <label key={r} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-bg-3 cursor-pointer">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent" checked={roles.has(r)} onChange={() => setRoles((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n })} data-admin-role={r} />
                <span><span className="block text-sm font-semibold">{r}</span><span className="block text-xs text-text-2">{about[r] ?? ''}</span></span>
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-2 justify-end"><button type="button" className="btn-ghost py-1.5" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn-primary py-1.5" disabled={roles === null} onClick={save} data-admin-roles-save>{t('Save')}</button></div>
      </div>
    </div>
  )
}

/** Unmask someone's email and recent devices. Needs a reason; every reveal is logged. */
function RevealDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [why, setWhy] = useState('')
  const [shown, setShown] = useState<{ email: string | null; sessions: { ip: string; user_agent: string; last_seen_at: string }[] } | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try { setShown(await api.post(`/admin/users/${user.id}/reveal`, { justification: why.trim() })) } catch (err) { pushToast((err as Error).message, 'error') }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 safe-pad" onClick={onClose} data-admin-reveal-dialog>
      <div className="pop w-full max-w-lg rounded-xl bg-bg-1 border border-line p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{t('Reveal details for @{username}', { username: user.username })}</h3>
        {shown ? (
          <div className="space-y-2 text-sm" data-admin-revealed>
            <div><span className="text-text-2">{t('Email:')}</span> <span className="font-semibold" data-admin-revealed-email>{shown.email ?? '—'}</span></div>
            {shown.sessions.length > 0 && <ul className="max-h-48 overflow-y-auto rounded-lg border border-line divide-y divide-line text-xs">{shown.sessions.map((x, i) => <li key={i} className="px-2 py-1.5"><span className="font-mono">{x.ip}</span> · {x.user_agent} · {new Date(x.last_seen_at).toLocaleString()}</li>)}</ul>}
            <div className="flex justify-end"><button type="button" className="btn-ghost py-1.5" onClick={onClose}>{t('Close')}</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-text-2">{t('Email addresses, IPs and devices are hidden by default. Say why you need them; the reveal is logged.')}</p>
            <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('Reason (for example, a support ticket number)')} autoFocus data-admin-reveal-why />
            <div className="flex gap-2 justify-end"><button type="button" className="btn-ghost py-1.5" onClick={onClose}>{t('Cancel')}</button><button type="submit" className="btn-primary py-1.5" disabled={why.trim().length < MIN_WHY} data-admin-reveal-go>{t('Reveal')}</button></div>
          </form>
        )}
      </div>
    </div>
  )
}

interface AdminGuild { id: string; name: string; icon_url: string | null; created_at: string; owner_id: string; owner_username: string; member_count: number; message_count: number; discovery_status: string | null; state: 'active' | 'pending_deletion' | 'taken_down'; deletion_scheduled_for: string | null; takedown_case_id: string | null }

function ServersPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [q, setQ] = useState('')
  const [list, setList] = useState<AdminGuild[] | null>(null)
  const load = () => api.get<AdminGuild[]>(`/admin/guilds?q=${encodeURIComponent(q.trim())}`).then(setList).catch((e: Error) => pushToast(e.message, 'error'))
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAccess()
  const [takingDown, setTakingDown] = useState<AdminGuild | null>(null)
  const del = (g: AdminGuild) => openModal({ kind: 'confirm', title: t("Delete '{name}'", { name: g.name }), body: t('This permanently deletes the server, its channels and {messages} messages for all {members} members. This cannot be undone.', { messages: g.message_count.toLocaleString(), members: g.member_count }), danger: true, confirmLabel: t('Delete Server'),
    action: async () => { try { await api.delete(`/admin/guilds/${g.id}`); pushToast(t('Server deleted')); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <div data-admin-servers>
      <h1 className="text-2xl font-bold">{t('Servers')}</h1>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by server name or owner')} data-admin-guild-search className="input mt-4 max-w-md" />
      {takingDown && <TakedownDialog guild={takingDown} onClose={() => setTakingDown(null)} onDone={() => { setTakingDown(null); load() }} />}
      <div className="mt-4 rounded-xl border border-line overflow-hidden">
        <div className="grid grid-cols-[1fr_160px_100px_110px_120px_60px] gap-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-2 bg-bg-0/40 max-md:hidden"><span>{t('Server')}</span><span>{t('Owner')}</span><span>{t('Members')}</span><span>{t('Messages')}</span><span>{t('Discover')}</span><span /></div>
        {list === null && <p className="p-4 text-sm text-text-2">{t('Loading…')}</p>}
        {list?.length === 0 && <p className="p-4 text-sm text-text-2">{t('No servers match.')}</p>}
        {list?.map((g) => (
          <div key={g.id} className="grid grid-cols-[1fr_160px_100px_110px_120px_60px] max-md:grid-cols-1 gap-3 items-center px-3 py-2 border-t border-line hover:bg-bg-3/40" data-admin-guild={g.name}>
            <div className="min-w-0 flex items-center gap-2">
              <span className="h-8 w-8 rounded-xl overflow-hidden flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: g.icon_url ? undefined : colorFor(g.id) }}>{g.icon_url ? <img src={g.icon_url} alt="" className="h-full w-full object-cover" /> : initials(g.name)}</span>
              <span className="min-w-0"><span className="block truncate font-semibold">{g.name}</span><span className="block truncate text-xs text-text-2">{new Date(g.created_at).toLocaleDateString()}</span></span>
              {g.state === 'pending_deletion' && <span className="rounded bg-warn/20 text-warn px-1.5 py-0.5 text-[10px] font-bold" data-badge="pending-deletion">{t('DELETING {date}', { date: g.deletion_scheduled_for ? new Date(g.deletion_scheduled_for).toLocaleDateString() : '' })}</span>}
              {g.state === 'taken_down' && <span className="rounded bg-danger/20 text-danger px-1.5 py-0.5 text-[10px] font-bold" data-badge="taken-down">{t('TAKEN DOWN')}</span>}
            </div>
            <div className="text-sm text-text-1 truncate"><span className="md:hidden text-text-2">{t('Owner:')} </span>@{g.owner_username}</div>
            <div className="text-sm text-text-1"><span className="md:hidden text-text-2">{t('Members:')} </span>{g.member_count}</div>
            <div className="text-sm text-text-1"><span className="md:hidden text-text-2">{t('Messages:')} </span>{g.message_count.toLocaleString()}</div>
            <div className="text-xs"><span className="md:hidden text-text-2">{t('Discover:')} </span>{g.discovery_status ? <span className={`rounded px-1.5 py-0.5 font-bold uppercase ${g.discovery_status === 'approved' ? 'bg-success/20 text-success' : g.discovery_status === 'rejected' ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn'}`}>{g.discovery_status}</span> : <span className="text-text-2">—</span>}</div>
            <div className="flex justify-end gap-1">
              {can(a, 'content_action') && g.state !== 'taken_down' && <Tool label={t('Take down')} onClick={() => setTakingDown(g)} testid="takedown-guild" danger><Ban size={16} /></Tool>}
              {can(a, 'content_action') && <Tool label={t('Delete server')} onClick={() => del(g)} testid="delete-guild" danger><Gavel size={16} /></Tool>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Take a server down under an open case: gone for members at once, the owner can't restore it, content kept for the case. */
function TakedownDialog({ guild, onClose, onDone }: { guild: AdminGuild; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [cases, setCases] = useState<{ id: string; justification: string }[]>([])
  const [caseId, setCaseId] = useState('')
  const [why, setWhy] = useState('')
  useEffect(() => { api.get<{ id: string; justification: string }[]>('/admin/cases?status=open').then(setCases).catch(() => {}) }, [])
  const go = async () => {
    try { await api.post(`/admin/guilds/${guild.id}/takedown`, { case_id: caseId, justification: why.trim() }); pushToast(t('{name} was taken down', { name: guild.name })); onDone() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 safe-pad" onClick={onClose} data-takedown-dialog>
      <div className="pop w-full max-w-md rounded-xl bg-bg-1 border border-line p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{t("Take down '{name}'", { name: guild.name })}</h3>
        <p className="text-sm text-text-2">{t('Members lose the server at once and are told it was removed for violating the community guidelines. The owner cannot restore it. Its content is kept for the case, then deleted.')}</p>
        <select className="input" value={caseId} onChange={(e) => setCaseId(e.target.value)} data-takedown-case>
          <option value="">{t('Choose an open case')}</option>
          {cases.map((c) => <option key={c.id} value={c.id}>{c.justification}</option>)}
        </select>
        <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('Reason (required)')} data-takedown-why />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost py-1.5" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn-danger py-1.5" disabled={!caseId || why.trim().length < MIN_WHY} onClick={go} data-takedown-go>{t('Take down')}</button></div>
      </div>
    </div>
  )
}

function SettingsPane() {
  const t = useT()
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
  const [trUrl, setTrUrl] = useState('')
  const [trKey, setTrKey] = useState('')
  const [llmUrl, setLlmUrl] = useState('')
  const [llmKey, setLlmKey] = useState('')
  const [llmModel, setLlmModel] = useState('')
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
  useEffect(() => { api.get<{ registration_enabled: boolean; announcement: string; require_email_verification?: boolean; livekit_url?: string; livekit_api_key?: string; livekit_api_secret?: string; stt_url?: string; stt_api_key?: string; stt_model?: string; translate_url?: string; translate_api_key?: string; llm_url?: string; llm_api_key?: string; llm_model?: string; rate_limits?: Record<string, string>; rate_limit_defaults?: Record<string, string>; av_addr?: string; av_fail_closed?: boolean; fcm_service_account?: string; fcm_endpoint?: string; push?: boolean; oauth_providers?: Record<string, { client_id: string; client_secret: string }>; oauth_endpoint_override?: string; max_upload_bytes?: number }>('/admin/settings').then((s) => { setMaxUploadMb(s.max_upload_bytes ? String(Math.round(s.max_upload_bytes / 1048576)) : ''); setOauth(s.oauth_providers && typeof s.oauth_providers === 'object' ? s.oauth_providers : {}); setOauthOverride(s.oauth_endpoint_override ?? ''); setAvAddr(s.av_addr ?? ''); setAvClosed(!!s.av_fail_closed); setFcm(s.fcm_service_account ?? ''); setFcmEndpoint(s.fcm_endpoint ?? ''); setReg(s.registration_enabled); setAnn(s.announcement); setReqVerify(!!s.require_email_verification); setLkUrl(s.livekit_url ?? ''); setLkKey(s.livekit_api_key ?? ''); setLkSecret(s.livekit_api_secret ?? ''); setSttUrl(s.stt_url ?? ''); setSttKey(s.stt_api_key ?? ''); setSttModel(s.stt_model ?? ''); setTrUrl(s.translate_url ?? ''); setTrKey(s.translate_api_key ?? ''); setLlmUrl(s.llm_url ?? ''); setLlmKey(s.llm_api_key ?? ''); setLlmModel(s.llm_model ?? ''); setRl(s.rate_limits ?? {}); setRlDefaults(s.rate_limit_defaults ?? {}) }).catch(() => {}) }, [])
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { const s = await api.put<{ registration_enabled: boolean; announcement: string; require_email_verification?: boolean; mail_enabled?: boolean; voice_mode?: 'mesh' | 'sfu'; livekit_url?: string; transcription?: boolean; translation?: boolean; summaries?: boolean }>('/admin/settings', { registration_enabled: reg, announcement: ann, require_email_verification: reqVerify, livekit_url: lkUrl, livekit_api_key: lkKey, livekit_api_secret: lkSecret, stt_url: sttUrl, stt_api_key: sttKey, stt_model: sttModel, translate_url: trUrl, translate_api_key: trKey, llm_url: llmUrl, llm_api_key: llmKey, llm_model: llmModel, rate_limits: rl, av_addr: avAddr, av_fail_closed: avClosed, fcm_service_account: fcm, fcm_endpoint: fcmEndpoint, oauth_providers: oauth, oauth_endpoint_override: oauthOverride, max_upload_bytes: maxUploadMb ? Math.round(Number(maxUploadMb) * 1048576) : 0 }); setInstance({ ...s, livekit_url: s.livekit_url }); pushToast(t('Instance settings saved')) } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className="max-w-xl space-y-6" data-admin-settings>
      <div><h1 className="text-2xl font-bold">{t('Instance Settings')}</h1><p className="text-sm text-text-2 mt-1">{t('Apply to every user of this Parley instance.')}</p></div>
      <label className="flex items-center justify-between rounded-xl border border-line bg-bg-1 p-4 cursor-pointer">
        <span><span className="block font-semibold">{t('Open registration')}</span><span className="block text-sm text-text-2">{t('When off, the register page is closed; existing accounts can still log in.')}</span></span>
        <input type="checkbox" checked={reg} onChange={(e) => setReg(e.target.checked)} className="h-5 w-5 accent-accent" data-admin-registration />
      </label>
      <label className="flex items-center justify-between rounded-xl border border-line bg-bg-1 p-4 cursor-pointer">
        <span><span className="block font-semibold">{t('Require a verified email')}</span><span className="block text-sm text-text-2">{t('Unverified accounts can chat but cannot create servers or use Discover until they confirm their address.')}{instance.mail_enabled === false ? ' ' + t('This server cannot send mail (MAIL_MODE=off), so leave this off.') : ''}</span></span>
        <input type="checkbox" checked={reqVerify} onChange={(e) => setReqVerify(e.target.checked)} className="h-5 w-5 accent-accent" data-admin-require-verify />
      </label>
      <div>
        <label className="label">{t('Announcement banner')}</label>
        <input className="input" value={ann} onChange={(e) => setAnn(e.target.value)} maxLength={300} placeholder={t('Shown at the top of the app for everyone; leave blank to hide')} data-admin-announcement />
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-voice>
        <div><span className="block font-semibold">{t('Voice: LiveKit SFU')}</span><span className="block text-sm text-text-2">{t('Leave empty for peer-to-peer calls (fine up to about six people). Enter a LiveKit server to route all voice, video and screen share through it; the server mints join tokens from the channel permissions.')}</span></div>
        <div><label className="label">{t('LiveKit URL (what browsers connect to)')}</label><input className="input" value={lkUrl} onChange={(e) => setLkUrl(e.target.value)} placeholder="wss://livekit.example.com or ws://localhost:7880" data-admin-livekit-url /></div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div><label className="label">{t('API key')}</label><input className="input" value={lkKey} onChange={(e) => setLkKey(e.target.value)} placeholder="devkey" autoComplete="off" data-admin-livekit-key /></div>
          <div><label className="label">{t('API secret')}</label><input className="input" type="password" value={lkSecret} onChange={(e) => setLkSecret(e.target.value)} placeholder="secret" autoComplete="new-password" data-admin-livekit-secret /></div>
        </div>
        <div className="text-xs text-text-2">{t('Current mode:')} <b data-admin-voice-mode>{instance.voice_mode === 'sfu' ? 'SFU' : t('peer-to-peer mesh')}</b></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-stt>
        <div><span className="block font-semibold">{t('Voice message transcription')}</span><span className="block text-sm text-text-2">{tn('Any OpenAI-compatible speech-to-text server ({endpoint}): the bundled Whisper container ({command}, URL {url}), or a hosted API with a key. Leave the URL empty to turn it off.', { endpoint: <code>POST /v1/audio/transcriptions</code>, command: <code>docker compose --profile stt up -d</code>, url: <code>http://stt:8000</code> })}</span></div>
        <div><label className="label">{t('Transcription server URL')}</label><input className="input" value={sttUrl} onChange={(e) => setSttUrl(e.target.value)} placeholder="http://stt:8000 or https://api.openai.com" data-admin-stt-url /></div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div><label className="label">{t('API key (optional)')}</label><input className="input" type="password" value={sttKey} onChange={(e) => setSttKey(e.target.value)} autoComplete="new-password" data-admin-stt-key /></div>
          <div><label className="label">{t('Model')}</label><input className="input" value={sttModel} onChange={(e) => setSttModel(e.target.value)} placeholder="Systran/faster-whisper-base.en or whisper-1" data-admin-stt-model /></div>
        </div>
        <div className="text-xs text-text-2">{t('Transcription:')} <b data-admin-stt-state>{instance.transcription ? t('on') : t('off')}</b></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-translate>
        <div><span className="block font-semibold">{t('Message translation')}</span><span className="block text-sm text-text-2">{tn('A LibreTranslate-compatible server ({endpoint}), self-hosted or a provider. Adds Translate to message menus; translations are cached per message.', { endpoint: <code>POST /translate</code> })}</span></div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div><label className="label">{t('Translation server URL')}</label><input className="input" value={trUrl} onChange={(e) => setTrUrl(e.target.value)} placeholder="http://libretranslate:5000" data-admin-translate-url /></div>
          <div><label className="label">{t('API key (optional)')}</label><input className="input" type="password" value={trKey} onChange={(e) => setTrKey(e.target.value)} autoComplete="new-password" data-admin-translate-key /></div>
        </div>
        <div className="text-xs text-text-2">{t('Translation:')} <b data-admin-translate-state>{instance.translation ? t('on') : t('off')}</b></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-llm>
        <div><span className="block font-semibold">{t('AI channel summaries')}</span><span className="block text-sm text-text-2">{tn('Any OpenAI-compatible chat server ({endpoint}): a local model or a provider. Members get a Summaries button in server text channels; the last 48 hours of that channel are sent to it when asked. Server owners can turn it off.', { endpoint: <code>POST /v1/chat/completions</code> })}</span></div>
        <div><label className="label">{t('Chat server URL')}</label><input className="input" value={llmUrl} onChange={(e) => setLlmUrl(e.target.value)} placeholder="http://ollama:11434 or https://api.openai.com" data-admin-llm-url /></div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div><label className="label">{t('API key (optional)')}</label><input className="input" type="password" value={llmKey} onChange={(e) => setLlmKey(e.target.value)} autoComplete="new-password" data-admin-llm-key /></div>
          <div><label className="label">{t('Model')}</label><input className="input" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="llama3.1 or gpt-4o-mini" data-admin-llm-model /></div>
        </div>
        <div className="text-xs text-text-2">{t('Summaries:')} <b data-admin-llm-state>{instance.summaries ? t('on') : t('off')}</b></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-push>
        <div><span className="block font-semibold">{t('Push notifications (iOS / Android apps)')}</span><span className="block text-sm text-text-2">{tn('Paste the Firebase {account} JSON (Project settings → Service accounts → Generate new private key). DMs and mentions are pushed to members who have no app or browser open. Leave empty to turn push off.', { account: <b>{t('service account')}</b> })}</span></div>
        <textarea className="input resize-y font-mono text-xs" rows={4} value={fcm} onChange={(e) => setFcm(e.target.value)} placeholder='{"type":"service_account","project_id":"…","client_email":"…","private_key":"-----BEGIN PRIVATE KEY-----…"}' autoComplete="off" data-admin-fcm />
        <div><label className="label">{t('FCM endpoint override (tests only)')}</label><input className="input" value={fcmEndpoint} onChange={(e) => setFcmEndpoint(e.target.value)} placeholder={t('leave empty for Google')} data-admin-fcm-endpoint /></div>
        <div className="text-xs text-text-2">{t('Push:')} <b data-admin-push-state>{fcm.trim() ? t('on') : t('off')}</b></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-oauth>
        <div><span className="block font-semibold">{t('Linked accounts (OAuth)')}</span><span className="block text-sm text-text-2">{tn('Let members connect GitHub, GitLab, Twitch, YouTube, Reddit and Spotify from Settings → Connections (Twitch and YouTube creators can also give their subscribers a server role). Register an OAuth app at each provider with the callback URL {url} and paste its keys.', { url: <code>{instance.app_url ?? ''}/api/connections/&lt;provider&gt;/callback</code> })}</span></div>
        {(['github', 'gitlab', 'twitch', 'youtube', 'reddit', 'spotify'] as const).map((p) => (
          <div key={p} className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <div><label className="label capitalize">{t('{provider} client ID', { provider: p })}</label><input className="input" value={oauth[p]?.client_id ?? ''} onChange={(e) => setOauth({ ...oauth, [p]: { client_id: e.target.value, client_secret: oauth[p]?.client_secret ?? '' } })} autoComplete="off" data-admin-oauth-id={p} /></div>
            <div><label className="label capitalize">{t('{provider} client secret', { provider: p })}</label><input className="input" type="password" value={oauth[p]?.client_secret ?? ''} onChange={(e) => setOauth({ ...oauth, [p]: { client_id: oauth[p]?.client_id ?? '', client_secret: e.target.value } })} autoComplete="off" data-admin-oauth-secret={p} /></div>
          </div>
        ))}
        <div><label className="label">{t('Provider endpoint override (tests only)')}</label><input className="input" value={oauthOverride} onChange={(e) => setOauthOverride(e.target.value)} placeholder={t('leave empty for the real providers')} data-admin-oauth-override /></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-uploads>
        <div><span className="block font-semibold">{t('Uploads')}</span><span className="block text-sm text-text-2">{t('The largest single file anyone may attach. Leave empty for 25 MB. Individual users can be given their own limit from the users table.')}</span></div>
        <div className="flex items-center gap-2"><input type="number" min={1} className="input w-32" placeholder="25" value={maxUploadMb} onChange={(e) => setMaxUploadMb(e.target.value)} data-admin-max-upload /><span className="text-sm text-text-2">{t('MB per file')}</span></div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-av>
        <div><span className="block font-semibold">{t('Antivirus (ClamAV)')}</span><span className="block text-sm text-text-2">{tn('Every upload (attachments, voice messages, profile images, emoji) is scanned by a ClamAV daemon before it is stored. {command} runs one; enter {address}. Leave empty to skip scanning.', { command: <code>docker compose --profile av up -d</code>, address: <code>clamav:3310</code> })}</span></div>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <div><label className="label">{t('clamd address (host:port)')}</label><input className="input" value={avAddr} onChange={(e) => setAvAddr(e.target.value)} placeholder="clamav:3310" data-admin-av-addr /></div>
          <label className="flex items-center justify-between rounded-xl border border-line bg-bg-0/40 p-3 cursor-pointer"><span><span className="block text-sm font-semibold">{t('Fail closed')}</span><span className="block text-xs text-text-2">{t('Refuse uploads while the scanner is unreachable (otherwise they pass with an error logged).')}</span></span><input type="checkbox" checked={avClosed} onChange={(e) => setAvClosed(e.target.checked)} className="h-5 w-5 accent-accent" data-admin-av-closed /></label>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-bg-1 p-4 space-y-3" data-admin-rate-limits>
        <div><span className="block font-semibold">{t('Rate limits')}</span><span className="block text-sm text-text-2">{tn("Requests allowed per window as {format}, e.g. {example}. Blank uses the server's RL_* environment value (shown as the placeholder). Applies immediately on this instance; other instances pick it up on restart.", { format: <code>count/seconds</code>, example: <code>10/5</code> })}</span></div>
        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          {([['register', t('Registrations (per IP)')], ['login', t('Logins (per IP)')], ['login_fail', t('Failed logins (per IP)')], ['oauth', t('AI assistant sign-ins and tokens (per IP)')], ['messages', t('Messages (per user)')], ['uploads', t('Uploads (per user)')], ['gifs', t('GIF searches (per user)')], ['search', t('Message searches (per user)')], ['mail', t('Emails sent (per user)')], ['webhooks', t('Webhook messages (per webhook)')]] as const).map(([k, label]) => (
            <div key={k}><label className="label">{label}</label><input className="input" value={rl[k] ?? ''} onChange={(e) => setRl({ ...rl, [k]: e.target.value })} placeholder={rlDefaults[k] ?? ''} data-admin-rl={k} /></div>
          ))}
        </div>
      </div>
      <button className="btn-primary" disabled={busy} data-admin-settings-save>{busy ? t('Saving…') : t('Save Settings')}</button>
    </form>
  )
}

function Tool({ children, label, onClick, danger, testid }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean; testid: string }) {
  return <button type="button" title={label} onClick={onClick} data-admin-action={testid} className={`h-8 w-8 rounded-md flex items-center justify-center hover:bg-bg-3 ${danger ? 'text-text-2 hover:text-danger' : 'text-text-2 hover:text-text-0'}`}>{children}</button>
}

interface AuditRow { id: string; actor_id: string; actor_name: string; actor_roles: string[]; action: string; target_kind: string; target_id: string | null; target_ids: string[]; target_name: string; details: Record<string, unknown>; query: string; justification: string; case_id: string | null; ip: string; user_agent: string; created_at: string }

const actionLabels = (): Record<string, string> => ({
  'user.promote': tr('made admin'), 'user.demote': tr('removed admin from'), 'user.suspend': tr('suspended'), 'user.unsuspend': tr('unsuspended'),
  'user.delete': tr('deleted account'), 'user.clear_mfa': tr('cleared 2FA for'), 'user.logout_all': tr('logged out all devices of'),
  'guild.delete': tr('deleted server'), 'settings.update': tr('changed instance settings'),
  'discovery.approved': tr('approved Discover listing'), 'discovery.rejected': tr('rejected Discover listing'), 'discovery.pending': tr('reset Discover listing'),
})

interface SentMail { id: string; to: string; subject: string; body: string; sent_at: string; status?: 'sent' | 'failed' | 'logged' | 'off'; error?: string | null }
const keepOptions = (): [number, string][] => [[7, tr('7 days')], [30, tr('30 days')], [90, tr('90 days')], [365, tr('1 year')], [0, tr('Until deleted')]]
const mailStatus = (): Record<string, { label: string; cls: string; hint: string }> => ({
  sent: { label: tr('Sent'), cls: 'bg-success/15 text-success', hint: tr('The mail server accepted it. Delivery to the inbox is tracked by your mail provider.') },
  failed: { label: tr('Failed'), cls: 'bg-danger/15 text-danger', hint: tr('The mail server refused it or the mail settings are wrong.') },
  logged: { label: tr('Logged'), cls: 'bg-bg-4 text-text-1', hint: tr('MAIL_MODE=log: written to the backend log instead of being sent.') },
  off: { label: tr('Not sent'), cls: 'bg-bg-4 text-text-2', hint: tr('MAIL_MODE=off: email is switched off.') },
})

/** Every email the server tried to send, newest first, with what happened to each; kept for the chosen period. */
function MailPane() {
  const t = useT()
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
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h) }, [to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get<{ retention_days: number }>('/admin/mail/settings').then((r) => setKeep(r.retention_days)).catch(() => {}) }, [])
  const saveKeep = async (days: number) => {
    try { await api.put('/admin/mail/settings', { retention_days: days }); setKeep(days); pushToast(days ? t('Emails are now kept for {period}', { period: keepOptions().find(([d]) => d === days)?.[1] ?? t('{n} days', { n: days }) }) : t('Emails are now kept until deleted')); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const remove = async (id: string) => {
    try { await api.delete(`/admin/mail/${id}`); setRows((r) => r?.filter((m) => m.id !== id) ?? r); setOpen(null) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const clearAll = async () => {
    try { const r = await api.delete<{ removed: number }>(`/admin/mail${filter ? `?${filter}` : ''}`); setConfirmClear(false); pushToast(r.removed === 1 ? t('Deleted 1 email') : t('Deleted {n} emails', { n: r.removed })); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const failed = rows?.filter((m) => m.status === 'failed').length ?? 0
  return (
    <div data-admin-mail>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{t('Mail')}</h1>
        <button type="button" onClick={load} disabled={busy} className="btn-ghost ml-auto py-1.5" data-admin-mail-refresh><RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> {t('Refresh')}</button>
      </div>
      <p className="text-sm text-text-2 mt-1 max-w-2xl">{t('Every email this server tried to send, newest first, kept through restarts until it expires or you delete it. Whether a sent email reached the inbox is tracked by your mail provider (for SendGrid, its Activity Feed).')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('Filter by recipient email')} type="email" className="input max-w-md" data-admin-mail-search />
        <label className="flex items-center gap-2 text-sm text-text-1">{t('Keep emails for')}
          <select className="input w-auto py-1.5" value={keep ?? ''} disabled={keep === null} onChange={(e) => saveKeep(Number(e.target.value))} data-admin-mail-keep>
            {keep !== null && !keepOptions().some(([d]) => d === keep) && <option value={keep}>{t('{n} days', { n: keep })}</option>}
            {keepOptions().map(([d, label]) => <option key={d} value={d}>{label}</option>)}
          </select>
        </label>
        {(rows?.length ?? 0) > 0 && (confirmClear ? (
          <span className="flex items-center gap-2 text-sm" data-admin-mail-clear-confirm>{filter ? t('Delete every email to {email}?', { email: to.trim() }) : t('Delete every logged email?')}
            <button type="button" className="btn-primary bg-danger hover:bg-danger/80 py-1" onClick={clearAll}>{t('Delete')}</button><button type="button" className="btn-ghost py-1" onClick={() => setConfirmClear(false)}>{t('Cancel')}</button></span>
        ) : (
          <button type="button" className="btn-ghost py-1.5 text-danger" onClick={() => setConfirmClear(true)} data-admin-mail-clear>{filter ? t('Delete these') : t('Delete all')}</button>
        ))}
      </div>
      {failed > 0 && <p className="mt-3 text-sm text-danger" data-admin-mail-failed>{t('{n} of these failed. Open one to see the error, and check SMTP_URL and MAIL_FROM.', { n: failed })}</p>}
      <div className="mt-4 rounded-xl border border-line bg-bg-1 overflow-hidden">
        {(rows?.length ?? 0) === 0 && <div className="px-3 py-6 text-sm text-text-2 text-center" data-admin-mail-empty>{rows === null || busy ? t('Loading…') : to.trim() ? t('No emails to that address yet.') : t('No emails logged.')}</div>}
        {rows?.map((m, i) => {
          const ms = mailStatus()
          const st = ms[m.status ?? 'logged'] ?? ms.logged
          return (
            <div key={m.id} className="border-t border-line first:border-t-0" data-admin-mail-row data-mail-status={m.status ?? 'logged'}>
              <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full grid grid-cols-[76px_170px_minmax(0,1fr)] max-md:grid-cols-[76px_minmax(0,1fr)] gap-x-4 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-bg-3">
                <span className={`self-start justify-self-start rounded px-1.5 py-0.5 text-[11px] font-bold ${st.cls}`} title={st.hint}>{st.label}</span>
                <span className="text-xs text-text-2 pt-0.5 max-md:hidden" title={m.sent_at}>{new Date(m.sent_at).toLocaleString()}</span>
                <span className="min-w-0"><span className="block truncate font-semibold">{m.subject}</span><span className="block truncate text-xs text-text-2">{t('to {email}', { email: m.to })}<span className="md:hidden"> · {new Date(m.sent_at).toLocaleString()}</span></span></span>
              </button>
              {open === i && (
                <div className="px-3 pb-3 text-sm" data-admin-mail-detail>
                  {m.error && <p className="mb-2 rounded-md bg-danger/10 px-3 py-2 text-danger break-words" data-admin-mail-error>{m.error}</p>}
                  <pre className="whitespace-pre-wrap break-words rounded-md bg-bg-0 px-3 py-2 font-sans text-text-1">{m.body}</pre>
                  <button type="button" className="btn-ghost mt-2 py-1 text-danger" onClick={() => remove(m.id)} data-admin-mail-delete>{t('Delete this email')}</button>
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
  const t = useT()
  const [q, setQ] = useState('')
  // Auditor filters: admin, case, target (ids) and a date range.
  const [f, setF] = useState({ actor_id: '', case_id: '', target_id: '', from: '', to: '' })
  const filterQs = () => Object.entries(f).filter(([, v]) => v.trim()).map(([k, v]) => `&${k}=${encodeURIComponent(k === 'from' || k === 'to' ? new Date(v).toISOString() : v.trim())}`).join('')
  const [rows, setRows] = useState<AuditRow[]>([])
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = async (before?: string) => {
    setBusy(true)
    try {
      const page = await api.get<AuditRow[]>(`/admin/audit?q=${encodeURIComponent(q)}${filterQs()}${before ? `&before=${before}` : ''}`)
      setRows((r) => before ? [...r, ...page] : page); setDone(page.length < 100)
    } catch { /* keep what we have */ } finally { setBusy(false) }
  }
  useEffect(() => { const h = setTimeout(() => load(), 200); return () => clearTimeout(h) }, [q, f]) // eslint-disable-line react-hooks/exhaustive-deps
  const detail = (r: AuditRow) => {
    const d = r.details ?? {}
    if (r.action === 'settings.update') return Object.entries(d).map(([k, v]) => `${k} → ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`).join(', ')
    if (typeof d.note === 'string' && d.note) return t('note: {note}', { note: d.note })
    if (typeof d.revoked === 'number') return d.revoked === 1 ? t('1 session') : t('{n} sessions', { n: d.revoked as number })
    return ''
  }
  return (
    <div data-admin-audit>
      <h1 className="text-2xl font-bold">{t('Audit Log')}</h1>
      <p className="text-sm text-text-2 mt-1">{t('Every action taken in this console, newest first: content access, reveals, cases, role changes and moderation. The log cannot be changed; deleted accounts show as their tombstone.')}</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Filter by admin, action or target')} data-admin-audit-search className="input mt-4 max-w-md" />
      <div className="mt-2 flex flex-wrap gap-2 items-center text-xs text-text-2" data-admin-audit-filters>
        <input className="input w-72 py-1 text-xs" value={f.actor_id} onChange={(e) => setF({ ...f, actor_id: e.target.value })} placeholder={t('Admin ID')} data-admin-audit-filter="actor_id" />
        <input className="input w-72 py-1 text-xs" value={f.case_id} onChange={(e) => setF({ ...f, case_id: e.target.value })} placeholder={t('Case ID')} data-admin-audit-filter="case_id" />
        <input className="input w-72 py-1 text-xs" value={f.target_id} onChange={(e) => setF({ ...f, target_id: e.target.value })} placeholder={t('Target ID')} data-admin-audit-filter="target_id" />
        <label className="flex items-center gap-1">{t('From')} <input type="date" className="input w-auto py-1 text-xs" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} data-admin-audit-filter="from" /></label>
        <label className="flex items-center gap-1">{t('to')} <input type="date" className="input w-auto py-1 text-xs" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} data-admin-audit-filter="to" /></label>
      </div>
      <div className="mt-4 rounded-xl border border-line bg-bg-1 overflow-hidden">
        {rows.length === 0 && <div className="px-3 py-6 text-sm text-text-2 text-center" data-admin-audit-empty>{busy ? t('Loading…') : t('Nothing logged yet.')}</div>}
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[170px_1fr] max-md:grid-cols-1 gap-x-4 gap-y-0.5 px-3 py-2 border-t border-line first:border-t-0 text-sm" data-admin-audit-row data-audit-action={r.action}>
            <div className="text-xs text-text-2 pt-0.5" title={r.created_at}>{new Date(r.created_at).toLocaleString()}</div>
            <div className="min-w-0">
              <span className="font-semibold">@{r.actor_name || t('unknown')}</span> <span className="text-text-1">{actionLabels()[r.action] ?? r.action}</span>
              {(r.target_name || (r.target_kind && r.target_id)) && <span className="font-semibold"> {r.target_kind === 'user' ? '@' : ''}{r.target_name || r.target_id}</span>}
              {detail(r) && <div className="text-xs text-text-2 truncate" data-audit-detail>{detail(r)}</div>}
              {(r.justification || r.query) && <div className="text-xs text-text-2 truncate" data-audit-why>{r.query && <>{t('searched “{q}”', { q: r.query })} · </>}{r.justification}</div>}
              <div className="text-[11px] text-text-2 flex flex-wrap gap-x-2">
                {r.actor_roles.length > 0 && <span data-audit-roles>{r.actor_roles.join(', ')}</span>}
                {r.case_id && <NavLink to={`/admin/cases/${r.case_id}`} className="text-sky-400 hover:underline" data-audit-case>{t('case')}</NavLink>}
                {r.target_ids.length > 1 && <span>{t('{n} items', { n: r.target_ids.length })}</span>}
                {r.ip && <span data-audit-ip>{r.ip}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {!done && rows.length > 0 && <button type="button" className="btn-ghost mt-3" disabled={busy} onClick={() => load(rows[rows.length - 1].id)} data-admin-audit-more>{t('Load more')}</button>}
    </div>
  )
}

interface Report { id: string; case_id?: string | null; reporter_id: string | null; reporter_username: string | null; kind: 'message' | 'user'; target_user_id: string | null; target_username: string; message_id: string | null; channel_id: string | null; channel_name: string; guild_id: string | null; guild_name: string; content: string; reason: string; status: 'open' | 'resolved' | 'dismissed'; note: string; created_at: string; resolved_at: string | null; message_exists: boolean; target_suspended: boolean }

function ReportsPane() {
  const t = useT()
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed' | 'all'>('open')
  const [rows, setRows] = useState<Report[] | null>(null)
  const pushToast = useStore((s) => s.pushToast)
  const load = async () => { try { setRows(await api.get<Report[]>(`/admin/reports?status=${status}`)) } catch (e) { pushToast((e as Error).message, 'error') } }
  useEffect(() => { setRows(null); load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); pushToast(done); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const setState = (r: Report, s: 'resolved' | 'dismissed' | 'open', extra: Record<string, string> = {}) => act(() => api.patch(`/admin/reports/${r.id}`, { status: s, ...extra }), s === 'open' ? t('Report reopened') : s === 'resolved' ? t('Report resolved') : t('Report dismissed'))
  // Resolving or dismissing asks what to tell the people involved (official notices from the system account).
  const [deciding, setDeciding] = useState<{ r: Report; status: 'resolved' | 'dismissed' } | null>(null)
  const statusLabel = { open: t('open'), resolved: t('resolved'), dismissed: t('dismissed'), all: t('all') }
  return (
    <div data-admin-reports>
      <h1 className="text-2xl font-bold">{t('Reports')}</h1>
      <p className="text-sm text-text-2 mt-1">{t('Messages and users reported by members. Resolve once handled, dismiss if nothing is wrong.')}</p>
      <div className="mt-4 flex gap-1.5" data-admin-report-filters>
        {(['open', 'resolved', 'dismissed', 'all'] as const).map((s) => <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${status === s ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-admin-report-filter={s}>{statusLabel[s]}</button>)}
      </div>
      {deciding && <ReportDecision report={deciding.r} status={deciding.status} onCancel={() => setDeciding(null)} onDone={(extra) => { setState(deciding.r, deciding.status, extra); setDeciding(null) }} />}
      <div className="mt-4 space-y-3">
        {rows === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
        {rows?.length === 0 && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2" data-admin-reports-empty>{status === 'all' ? t('No reports.') : t('No {status} reports.', { status: statusLabel[status] })}</div>}
        {rows?.map((r) => (
          <div key={r.id} className="rounded-xl border border-line bg-bg-1 p-4" data-admin-report={r.id} data-report-status={r.status} data-report-kind={r.kind}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${r.status === 'open' ? 'bg-warn/20 text-warn' : r.status === 'resolved' ? 'bg-success/20 text-success' : 'bg-bg-3 text-text-2'}`}>{statusLabel[r.status]}</span>
              <span className="font-semibold">{r.kind === 'message' ? t('Message report') : t('User report')}</span>
              <span className="text-text-2">· {tn('@{reporter} reported {target}', { reporter: r.reporter_username ?? t('deleted user'), target: <b className="text-text-0">@{r.target_username || t('unknown')}</b> })}{r.target_suspended && <span className="ml-1 rounded bg-danger/20 text-danger px-1 text-[10px] font-bold">{t('SUSPENDED')}</span>}</span>
              <span className="ml-auto text-xs text-text-2">{new Date(r.created_at).toLocaleString()}</span>
            </div>
            <div className="mt-2 text-sm"><span className="text-text-2">{t('Reason:')} </span><span data-report-reason>{r.reason}</span></div>
            {r.kind === 'message' && (
              <div className="mt-2 rounded-lg bg-bg-0/60 border border-line p-3 text-sm" data-report-context>
                <div className="text-xs text-text-2 mb-1">{r.guild_id ? `${r.guild_name} · #${r.channel_name}` : t('Direct message')}{!r.message_exists && <span className="ml-2 rounded bg-bg-3 px-1 text-[10px] font-bold">{t('DELETED')}</span>}</div>
                <div className="whitespace-pre-wrap break-words">{r.content || <i className="text-text-2">{t('(no text)')}</i>}</div>
              </div>
            )}
            {r.note && <div className="mt-2 text-xs text-text-2">{t('Note:')} {r.note}</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {r.kind === 'message' && r.message_exists && <button type="button" className="btn-danger py-1 text-xs" onClick={() => act(() => api.delete(`/admin/messages/${r.message_id}`), t('Message deleted'))} data-report-delete-message>{t('Delete message')}</button>}
              {r.target_user_id && !r.target_suspended && <button type="button" className="btn-danger py-1 text-xs" onClick={() => act(() => api.patch(`/admin/users/${r.target_user_id}`, { suspended: true }), t('@{username} suspended', { username: r.target_username }))} data-report-suspend>{t('Suspend @{username}', { username: r.target_username })}</button>}
              {r.case_id && <NavLink to={`/admin/cases/${r.case_id}`} className="btn-ghost py-1 text-xs" data-report-case>{t('Case')}</NavLink>}
              {r.guild_id && r.channel_id && <a className="btn-ghost py-1 text-xs" href={`/channels/${r.guild_id}/${r.channel_id}?message=${r.message_id}`} target="_blank" rel="noreferrer">{t('Open channel')}</a>}
              {r.status === 'open' ? (
                <>
                  <button type="button" className="btn-primary py-1 text-xs" onClick={() => setDeciding({ r, status: 'resolved' })} data-report-resolve>{t('Resolve')}</button>
                  <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setDeciding({ r, status: 'dismissed' })} data-report-dismiss>{t('Dismiss')}</button>
                </>
              ) : <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setState(r, 'open')} data-report-reopen>{t('Reopen')}</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const MIN_WHY = 10

/** Admin › Search: public Discover servers only. T&S leads search freely; moderators and legal under an open case. */
function MessagesPane() {
  const t = useT()
  const a = useAccess()
  const unbound = !!a?.roles.includes('TS_LEAD')
  const [q, setQ] = useState('')
  const [why, setWhy] = useState('')
  const [caseId, setCaseId] = useState('')
  const [cases, setCases] = useState<{ id: string; kind: string; justification: string }[]>([])
  const [rows, setRows] = useState<MetaHit[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.get<{ id: string; kind: string; justification: string }[]>('/admin/cases?status=open').then(setCases).catch(() => {}) }, [])
  const ready = why.trim().length >= MIN_WHY && (unbound || !!caseId)
  const params = () => `justification=${encodeURIComponent(why.trim())}${caseId ? `&case_id=${caseId}` : ''}`
  const load = async () => {
    setErr(null)
    if (!q.trim() || !ready) { setRows(null); return }
    try { setRows(await api.get<MetaHit[]>(`/admin/search/public?q=${encodeURIComponent(q.trim())}&${params()}`)) } catch (e) { setErr((e as Error).message); setRows([]) }
  }
  useEffect(() => { const h = setTimeout(load, 400); return () => clearTimeout(h) }, [q, why, caseId]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = (h: MetaHit) => () => api.post<OpenedMsg>(`/admin/search/public/${h.id}/open`, { justification: why.trim(), case_id: caseId || null })
  return (
    <div data-admin-messages>
      <h1 className="text-2xl font-bold">{t('Search')}</h1>
      <p className="text-sm text-text-2 mt-1">{t('Searches public channels of servers listed in Discover. Results show who, where and when; opening a message is logged separately. DMs, group chats and private channels are only reachable through a case.')}</p>
      <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-text-1 max-w-xl" data-admin-access-notice>{t('Every search and every message you open is logged with your reason.')}</div>
      <label className="label mt-4 block">{t('Reason (required)')}</label>
      <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('e.g. report #123: checking for more spam from this account')} maxLength={1000} data-admin-msg-why className="input max-w-xl" />
      <label className="label mt-3 block">{unbound ? t('Case (optional)') : t('Case (required)')}</label>
      <select className="input max-w-xl" value={caseId} onChange={(e) => setCaseId(e.target.value)} data-admin-msg-case>
        <option value="">{unbound ? t('No case') : t('Choose an open case')}</option>
        {cases.map((c) => <option key={c.id} value={c.id}>{c.justification}</option>)}
      </select>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ready ? t('Search message text') : t('Give a reason first')} disabled={!ready} data-admin-msg-search className="input mt-3 max-w-md" />
      {err && <p className="mt-2 text-sm text-danger" data-admin-msg-error>{err}</p>}
      <div className="mt-4 rounded-xl border border-line bg-bg-1 overflow-hidden">
        {rows === null && <p className="p-4 text-sm text-text-2">{t('Type to search.')}</p>}
        {rows?.length === 0 && <p className="p-4 text-sm text-text-2" data-admin-msg-empty>{t('No messages match.')}</p>}
        {rows?.map((h) => <MetaRow key={h.id} h={h} open={open(h)} onDeleted={load} />)}
      </div>
    </div>
  )
}

interface UserContent { user: { id: string; username: string; display_name: string }; quota: number | null; quota_override: number | null; uploads: { id: string; filename: string; content_type: string; size: number; message_id: string | null; created_at: string }[]; images: { id: string; kind: string; size: number; created_at: string }[]; totals: { messages: number; attachments: number; attachment_bytes: number; images: number; image_bytes: number } }

interface AdminSession { id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string }

/** One account's storage and devices, as metadata: names, sizes, dates. Message content needs a case. */
function UserContentPane() {
  const t = useT()
  const a = useAccess()
  const { id } = useParams()
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const [data, setData] = useState<UserContent | null>(null)
  const [tab, setTab] = useState<'uploads' | 'sessions'>('uploads')
  const [sessions, setSessions] = useState<AdminSession[] | null>(null)
  const loadSessions = async () => { try { setSessions(await api.get<AdminSession[]>(`/admin/users/${id}/sessions`)) } catch { setSessions([]) } }
  const load = async () => { try { setData(await api.get<UserContent>(`/admin/users/${id}/content`)); loadSessions() } catch (e) { pushToast((e as Error).message, 'error') } }
  useEffect(() => { setData(null); load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = useNavigate()
  const logoutOne = async (sid: string) => { try { await api.delete(`/admin/users/${id}/sessions/${sid}`); pushToast(t('Device logged out')); loadSessions() } catch (e) { pushToast((e as Error).message, 'error') } }
  const logoutAll = async () => { try { const r = await api.delete<{ revoked: number }>(`/admin/users/${id}/sessions`); pushToast(r.revoked === 1 ? t('Logged out of 1 device') : t('Logged out of {n} devices', { n: r.revoked })); loadSessions() } catch (e) { pushToast((e as Error).message, 'error') } }
  if (!data) return <p className="text-sm text-text-2">{t('Loading…')}</p>
  const { user, totals } = data
  const used = totals.attachment_bytes + totals.image_bytes
  const act = can(a, 'content_action')
  const setQuota = async (mb: string) => {
    const v = mb.trim() === '' ? null : Math.round(Number(mb) * 1024 * 1024)
    if (v !== null && (!Number.isFinite(v) || v < 0)) { pushToast(t('Enter a size in MB (0 = unlimited)'), 'error'); return }
    try { await api.patch(`/admin/users/${user.id}`, { upload_quota_bytes: v }); pushToast(v === null ? t('Quota reset to the default') : v === 0 ? t('Quota removed') : t('Quota set to {size}', { size: formatBytes(v) })); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const purgeMessages = () => openModal({ kind: 'confirm', title: t('Delete all messages by @{username}', { username: user.username }), body: t('This deletes all {n} messages {name} has ever sent, everywhere. This cannot be undone.', { n: totals.messages.toLocaleString(), name: user.display_name }), danger: true, confirmLabel: t('Delete All Messages'),
    action: async () => { try { const r = await api.delete<{ deleted: number }>(`/admin/users/${user.id}/messages`); pushToast(t('{n} messages deleted', { n: r.deleted })); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  const purgeUploads = () => openModal({ kind: 'confirm', title: t('Purge uploads by @{username}', { username: user.username }), body: t('Removes all {n} attachments ({size}) and their profile images. Their messages stay, without the files. This cannot be undone.', { n: totals.attachments, size: formatBytes(totals.attachment_bytes) }), danger: true, confirmLabel: t('Purge Uploads'),
    action: async () => { try { const r = await api.delete<{ attachments: number; images: number }>(`/admin/users/${user.id}/uploads`); pushToast(t('{attachments} attachments and {images} images removed', { attachments: r.attachments, images: r.images })); load() } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <div data-admin-user-content={user.id}>
      <NavLink to="/admin/users" className="text-xs text-sky-400 hover:underline">{t('← Users')}</NavLink>
      <h1 className="text-2xl font-bold mt-1">{user.display_name} <span className="text-base font-normal text-text-2">@{user.username}</span></h1>
      <p className="text-sm text-text-2 mt-1" data-admin-content-totals>{t('{messages} messages · {attachments} attachments ({attachmentSize}) · {images} profile/expression images ({imageSize})', { messages: totals.messages.toLocaleString(), attachments: totals.attachments, attachmentSize: formatBytes(totals.attachment_bytes), images: totals.images, imageSize: formatBytes(totals.image_bytes) })}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-admin-quota-row>
        <span className="text-text-2">{tn('Storage: {used} of {total}', { used: <b className="text-text-0" data-admin-quota-used>{formatBytes(used)}</b>, total: <b className="text-text-0" data-admin-quota-value>{data.quota === null ? t('unlimited') : formatBytes(data.quota)}</b> })}{data.quota_override !== null && <span className="ml-1 rounded bg-warn/20 text-warn px-1 text-[10px] font-bold">{t('CUSTOM')}</span>}</span>
        {can(a, 'instance_manage') && <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); setQuota((e.currentTarget.elements.namedItem('mb') as HTMLInputElement).value) }}>
          <input name="mb" className="input w-28 py-1 text-xs" placeholder="MB" inputMode="decimal" data-admin-quota-input />
          <button className="btn-ghost py-1 text-xs" data-admin-quota-save>{t('Set quota')}</button>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setQuota('')} data-admin-quota-reset>{t('Default')}</button>
        </form>}
      </div>
      {act && <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-danger py-1 text-xs" onClick={purgeMessages} disabled={totals.messages === 0} data-admin-purge-messages>{t('Delete all messages')}</button>
        <button type="button" className="btn-danger py-1 text-xs" onClick={purgeUploads} disabled={totals.attachments === 0 && totals.images === 0} data-admin-purge-uploads>{t('Purge uploads')}</button>
      </div>}
      <div className="mt-5 flex gap-1.5">
        {(['uploads', 'sessions'] as const).map((k) => <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${tab === k ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-admin-content-tab={k}>{{ uploads: t('uploads'), sessions: t('sessions') }[k]}</button>)}
      </div>
      {tab === 'sessions' ? (
        <div className="mt-3 rounded-xl border border-line bg-bg-1 overflow-hidden" data-admin-sessions>
          <div className="flex items-center justify-between px-3 py-2 border-b border-line text-xs text-text-2">
            <span>{sessions ? (sessions.length === 1 ? t('1 active device (last 30 days)') : t('{n} active devices (last 30 days)', { n: sessions.length })) : t('Loading…')}</span>
            {!!sessions?.length && act && <button type="button" className="btn-danger py-1 text-xs" onClick={logoutAll} data-admin-logout-all>{t('Log out all')}</button>}
          </div>
          {sessions?.length === 0 && <p className="p-4 text-sm text-text-2">{t('No active sessions.')}</p>}
          {sessions?.map((sn) => (
            <div key={sn.id} className="px-3 py-2 border-t border-line first:border-t-0 text-sm flex items-center gap-3" data-admin-session={sn.id}>
              <div className="min-w-0 flex-1">
                <div className="truncate" title={sn.user_agent}>{sn.user_agent || t('Unknown client')}</div>
                <div className="text-xs text-text-2">
                  <button type="button" className="text-sky-400 hover:underline" title={t('Users seen from this IP')} onClick={() => navigate(`/admin/users?ip=${encodeURIComponent(sn.ip)}`)} data-admin-session-ip>{sn.ip}</button>
                  {' · '}{t('signed in {date}', { date: new Date(sn.created_at).toLocaleString() })} · {t('last seen {date}', { date: new Date(sn.last_seen_at).toLocaleString() })}
                </div>
              </div>
              {act && <button type="button" className="btn-ghost py-1 text-xs text-danger" onClick={() => logoutOne(sn.id)} data-admin-session-logout>{t('Log out')}</button>}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-line bg-bg-1 overflow-hidden" data-admin-content-uploads>
          {data.uploads.length === 0 && data.images.length === 0 && <p className="p-4 text-sm text-text-2">{t('No uploads.')}</p>}
          {data.uploads.map((u) => (
            <div key={u.id} className="px-3 py-2 border-t border-line first:border-t-0 text-sm flex items-center gap-3" data-admin-upload={u.id}>
              <span className="truncate">{u.filename}</span>
              <span className="text-xs text-text-2">{u.content_type} · {formatBytes(u.size)} · {new Date(u.created_at).toLocaleString()}</span>
            </div>
          ))}
          {data.images.map((i) => (
            <div key={i.id} className="px-3 py-2 border-t border-line text-sm flex items-center gap-3" data-admin-image={i.id}>
              <span className="capitalize">{i.kind}</span>
              <span className="text-xs text-text-2">{formatBytes(i.size)} · {new Date(i.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Resolving or dismissing a report: an internal note, and the official notices to send (from this server's system
 * account) to the person who reported it and to the reported user. Each starts from a template that can be edited or
 * left off.
 */
function ReportDecision({ report: r, status, onCancel, onDone }: { report: Report; status: 'resolved' | 'dismissed'; onCancel: () => void; onDone: (extra: Record<string, string>) => void }) {
  const t = useT()
  const what = r.kind === 'message' ? t('message') : t('account')
  const templates = {
    reporter: status === 'resolved'
      ? t('Thanks for your report about @{name}. We reviewed it and took action. Reports like yours help keep this community safe.', { name: r.target_username })
      : t("Thanks for your report about @{name}. We reviewed it and didn't find a breach of our community guidelines this time. We appreciate you looking out for others.", { name: r.target_username }),
    target: status === 'resolved'
      ? t('We reviewed a report about your {what} and found that it breaks our community guidelines. Please make sure what you post follows them; further breaches may lead to your account being suspended.', { what })
      : t('We reviewed a report about your {what} and found no breach of our community guidelines. No action has been taken.', { what }),
  }
  const [note, setNote] = useState(r.note ?? '')
  const [toReporter, setToReporter] = useState(!!r.reporter_id)
  const [toTarget, setToTarget] = useState(status === 'resolved' && !!r.target_user_id)
  const [reporterText, setReporterText] = useState(templates.reporter)
  const [targetText, setTargetText] = useState(templates.target)
  const box = 'input min-h-[84px] text-sm'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 safe-pad" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }} data-report-decision={status}>
      <div className="pop w-full max-w-lg max-h-full overflow-y-auto rounded-xl bg-bg-1 border border-line p-5 space-y-4 shadow-2xl" role="dialog" aria-modal>
        <h3 className="text-lg font-bold">{status === 'resolved' ? t('Resolve report') : t('Dismiss report')}</h3>
        <div>
          <label className="label">{t('Internal note (only admins see it)')}</label>
          <input className="input text-sm" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-report-note />
        </div>
        <p className="text-xs text-text-2">{t('Notices arrive as a direct message from this server\'s official account. People can read them but not reply.')}</p>
        {r.reporter_id && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-4 w-4 accent-accent" checked={toReporter} onChange={(e) => setToReporter(e.target.checked)} data-notify-reporter />{t('Tell @{name}, who reported it', { name: r.reporter_username ?? '?' })}</label>
            {toReporter && <textarea className={box} value={reporterText} onChange={(e) => setReporterText(e.target.value)} maxLength={2000} data-notify-reporter-text />}
          </div>
        )}
        {r.target_user_id && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-4 w-4 accent-accent" checked={toTarget} onChange={(e) => setToTarget(e.target.checked)} data-notify-target />{t('Tell @{name}, who was reported', { name: r.target_username })}</label>
            {toTarget && <textarea className={box} value={targetText} onChange={(e) => setTargetText(e.target.value)} maxLength={2000} data-notify-target-text />}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button>
          <button type="button" className="btn-primary" onClick={() => onDone({ note, ...(toReporter && reporterText.trim() ? { message_reporter: reporterText } : {}), ...(toTarget && targetText.trim() ? { message_target: targetText } : {}) })} data-report-decision-confirm>
            {status === 'resolved' ? t('Resolve') : t('Dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}

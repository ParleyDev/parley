import { Crown, Gavel, Search, Shield, UserMinus } from 'lucide-react'
import { anchorOf } from '../../../lib/anchor'
import { useEffect, useState } from 'react'
import { myGuildPerms, useStore } from '../../../store'
import { api } from '../../../lib/api'
import { has, highestPosition, P, EMPTY_ROLES } from '../../../lib/perms'
import StyledName from '../../StyledName'
import Avatar from '../../Avatar'
import RolePicker from '../../RolePicker'
import ModViewModal from '../ModView'
import ConfirmModal from '../Confirm'
import { t, useT } from '../../../lib/i18n'

export default function MembersTab({ guildId }: { guildId: string }) {
  useT() // re-render when the language changes
  const guild = useStore((s) => s.guilds[guildId])
  const members = useStore((s) => s.members[guildId])
  const loaded = useStore((s) => !!s.membersLoaded[guildId])
  const loadMembers = useStore((s) => s.loadMembers)
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const me = useStore((s) => s.user)
  const myPerms = useStore((s) => myGuildPerms(s, guildId))
  const openModal = useStore((s) => s.openModal)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'name' | 'joined_new' | 'joined_old' | 'account_new'>('name')
  const [roleFilter, setRoleFilter] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const pushToast = useStore((s) => s.pushToast)
  // Opened over Settings (not via openModal, which would replace it).
  const [modView, setModView] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; confirmLabel?: string; action: () => Promise<void> } | null>(null)
  useEffect(() => { if (!loaded) loadMembers(guildId) }, [guildId, loaded, loadMembers])
  // How each member joined (Manage Server only; others just don't get it).
  const [joins, setJoins] = useState<Record<string, JoinInfo>>({})
  useEffect(() => { api.get<JoinInfo[]>(`/guilds/${guildId}/member-joins`).then((rows) => setJoins(Object.fromEntries(rows.map((r) => [r.user_id, r])))).catch(() => {}) }, [guildId])
  if (!guild || !me) return null
  const myMember = members?.[me.id]
  const ctx = { guild, roles, member: myMember }
  const time = (iso?: string) => (iso ? new Date(iso).getTime() : 0)
  const list = Object.values(members ?? {})
    .filter((m) => !q || m.display_name.toLowerCase().includes(q.toLowerCase()) || m.username.toLowerCase().includes(q.toLowerCase()) || (m.nickname ?? '').toLowerCase().includes(q.toLowerCase()))
    .filter((m) => !roleFilter || (roleFilter === '__none' ? !m.roles?.length : m.roles?.includes(roleFilter)))
    .sort((a, b) => sort === 'joined_new' ? time(b.joined_at) - time(a.joined_at) : sort === 'joined_old' ? time(a.joined_at) - time(b.joined_at)
      : sort === 'account_new' ? time(joins[b.user_id]?.account_created_at) - time(joins[a.user_id]?.account_created_at)
      : (a.nickname ?? a.display_name).localeCompare(b.nickname ?? b.display_name))
  const isMod = has(myPerms, P.KICK_MEMBERS) || has(myPerms, P.BAN_MEMBERS) || has(myPerms, P.MODERATE_MEMBERS)
  const outranksOf = (uid: string) => { const m = members?.[uid]; return !!m && uid !== me.id && guild.owner_id !== uid && (guild.owner_id === me.id || highestPosition(ctx, me.id) > highestPosition({ ...ctx, member: m }, uid)) }
  const togglePick = (uid: string) => setPicked((p) => { const n = new Set(p); if (n.has(uid)) n.delete(uid); else n.add(uid); return n })
  const bulkBan = () => setConfirm({ title: picked.size === 1 ? t('Ban 1 member') : t('Ban {n} members', { n: picked.size }), body: t('They are removed and cannot rejoin until unbanned. Their messages stay.'), danger: true, confirmLabel: t('Ban'),
    action: async () => {
      setBulkBusy(true)
      try { const r = await api.post<{ banned: string[]; failed: { user_id: string; error: string }[] }>(`/guilds/${guildId}/bulk-ban`, { user_ids: [...picked] }); pushToast(`${t('Banned {n}', { n: r.banned.length })}${r.failed.length ? `, ${t('{n} could not be banned', { n: r.failed.length })}` : ''}`, r.failed.length ? 'error' : undefined); setPicked(new Set()) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBulkBusy(false) }
    } })
  const bulkKick = () => setConfirm({ title: picked.size === 1 ? t('Kick 1 member') : t('Kick {n} members', { n: picked.size }), body: t('They can rejoin with an invite.'), danger: true, confirmLabel: t('Kick'),
    action: async () => {
      setBulkBusy(true)
      let n = 0
      for (const uid of picked) { try { await api.delete(`/guilds/${guildId}/members/${uid}`); n++ } catch { /* reported below */ } }
      setBulkBusy(false); pushToast(t('Kicked {n} of {total}', { n, total: picked.size })); setPicked(new Set())
    } })

  const kick = (userId: string) => openModal({ kind: 'kick', guildId, userId })

  return (
    <div>
      {modView && <ModViewModal guildId={guildId} userId={modView} onClose={() => setModView(null)} />}
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      <h1 className="text-xl font-bold">{t('Members')}</h1>
      <p className="text-sm text-text-2 mt-1">{list.length === 1 ? t('1 member') : t('{n} members', { n: list.length })}</p>
      <div className="mt-4 mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <input className="input pl-9" placeholder={t('Search members')} value={q} onChange={(e) => setQ(e.target.value)} />
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
        </div>
        <select className="input w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label={t('Filter by role')} data-members-role-filter>
          <option value="">{t('All roles')}</option>
          <option value="__none">{t('No roles')}</option>
          {Object.values(roles).filter((r) => r.name !== '@everyone').sort((a, b) => b.position - a.position).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label={t('Sort')} data-members-sort>
          <option value="name">{t('Name')}</option>
          <option value="joined_new">{t('Newest members')}</option>
          <option value="joined_old">{t('Oldest members')}</option>
          <option value="account_new">{t('Newest accounts')}</option>
        </select>
      </div>
      {picked.size > 0 && (
        <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 rounded-lg border border-line bg-bg-0 px-3 py-2 text-sm" data-members-bulk>
          <span className="flex-1">{t('{n} selected', { n: picked.size })}</span>
          <button type="button" className="btn-ghost py-1" onClick={() => setPicked(new Set())}>{t('Clear')}</button>
          {has(myPerms, P.KICK_MEMBERS) && <button type="button" className="btn-ghost py-1 text-danger" disabled={bulkBusy} onClick={bulkKick} data-members-bulk-kick>{t('Kick')}</button>}
          {has(myPerms, P.BAN_MEMBERS) && <button type="button" className="btn-danger py-1" disabled={bulkBusy} onClick={bulkBan} data-members-bulk-ban>{t('Ban')}</button>}
        </div>
      )}
      <div className="divide-y divide-line">
        {list.map((m) => {
          const isOwner = guild.owner_id === m.user_id
          const outranks = m.user_id !== me.id && !isOwner && (guild.owner_id === me.id || highestPosition(ctx, me.id) > highestPosition({ ...ctx, member: m }, m.user_id))
          const canKick = has(myPerms, P.KICK_MEMBERS) && outranks
          const canBan = has(myPerms, P.BAN_MEMBERS) && outranks
          const canTransfer = guild.owner_id === me.id && m.user_id !== me.id
          return (
            <div key={m.user_id} className="py-3 flex items-center gap-3" data-members-row={m.user_id}>
              {isMod && <input type="checkbox" className="h-4 w-4 accent-accent" disabled={!outranksOf(m.user_id)} checked={picked.has(m.user_id)} onChange={() => togglePick(m.user_id)} aria-label={t('Select {name}', { name: m.nickname ?? m.display_name })} data-members-pick={m.user_id} />}
              <button onClick={(e) => openModal({ kind: 'profile', userId: m.user_id, anchor: anchorOf(e) })}><Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }} size={36} presence /></button>
              <div className="min-w-0 w-48 phone:w-32 shrink-0">
                <div className="font-semibold truncate flex items-center gap-1"><StyledName userId={m.user_id} guildId={guildId}>{m.nickname ?? m.display_name}</StyledName>{isOwner && <Crown size={13} className="text-warn shrink-0" />}</div>
                <div className="text-xs text-text-2 truncate">@{m.username}</div>
                {joins[m.user_id] && <div className="text-[11px] text-text-2 truncate" title={t('How they joined')} data-member-joined-via={m.user_id}>{joinLabel(joins[m.user_id])}</div>}
                {joins[m.user_id] && <div className="text-[11px] text-text-2 truncate" data-member-ages={m.user_id}>{t('Joined {joined} · account {account}', { joined: shortDate(m.joined_at), account: shortDate(joins[m.user_id].account_created_at) })}{joins[m.user_id].warnings ? <span className="ml-1 text-warn">· {joins[m.user_id].warnings === 1 ? t('1 warning') : t('{n} warnings', { n: joins[m.user_id].warnings ?? 0 })}</span> : null}</div>}
              </div>
              <div className="flex-1 min-w-0"><RolePicker guildId={guildId} member={m} compact /></div>
              {isMod && outranksOf(m.user_id) && <button onClick={() => setModView(m.user_id)} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" title={t('Moderator view')} data-members-modview={m.user_id}><Shield size={16} /></button>}
              {canTransfer && <button onClick={() => openModal({ kind: 'transferOwnership', guildId, userId: m.user_id })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-warn" title={t('Transfer ownership')}><Crown size={16} /></button>}
              {canKick && <button onClick={() => kick(m.user_id)} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-danger/10 hover:text-danger" title={t('Kick')}><UserMinus size={16} /></button>}
              {canBan && <button onClick={() => openModal({ kind: 'ban', guildId, userId: m.user_id })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-danger/10 hover:text-danger" title={t('Ban')}><Gavel size={16} /></button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface JoinInfo { user_id: string; joined_via: string | null; inviter_id: string | null; inviter_name: string | null; temporary: boolean; account_created_at?: string; warnings?: number }
const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '?')
/** "Invite abc123 from Alice", "Discover", plus "temporary". */
function joinLabel(j: JoinInfo): string {
  const via = j.joined_via === 'discover' ? t('Joined from Discover') : j.joined_via ? (j.inviter_name ? t('Invite {code} from {name}', { code: j.joined_via, name: j.inviter_name }) : t('Invite {code}', { code: j.joined_via })) : ''
  return [via, j.temporary ? t('temporary') : ''].filter(Boolean).join(' · ')
}

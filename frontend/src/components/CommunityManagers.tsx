import { Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { anchorOf } from '../lib/anchor'
import { useT } from '../lib/i18n'
import { canManageRole, EMPTY_ROLES } from '../lib/perms'
import type { Community, CommunityManagers as Managers } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'

const MAX_OPTIONS = 8

/**
 * Who looks after a community. Everyone sees the list; a member the server says may change it (`can_manage_managers`)
 * also gets Add (a picker over the server's members and roles) and Remove. The server decides every change: when it
 * refuses (a role above the caller's, a missing permission) its message is shown and the list stays as it was.
 */
export default function CommunityManagers({ community, guildId, managers, onChanged }: { community: Community; guildId: string; managers: Managers | null; onChanged: () => void }) {
  const t = useT()
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const editable = community.can_manage_managers
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(false)
  const base = `/guilds/${guildId}/communities/${community.slug}/managers`

  const change = async (target: string, kind: 'member' | 'role' | null) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(target)
    try {
      if (kind) await api.put(`${base}/${target}`, { kind }); else await api.delete(`${base}/${target}`)
      onChanged()
      if (kind) setPicking(false)
    } catch (e) { pushToast((e as Error).message, 'error') }
    inFlight.current = false; setBusy(null)
  }

  const none = !managers || (!managers.members.length && !managers.roles.length)
  if (none && !editable) return null
  return (
    <section data-community-managers>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Looked after by')}</h2>
        {editable && <button type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking} className="flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" data-manager-add><Plus size={12} aria-hidden />{t('Add')}</button>}
      </div>
      {picking && editable && <Picker guildId={guildId} managers={managers} busy={busy !== null} onPick={(id, kind) => void change(id, kind)} onClose={() => setPicking(false)} />}
      <ul className="flex flex-col gap-1">
        {managers?.members.map((m) => (
          <li key={m.id} className="flex items-center gap-1">
            <button type="button" data-motion-row onClick={(e) => openModal({ kind: 'profile', userId: m.id, anchor: anchorOf(e) })} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-bg-3" data-community-manager={m.id}>
              <Avatar user={m} size={24} />
              <span className="min-w-0 truncate text-sm font-medium">{m.display_name}</span>
            </button>
            {editable && <RemoveButton name={m.display_name} id={m.id} disabled={busy !== null} onRemove={() => void change(m.id, null)} />}
          </li>
        ))}
        {managers?.roles.map((r) => (
          <li key={r.id} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate px-1 py-1 text-sm font-medium" style={r.color ? { color: r.color } : undefined} data-community-manager-role={r.id}>{r.name}</span>
            {editable && <RemoveButton name={r.name} id={r.id} disabled={busy !== null} onRemove={() => void change(r.id, null)} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

function RemoveButton({ name, id, disabled, onRemove }: { name: string; id: string; disabled: boolean; onRemove: () => void }) {
  const t = useT()
  return <button type="button" onClick={onRemove} disabled={disabled} title={t('Remove {name}', { name })} aria-label={t('Remove {name}', { name })} className="shrink-0 rounded p-1 text-text-2 hover:bg-bg-3 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50" data-manager-remove={id}><X size={14} aria-hidden /></button>
}

interface Option { id: string; kind: 'member' | 'role'; name: string; color?: string | null; avatar_url?: string | null }

/** Search over the server's members and the roles below the caller's own; arrow keys move, Enter picks, Escape closes. */
function Picker({ guildId, managers, busy, onPick, onClose }: { guildId: string; managers: Managers | null; busy: boolean; onPick: (id: string, kind: 'member' | 'role') => void; onClose: () => void }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const members = useStore((s) => s.members[guildId])
  const loaded = useStore((s) => !!s.membersLoaded[guildId])
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
  const me = useStore((s) => s.user)
  const myMember = useStore((s) => (me ? s.members[guildId]?.[me.id] : undefined))
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  useEffect(() => { if (!loaded) void useStore.getState().loadMembers(guildId) }, [guildId, loaded])

  const options = useMemo(() => {
    if (!guild || !me) return []
    const taken = new Set([...(managers?.members.map((m) => m.id) ?? []), ...(managers?.roles.map((r) => r.id) ?? [])])
    const ctx = { guild, roles, member: myMember }
    const out: Option[] = []
    for (const r of Object.values(roles)) if (r.id !== guildId && !taken.has(r.id) && canManageRole(ctx, me.id, r)) out.push({ id: r.id, kind: 'role', name: r.name, color: r.color })
    for (const m of Object.values(members ?? {})) if (!taken.has(m.user_id)) out.push({ id: m.user_id, kind: 'member', name: m.nickname || m.display_name, avatar_url: m.avatar_url })
    const needle = q.trim().toLowerCase()
    const hay = (o: Option) => o.name.toLowerCase() + ' ' + (o.kind === 'member' ? members?.[o.id]?.username.toLowerCase() ?? '' : '')
    return out.filter((o) => !needle || hay(o).includes(needle)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_OPTIONS)
  }, [guild, me, roles, members, myMember, managers, q, guildId])

  const idx = Math.min(active, Math.max(0, options.length - 1))
  const pick = (o: Option | undefined) => { if (o && !busy) onPick(o.id, o.kind) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(options.length - 1, idx + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, idx - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(options[idx]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
  }
  return (
    <div className="mb-2 rounded-lg border border-line bg-bg-1 p-2" data-manager-picker>
      <input className="input" autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0) }} onKeyDown={onKey} placeholder={t('Search members and roles')} aria-label={t('Search members and roles')} maxLength={100} role="combobox" aria-expanded aria-controls="manager-options" aria-activedescendant={options[idx] ? `manager-option-${options[idx].id}` : undefined} data-manager-pick />
      <ul id="manager-options" role="listbox" className="mt-1 max-h-56 overflow-y-auto">
        {options.map((o, i) => (
          <li key={o.id} id={`manager-option-${o.id}`} role="option" aria-selected={i === idx}>
            <button type="button" tabIndex={-1} disabled={busy} onClick={() => pick(o)} onMouseEnter={() => setActive(i)} className={`flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm ${i === idx ? 'bg-bg-3' : ''}`} data-manager-option={o.id}>
              {o.kind === 'member' ? <Avatar user={{ id: o.id, display_name: o.name, avatar_url: o.avatar_url ?? null }} size={20} /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-text-2" style={o.color ? { background: o.color } : undefined} aria-hidden />}
              <span className="min-w-0 flex-1 truncate" style={o.kind === 'role' && o.color ? { color: o.color } : undefined}>{o.name}</span>
              {o.kind === 'role' && <span className="shrink-0 text-[10px] uppercase text-text-2">{t('Role')}</span>}
            </button>
          </li>
        ))}
        {!options.length && <li className="px-1.5 py-2 text-xs text-text-2" role="presentation">{loaded ? t('No match') : t('Loading…')}</li>}
      </ul>
    </div>
  )
}

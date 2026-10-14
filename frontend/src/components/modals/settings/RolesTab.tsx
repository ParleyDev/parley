import { ChevronDown, ChevronUp, Plus, Shield, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { myGuildPerms, useStore } from '../../../store'
import type { Role } from '../../../lib/types'
import { canManageRole, has, P, PERMS, ROLE_COLORS, sortedRoles } from '../../../lib/perms'
import { Toggle } from '../SettingsShell'

export default function RolesTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const roles = useStore((s) => s.roles[guildId] ?? {})
  const me = useStore((s) => s.user)
  const member = useStore((s) => (me ? s.members[guildId]?.[me.id] : undefined))
  const myPerms = useStore((s) => myGuildPerms(s, guildId))
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const list = sortedRoles(roles)
  const [selected, setSelected] = useState<string>(list[0]?.id ?? guildId)
  const role = roles[selected]
  const canManage = has(myPerms, P.MANAGE_ROLES)
  const ctx = guild ? { guild, roles, member } : null
  const editable = !!(canManage && role && ctx && me && canManageRole(ctx, me.id, role))

  // Draft state for the selected role.
  const [draft, setDraft] = useState<Pick<Role, 'name' | 'color' | 'permissions' | 'hoist'> | null>(null)
  useEffect(() => { setDraft(role ? { name: role.name, color: role.color, permissions: role.permissions, hoist: role.hoist } : null) }, [role?.id, role?.name, role?.color, role?.permissions, role?.hoist]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false)
  if (!guild || !ctx) return null
  const dirty = !!(role && draft && (draft.name !== role.name || draft.color !== role.color || draft.permissions !== role.permissions || draft.hoist !== role.hoist))

  const create = async () => {
    try {
      const r = await api.post<Role>(`/guilds/${guildId}/roles`, { name: 'new role' })
      setSelected(r.id)
    } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const save = async () => {
    if (!role || !draft) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = { permissions: draft.permissions, hoist: draft.hoist, color: draft.color }
      if (role.id !== guildId) body.name = draft.name
      await api.patch(`/guilds/${guildId}/roles/${role.id}`, body)
      pushToast('Role saved')
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const move = async (r: Role, dir: -1 | 1) => {
    try { await api.patch(`/guilds/${guildId}/roles/${r.id}`, { position: r.position + dir }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const del = (r: Role) => openModal({
    kind: 'confirm', title: `Delete '${r.name}'`, body: 'Members with this role will lose it. This cannot be undone.', danger: true, confirmLabel: 'Delete Role',
    action: async () => { try { await api.delete(`/guilds/${guildId}/roles/${r.id}`); setSelected(guildId) } catch (e) { pushToast((e as Error).message, 'error') } },
  })

  const isAdmin = has(myPerms, P.ADMINISTRATOR)
  const maxPos = Math.max(0, ...list.map((r) => r.position))

  return (
    <div>
      <h1 className="text-xl font-bold">Roles</h1>
      <p className="text-sm text-text-2 mt-1">Use roles to group your members and assign permissions. Roles higher in the list outrank those below.</p>
      <div className="mt-6 flex gap-6 max-md:flex-col">
        {/* Role list */}
        <div className="w-60 max-md:w-full shrink-0">
          {canManage && <button onClick={create} className="btn-primary w-full mb-3"><Plus size={16} /> Create Role</button>}
          <div className="space-y-0.5">
            {list.map((r) => {
              const mine = canManage && me && canManageRole(ctx, me.id, r) && r.id !== guildId
              return (
                <div key={r.id} className={`group flex items-center gap-2 rounded-md pl-2 pr-1 py-1.5 cursor-pointer ${selected === r.id ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3'}`} onClick={() => setSelected(r.id)}>
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ background: r.color ?? '#7d8394' }} />
                  <span className="truncate flex-1 text-sm font-medium">{r.name}</span>
                  {mine && (
                    <span className="flex opacity-0 group-hover:opacity-100 max-md:opacity-100">
                      <button title="Move up" disabled={r.position >= maxPos} onClick={(e) => { e.stopPropagation(); move(r, 1) }} className="h-6 w-6 rounded flex items-center justify-center hover:bg-bg-2 disabled:opacity-30"><ChevronUp size={14} /></button>
                      <button title="Move down" disabled={r.position <= 1} onClick={(e) => { e.stopPropagation(); move(r, -1) }} className="h-6 w-6 rounded flex items-center justify-center hover:bg-bg-2 disabled:opacity-30"><ChevronDown size={14} /></button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Editor */}
        {role && draft && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-5">
              <Shield size={18} style={{ color: role.color ?? undefined }} />
              <h2 className="text-lg font-bold truncate">{role.id === guildId ? '@everyone' : role.name}</h2>
              {!editable && <span className="ml-auto text-xs text-text-2 rounded bg-bg-3 px-2 py-0.5">Read only</span>}
              {editable && role.id !== guildId && <button onClick={() => del(role)} className="ml-auto text-danger hover:bg-danger/10 rounded-md p-1.5" title="Delete Role"><Trash2 size={16} /></button>}
            </div>

            {role.id !== guildId && (
              <div className="space-y-5 mb-6">
                <div><label className="label">Role name</label><input className="input" value={draft.name} disabled={!editable} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={100} /></div>
                <div>
                  <label className="label">Role color</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" disabled={!editable} onClick={() => setDraft({ ...draft, color: null })} className={`h-8 w-8 rounded-md border-2 bg-bg-4 text-[10px] font-bold ${draft.color === null ? 'border-white' : 'border-transparent'}`} title="Default">Aa</button>
                    {ROLE_COLORS.map((c) => (
                      <button key={c} type="button" disabled={!editable} onClick={() => setDraft({ ...draft, color: c })} className={`h-8 w-8 rounded-md border-2 ${draft.color === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} title={c} />
                    ))}
                  </div>
                </div>
                <Toggle label="Display role members separately from online members" checked={draft.hoist} disabled={!editable} onChange={(v) => setDraft({ ...draft, hoist: v })} />
              </div>
            )}

            <h3 className="label">Permissions</h3>
            {(['General', 'Membership', 'Text', 'Voice'] as const).map((group) => (
              <div key={group} className="mb-5">
                <div className="text-xs font-bold uppercase tracking-wider text-text-2 mb-2 mt-4">{group} permissions</div>
                <div className="divide-y divide-line">
                  {PERMS.filter((p) => p.group === group).map((p) => {
                    const bit = P[p.key]
                    const on = has(draft.permissions, bit)
                    // You can only grant what you yourself have (admins/owner have everything).
                    const grantable = editable && (isAdmin || has(myPerms, bit))
                    return (
                      <div key={p.key} className="py-3 flex items-start justify-between gap-4">
                        <div className="min-w-0"><div className="text-[15px] font-medium">{p.label}</div><div className="text-sm text-text-2">{p.desc}</div></div>
                        <Toggle checked={on} disabled={!grantable} onChange={(v) => setDraft({ ...draft, permissions: v ? draft.permissions | bit : draft.permissions & ~bit })} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {dirty && (
              <div className="sticky bottom-4 rounded-xl bg-bg-0 border border-line shadow-2xl px-4 py-3 flex items-center gap-3 fade-in">
                <span className="text-sm flex-1">Careful — you have unsaved changes!</span>
                <button type="button" className="btn-ghost" onClick={() => setDraft({ name: role.name, color: role.color, permissions: role.permissions, hoist: role.hoist })}>Reset</button>
                <button className="btn-primary bg-success hover:bg-success/80 text-black" disabled={busy || !draft.name.trim()} onClick={save}>Save Changes</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

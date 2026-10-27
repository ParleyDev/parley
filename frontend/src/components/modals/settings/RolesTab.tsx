import RoleMembers from './RoleMembers'
import { ChevronDown, ChevronUp, Copy, Eye, Plus, Shield, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { prepareImage, uploadImage } from '../../../lib/upload'
import { myGuildPerms, useStore } from '../../../store'
import type { Role } from '../../../lib/types'
import { canManageRole, has, P, PERMS, sortedRoles, EMPTY_ROLES } from '../../../lib/perms'
import { Toggle } from '../SettingsShell'
import { roleLook } from '../../StyledName'
import { colorsOf, EFFECTS, nameLook, type NameEffect, type NameFont, type NameStyle } from '../../../lib/nameStyle'
import { RequirementsEditor } from '../../LinkedRoles'
import NameStyleModal from '../NameStyle'
import { useT } from '../../../lib/i18n'

const styleOfRole = (r: Role): NameStyle => ({ font: (r.name_style?.font as NameFont) ?? 'default', effect: (r.name_style?.effect as NameEffect) ?? (r.color_accent ? 'gradient' : 'solid'), colors: colorsOf({ name_primary: r.color, name_accent: r.color_accent, name_style: r.name_style }) })
const roleDot = (r: Role): string => { const c = colorsOf({ name_primary: r.color, name_accent: r.color_accent, name_style: r.name_style }); return c.length === 0 ? '#7d8394' : c.length === 1 ? c[0] : `linear-gradient(90deg, ${c.join(', ')})` }

export default function RolesTab({ guildId }: { guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const roles = useStore((s) => s.roles[guildId] ?? EMPTY_ROLES)
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
  const [draft, setDraft] = useState<(Pick<Role, 'name' | 'color' | 'color_accent' | 'permissions' | 'hoist'> & { name_style: NameStyle; icon: string | null; mentionable: boolean; self_assignable: boolean }) | null>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const fromRole = (r: Role) => ({ name: r.name, color: r.color, color_accent: r.color_accent, permissions: r.permissions, hoist: r.hoist, name_style: styleOfRole(r), icon: r.icon ?? null, mentionable: !!r.mentionable, self_assignable: !!r.self_assignable })
  useEffect(() => { setDraft(role ? fromRole(role) : null) }, [role?.id, role?.name, role?.color, role?.color_accent, role?.permissions, role?.hoist, role?.icon, role?.mentionable]) // eslint-disable-line react-hooks/exhaustive-deps
  // How many members hold each role, refreshed when roles change.
  const [counts, setCounts] = useState<Record<string, number>>({})
  const roleKey = Object.keys(roles).join(',')
  useEffect(() => { api.get<Record<string, number>>(`/guilds/${guildId}/role-counts`).then(setCounts).catch(() => {}) }, [guildId, roleKey])
  const [iconBusy, setIconBusy] = useState(false)
  const uploadIcon = async (f: File | undefined) => {
    if (!f || !draft) return
    setIconBusy(true)
    try { setDraft({ ...draft, icon: (await uploadImage('icon', await prepareImage(f, 64, 64))).url }) } catch (e) { pushToast((e as Error).message, 'error') } finally { setIconBusy(false) }
  }
  const [busy, setBusy] = useState(false)
  const [pane, setPane] = useState<'display' | 'members'>('display')
  const [dragId, setDragId] = useState<string | null>(null)
  if (!guild || !ctx) return null
  const dirty = !!(role && draft && (draft.name !== role.name || JSON.stringify(draft.name_style) !== JSON.stringify(styleOfRole(role)) || draft.permissions !== role.permissions || draft.hoist !== role.hoist || draft.icon !== (role.icon ?? null) || draft.mentionable !== !!role.mentionable || draft.self_assignable !== !!role.self_assignable))

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
      const body: Record<string, unknown> = { permissions: draft.permissions, hoist: draft.hoist, name_style: draft.name_style }
      if (role.id !== guildId) Object.assign(body, { name: draft.name, icon: draft.icon, mentionable: draft.mentionable, self_assignable: draft.self_assignable })
      await api.patch(`/guilds/${guildId}/roles/${role.id}`, body)
      pushToast(t('Role saved'))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const move = async (r: Role, dir: -1 | 1) => {
    try { await api.patch(`/guilds/${guildId}/roles/${r.id}`, { position: r.position + dir }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const duplicate = async (r: Role) => {
    try { const copy = await api.post<Role>(`/guilds/${guildId}/roles/${r.id}/duplicate`); setSelected(copy.id); pushToast(t('Made {name}', { name: copy.name })) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const del = (r: Role) => openModal({
    kind: 'confirm', title: t("Delete '{name}'", { name: r.name }), body: t('Members with this role will lose it. This cannot be undone.'), danger: true, confirmLabel: t('Delete Role'),
    action: async () => { try { await api.delete(`/guilds/${guildId}/roles/${r.id}`); setSelected(guildId) } catch (e) { pushToast((e as Error).message, 'error') } },
  })

  const isAdmin = has(myPerms, P.ADMINISTRATOR)
  const maxPos = Math.max(0, ...list.map((r) => r.position))

  return (
    <div>
      <h1 className="text-xl font-bold">{t('Roles')}</h1>
      <p className="text-sm text-text-2 mt-1">{t('Use roles to group your members and assign permissions. Roles higher in the list outrank those below.')}</p>
      <div className="mt-6 flex gap-6 max-md:flex-col">
        {/* Role list */}
        <div className="w-60 max-md:w-full shrink-0">
          {canManage && <button onClick={create} className="btn-primary w-full mb-3"><Plus size={16} /> {t('Create Role')}</button>}
          <div className="space-y-0.5">
            {list.map((r) => {
              const mine = canManage && me && canManageRole(ctx, me.id, r) && r.id !== guildId
              return (
                <div key={r.id} className={`group flex items-center gap-2 rounded-md pl-2 pr-1 py-1.5 cursor-pointer ${selected === r.id ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3'} ${dragId === r.id ? 'opacity-40' : ''}`} onClick={() => setSelected(r.id)}
                  draggable={!!mine} onDragStart={(e) => { setDragId(r.id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => { if (dragId && dragId !== r.id && r.id !== guildId && me && canManageRole(ctx, me.id, r)) e.preventDefault() }}
                  onDrop={(e) => { e.preventDefault(); const from = dragId && roles[dragId]; setDragId(null); if (from && from.position !== r.position) void api.patch(`/guilds/${guildId}/roles/${from.id}`, { position: r.position }).catch((err: Error) => pushToast(err.message, 'error')) }}
                  data-role-row={r.id}>
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ background: roleDot(r) }} />
                  {r.icon && (r.icon.startsWith('/api/images/') ? <img src={r.icon} alt="" className="h-4 w-4 shrink-0 object-contain" /> : <span className="shrink-0 text-sm leading-none">{r.icon}</span>)}
                  <span className={`truncate flex-1 text-sm font-medium ${roleLook(r).className}`} style={roleLook(r).style}>{r.name}</span>
                  {r.id !== guildId && counts[r.id] !== undefined && <span className="shrink-0 text-[11px] tabular-nums text-text-2" title={counts[r.id] === 1 ? t('1 member') : t('{n} members', { n: counts[r.id] })} data-role-count={r.id}>{counts[r.id]}</span>}
                  {mine && (
                    <span className="flex opacity-0 group-hover:opacity-100 max-md:opacity-100">
                      <button title={t('Move up')} disabled={r.position >= maxPos} onClick={(e) => { e.stopPropagation(); move(r, 1) }} className="h-6 w-6 rounded flex items-center justify-center hover:bg-bg-2 disabled:opacity-30"><ChevronUp size={14} /></button>
                      <button title={t('Move down')} disabled={r.position <= 1} onClick={(e) => { e.stopPropagation(); move(r, -1) }} className="h-6 w-6 rounded flex items-center justify-center hover:bg-bg-2 disabled:opacity-30"><ChevronDown size={14} /></button>
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
              {!editable && <span className="ml-auto text-xs text-text-2 rounded bg-bg-3 px-2 py-0.5">{t('Read only')}</span>}
              <button onClick={() => { useStore.getState().setViewAs({ guildId, roleIds: role.id === guildId ? [] : [role.id] }); useStore.getState().closeModal(); pushToast(t('Viewing the server as {name}', { name: role.id === guildId ? '@everyone' : role.name })) }} className={`${editable && role.id !== guildId ? '' : 'ml-auto'} text-text-2 hover:bg-bg-3 hover:text-text-0 rounded-md p-1.5 order-last`} title={t('View Server As Role')} data-role-view-as><Eye size={16} /></button>
              {editable && role.id !== guildId && <button onClick={() => duplicate(role)} className="ml-auto text-text-2 hover:bg-bg-3 hover:text-text-0 rounded-md p-1.5" title={t('Duplicate Role')} data-role-duplicate><Copy size={16} /></button>}
              {editable && role.id !== guildId && <button onClick={() => del(role)} className="text-danger hover:bg-danger/10 rounded-md p-1.5" title={t('Delete Role')}><Trash2 size={16} /></button>}
            </div>

            {role.id !== guildId && (
              <div className="mb-5 flex gap-1 border-b border-line" data-role-panes>
                {(['display', 'members'] as const).map((k) => <button key={k} type="button" onClick={() => setPane(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${pane === k ? 'border-accent text-text-0' : 'border-transparent text-text-2 hover:text-text-0'}`} data-role-pane={k}>{k === 'display' ? t('Display & Permissions') : `${t('Members')}${counts[role.id] !== undefined ? ` (${counts[role.id]})` : ''}`}</button>)}
              </div>
            )}
            {pane === 'members' && role.id !== guildId ? <RoleMembers guildId={guildId} roleId={role.id} editable={editable} /> : <>
            {role.id !== guildId && (
              <div className="space-y-5 mb-6">
                <div><label className="label">{t('Role name')}</label><input className="input" value={draft.name} disabled={!editable} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={100} /></div>
                <div className="space-y-2 rounded-xl bg-bg-0/40 border border-line p-3" data-role-style-card>
                  <label className="label">{t('Role name style')}</label>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`text-[15px] font-semibold ${nameLook({ name_style: draft.name_style }).className}`} style={nameLook({ name_style: draft.name_style }).style} data-role-name-preview>{draft.name || t('role name')}</span>
                    <span className="text-xs text-text-2">{draft.name_style.colors?.length ? t(EFFECTS.find((e) => e.id === draft.name_style.effect)?.label ?? 'Solid') : t('No colour')}</span>
                    <button type="button" className="btn-ghost bg-bg-3 hover:bg-bg-4 ml-auto" disabled={!editable} onClick={() => setStyleOpen(true)} data-role-style-open>{t('Change Name Style')}</button>
                  </div>
                  <p className="text-xs text-text-2">{t("Members with this role get this font, effect and colour on their name, like a user's own display name style.")}</p>
                </div>
                <Toggle label={t('Display role members separately from online members')} checked={draft.hoist} disabled={!editable} onChange={(v) => setDraft({ ...draft, hoist: v })} />
                <div data-role-self-assignable>
                  <Toggle label={t('Let members pick this role themselves')} checked={draft.self_assignable} disabled={!editable} onChange={(v) => setDraft({ ...draft, self_assignable: v })} />
                  <p className="mt-1 text-xs text-text-2">{t("It shows in Channels & Roles. Roles with moderation powers can't be self-assignable.")}</p>
                </div>
                {role.id !== guildId && !role.managed_app_id && <RequirementsEditor guildId={guildId} role={role} editable={editable} />}
                <div data-role-mentionable>
                  <Toggle label={t('Allow anyone to @mention this role')} checked={draft.mentionable} disabled={!editable} onChange={(v) => setDraft({ ...draft, mentionable: v })} />
                  <p className="mt-1 text-xs text-text-2">{t('Members with Mention @everyone, @here and All Roles can always ping it.')}</p>
                </div>
                <div className="space-y-2" data-role-icon-editor>
                  <label className="label">{t('Role icon')}</label>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="h-10 w-10 rounded-lg border border-line bg-bg-0/50 flex items-center justify-center text-2xl" aria-label={t('Icon preview')}>
                      {draft.icon ? (draft.icon.startsWith('/api/images/') ? <img src={draft.icon} alt="" className="h-6 w-6 object-contain" /> : draft.icon) : <span className="text-xs text-text-2">{t('None')}</span>}
                    </span>
                    <input className="input w-24" value={draft.icon && !draft.icon.startsWith('/api/images/') ? draft.icon : ''} placeholder={t('Emoji')} maxLength={8} disabled={!editable} aria-label={t('Role icon emoji')}
                      onChange={(e) => setDraft({ ...draft, icon: e.target.value.trim() || null })} data-role-icon-emoji />
                    <label className={`btn-ghost bg-bg-3 hover:bg-bg-4 ${editable ? 'cursor-pointer' : 'pointer-events-none opacity-50'}`}>{iconBusy ? t('Uploading…') : t('Upload image')}<input type="file" accept="image/*" className="hidden" onChange={(e) => { void uploadIcon(e.target.files?.[0]); e.target.value = '' }} data-role-icon-file /></label>
                    {draft.icon && <button type="button" className="btn-ghost" disabled={!editable} onClick={() => setDraft({ ...draft, icon: null })}>{t('Remove')}</button>}
                  </div>
                  <p className="text-xs text-text-2">{t('Shown next to the names of members whose highest role with an icon is this one.')}</p>
                </div>
              </div>
            )}

            <h3 className="label">{t('Permissions')}</h3>
            {(['General', 'Membership', 'Text', 'Voice'] as const).map((group) => (
              <div key={group} className="mb-5">
                <div className="text-xs font-bold uppercase tracking-wider text-text-2 mb-2 mt-4">{t('{group} permissions', { group: ({ General: t('General'), Membership: t('Membership'), Text: t('Text'), Voice: t('Voice') })[group] })}</div>
                <div className="divide-y divide-line">
                  {PERMS.filter((p) => p.group === group).map((p) => {
                    const bit = P[p.key]
                    const on = has(draft.permissions, bit)
                    // You can only grant what you yourself have (admins/owner have everything).
                    const grantable = editable && (isAdmin || has(myPerms, bit))
                    return (
                      <div key={p.key} className="py-3 flex items-start justify-between gap-4">
                        <div className="min-w-0"><div className="text-[15px] font-medium">{t(p.label)}</div><div className="text-sm text-text-2">{t(p.desc)}</div></div>
                        <Toggle checked={on} disabled={!grantable} onChange={(v) => setDraft({ ...draft, permissions: v ? draft.permissions | bit : draft.permissions & ~bit })} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            </>}
            {dirty && (
              <div className="sticky bottom-4 rounded-xl bg-bg-0 border border-line shadow-2xl px-4 py-3 flex items-center gap-3 fade-in">
                <span className="text-sm flex-1">{t('Careful — you have unsaved changes!')}</span>
                <button type="button" className="btn-ghost" onClick={() => setDraft(fromRole(role))}>{t('Reset')}</button>
                <button className="btn-primary bg-success hover:bg-success/80 text-black" disabled={busy || !draft.name.trim()} onClick={save}>{t('Save Changes')}</button>
              </div>
            )}
            {styleOpen && draft && <NameStyleModal title={t('Change Role Name Style')} subject="role" onClose={() => setStyleOpen(false)} name={draft.name || t('role name')} value={draft.name_style} onApply={(v) => { setDraft({ ...draft, name_style: v, color: v.colors[0] ?? null, color_accent: v.effect === 'gradient' ? v.colors[1] ?? null : null }); setStyleOpen(false) }} />}
          </div>
        )}
      </div>
    </div>
  )
}

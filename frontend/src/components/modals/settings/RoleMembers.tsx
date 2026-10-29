import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import Avatar from '../../Avatar'
import { useT } from '../../../lib/i18n'

interface Row { id: string; display_name: string; avatar_url: string | null; nickname: string | null }

/** A role's Members tab: who has it, remove someone, or add several people at once. */
export default function RoleMembers({ guildId, roleId, editable }: { guildId: string; roleId: string; editable: boolean }) {
  const t = useT()
  const members = useStore((s) => s.members[guildId])
  const loaded = useStore((s) => !!s.membersLoaded[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const load = () => api.get<Row[]>(`/guilds/${guildId}/roles/${roleId}/members`).then(setRows).catch(() => setRows([]))
  useEffect(() => { void load(); if (!loaded) void useStore.getState().loadMembers(guildId) }, [guildId, roleId]) // eslint-disable-line react-hooks/exhaustive-deps
  const setRoles = async (uid: string, add: boolean) => {
    const cur = useStore.getState().members[guildId]?.[uid]?.roles ?? []
    const roles = add ? [...new Set([...cur, roleId])] : cur.filter((r) => r !== roleId)
    await api.patch(`/guilds/${guildId}/members/${uid}`, { roles })
  }
  const remove = async (uid: string) => { try { await setRoles(uid, false); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const addPicked = async () => {
    setBusy(true)
    let n = 0
    for (const uid of picked) { try { await setRoles(uid, true); n++ } catch (e) { pushToast((e as Error).message, 'error') } }
    setBusy(false); setPicked(new Set()); setAdding(false); pushToast(n === 1 ? t('Added 1 member') : t('Added {n} members', { n })); await load()
  }
  const have = new Set((rows ?? []).map((r) => r.id))
  const candidates = useMemo(() => Object.values(members ?? {}).filter((m) => !have.has(m.user_id) && (!q || (m.nickname || m.display_name).toLowerCase().includes(q.toLowerCase()) || m.username.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.nickname || a.display_name).localeCompare(b.nickname || b.display_name)).slice(0, 100), [members, rows, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (rows ?? []).filter((r) => !q || (r.nickname || r.display_name).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-3" data-role-members>
      <div className="flex gap-2">
        <div className="relative flex-1"><input className="input pl-9" placeholder={adding ? t('Search members to add') : t('Search members')} value={q} onChange={(e) => setQ(e.target.value)} /><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" /></div>
        {editable && <button type="button" className="btn-primary shrink-0" onClick={() => { setAdding((a) => !a); setPicked(new Set()) }} data-role-add-members>{adding ? t('Done') : t('Add Members')}</button>}
      </div>
      {adding ? (
        <div>
          <div className="max-h-80 overflow-y-auto divide-y divide-line rounded-lg border border-line" data-role-add-list>
            {candidates.length === 0 && <p className="p-4 text-sm text-text-2">{t('Everyone matching already has this role.')}</p>}
            {candidates.map((m) => (
              <label key={m.user_id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-bg-3" data-role-add-option={m.user_id}>
                <input type="checkbox" className="h-4 w-4 accent-accent" checked={picked.has(m.user_id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(m.user_id)) n.delete(m.user_id); else n.add(m.user_id); return n })} />
                <Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }} size={24} />
                <span className="truncate text-sm">{m.nickname || m.display_name}</span><span className="truncate text-xs text-text-2">@{m.username}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn-primary mt-2" disabled={busy || picked.size === 0} onClick={addPicked} data-role-add-confirm>{t('Add {n} to role', { n: picked.size || '' })}</button>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {rows === null && <p className="py-3 text-sm text-text-2">{t('Loading…')}</p>}
          {rows?.length === 0 && <p className="py-3 text-sm text-text-2">{t('No one has this role yet.')}</p>}
          {shown.map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-2" data-role-member={r.id}>
              <Avatar user={r} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm">{r.nickname || r.display_name}</span>
              {editable && <button type="button" onClick={() => remove(r.id)} title={t('Remove from role')} className="rounded p-1 text-text-2 hover:bg-danger/10 hover:text-danger" data-role-member-remove={r.id}><X size={15} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

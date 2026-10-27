import { Check, Link2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Role } from '../lib/types'
import { useStore } from '../store'

export interface Requirements { account_age_days?: number; verified_email?: boolean; connection?: string; app?: { app_id: string; key: string; type?: number; label?: string; value: number | boolean | string } }
const PROVIDERS: [string, string][] = [['', 'None'], ['github', 'GitHub'], ['gitlab', 'GitLab'], ['twitch', 'Twitch'], ['youtube', 'YouTube'], ['reddit', 'Reddit'], ['spotify', 'Spotify']]
interface Meta { key: string; name: string; type: number }

/** Server Settings › Roles › Links: what a member needs to claim this role themselves. */
export function RequirementsEditor({ guildId, role, editable }: { guildId: string; role: Role; editable: boolean }) {
  const pushToast = useStore((s) => s.pushToast)
  const [on, setOn] = useState(!!role.requirements)
  const [r, setR] = useState<Requirements>(role.requirements ?? {})
  const [apps, setApps] = useState<{ id: string; name: string; meta: Meta[] }[]>([])
  useEffect(() => { setOn(!!role.requirements); setR(role.requirements ?? {}) }, [role.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get<{ bots: { application: string | null; application_id: string | null }[] }>(`/guilds/${guildId}/integrations`).then(async (i) => {
      const out = []
      for (const b of i.bots) if (b.application_id) { const meta = await api.get<Meta[]>(`/applications/${b.application_id}/role-connections/metadata`).catch(() => []); if (meta.length) out.push({ id: b.application_id, name: b.application ?? 'App', meta }) }
      setApps(out)
    }).catch(() => setApps([]))
  }, [guildId])
  const save = async () => { try { await api.put(`/guilds/${guildId}/roles/${role.id}/requirements`, { requirements: on ? r : null }); pushToast(on ? 'Linked role saved' : 'No longer a linked role') } catch (e) { pushToast((e as Error).message, 'error') } }
  const app = apps.find((a) => a.id === r.app?.app_id)
  const meta = app?.meta.find((m) => m.key === r.app?.key)
  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg-1 p-3" data-role-requirements>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="accent-accent" disabled={!editable} checked={on} onChange={(e) => setOn(e.target.checked)} data-linked-on />Linked role: members claim it when they meet these</label>
      {on && <>
        <label className="flex items-center gap-2 text-sm">Account at least <input type="number" min={0} max={3650} className="input w-20 py-1" value={r.account_age_days ?? ''} onChange={(e) => setR({ ...r, account_age_days: Number(e.target.value) || undefined })} data-linked-age /> days old</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-accent" checked={!!r.verified_email} onChange={(e) => setR({ ...r, verified_email: e.target.checked || undefined })} data-linked-email />A verified email</label>
        <label className="flex items-center gap-2 text-sm">A linked account: <select className="input w-auto py-1" value={r.connection ?? ''} onChange={(e) => setR({ ...r, connection: e.target.value || undefined })} data-linked-connection>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {apps.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm" data-linked-app>
            From an app:
            <select className="input w-auto py-1" value={r.app ? `${r.app.app_id}:${r.app.key}` : ''} onChange={(e) => { const [id, key] = e.target.value.split(':'); setR({ ...r, app: id ? { app_id: id, key, value: 1 } : undefined }) }}>
              <option value="">None</option>
              {apps.flatMap((a) => a.meta.map((m) => <option key={`${a.id}:${m.key}`} value={`${a.id}:${m.key}`}>{a.name}: {m.name}</option>))}
            </select>
            {meta && r.app && (meta.type >= 7
              ? <select className="input w-auto py-1" value={String(r.app.value)} onChange={(e) => setR({ ...r, app: { ...r.app!, value: e.target.value === 'true' } })}><option value="true">is yes</option><option value="false">is no</option></select>
              : <><span>{({ 1: 'at most', 2: 'at least', 3: 'equal to', 4: 'not', 5: 'within (days)', 6: 'at least (days ago)' } as Record<number, string>)[meta.type]}</span><input type="number" className="input w-24 py-1" value={Number(r.app.value)} onChange={(e) => setR({ ...r, app: { ...r.app!, value: Number(e.target.value) } })} /></>)}
          </div>
        )}
      </>}
      {editable && <button type="button" className="btn-primary py-1 text-sm" onClick={save} data-linked-save>Save links</button>}
    </div>
  )
}

interface Linked { id: string; name: string; color: string | null; missing: string[]; have: boolean }

/** Channels & Roles: linked roles you can claim, with what you still need. */
export function LinkedRolesList({ guildId }: { guildId: string }) {
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [list, setList] = useState<Linked[]>([])
  const load = () => api.get<Linked[]>(`/guilds/${guildId}/linked-roles`).then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null
  const claim = async (r: Linked) => { try { await api.put(`/guilds/${guildId}/me/linked-roles/${r.id}`); pushToast(`You have ${r.name} now`); void load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <section className="space-y-2" data-linked-roles>
      <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-2"><Link2 size={13} />Linked roles</h3>
      {list.map((r) => (
        <div key={r.id} className="rounded-lg border border-line bg-bg-1 p-3 text-sm" data-linked-role={r.id}>
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: r.color ?? '#99aab5' }} /><span className="flex-1 font-semibold">{r.name}</span>
            {r.have ? <span className="flex items-center gap-1 text-xs text-success" data-linked-have><Check size={14} />You have it</span>
              : <button type="button" className="btn-primary py-1 text-xs" disabled={r.missing.length > 0} onClick={() => claim(r)} data-linked-claim={r.id}>Claim</button>}
          </div>
          {r.missing.length > 0 && !r.have && <ul className="mt-1.5 space-y-0.5 text-xs text-text-2">{r.missing.map((m) => <li key={m} className="flex items-center gap-1"><X size={12} className="text-danger" />{m}</li>)}</ul>}
          {r.missing.some((m) => m.startsWith('A linked')) && <button type="button" className="mt-1 text-xs text-sky-400 hover:underline" onClick={() => openModal({ kind: 'userSettings', tab: 'connections' })}>Link an account</button>}
        </div>
      ))}
    </section>
  )
}

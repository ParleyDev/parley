import { Hash, LayoutTemplate, Shield, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { APP_NAME } from '../lib/brand'
import type { Channel, Guild, Role } from '../lib/types'
import { useStore } from '../store'

interface TChannel { name: string; kind: string; parent: number | null }
interface TRole { name: string; color: string | null }
export interface TemplatePreview { code: string; name: string; description: string; usage_count: number; creator: string | null; source_guild: { id: string; name: string; icon_url: string | null }; snapshot: { roles: TRole[]; channels: TChannel[] } }

/** `/template/:code`: what a server template sets up, and a button to create a server from it. */
export default function TemplatePage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const upsertGuild = useStore((s) => s.upsertGuild)
  const [t, setT] = useState<TemplatePreview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get<TemplatePreview>(`/templates/${code}`).then((x) => { setT(x); setName(x.name) }).catch((e) => setErr((e as Error).message)) }, [code])
  const create = async () => {
    setBusy(true)
    try {
      const g = await api.post<Guild & { channels: Channel[]; roles: Role[] }>(`/templates/${code}`, { name })
      upsertGuild(g)
      const first = g.channels.find((c) => c.kind === 'text')
      navigate(first ? `/channels/${g.id}/${first.id}` : `/channels/${g.id}`, { replace: true })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const cats = t?.snapshot.channels ?? []
  return (
    <div className="h-full overflow-y-auto flex items-center-safe justify-center bg-bg-0 p-4">
      <div className="pop w-full max-w-md rounded-2xl bg-bg-1 border border-line p-8 shadow-2xl" data-template-page>
        {err && !t ? (
          <div className="text-center">
            <h1 className="text-xl font-bold mb-2">Template not found</h1>
            <p className="text-text-2 text-sm mb-6">{err}</p>
            <button className="btn-primary w-full" onClick={() => navigate('/channels/@me')}>Continue to {APP_NAME}</button>
          </div>
        ) : !t ? <p className="text-center text-text-2">Loading…</p> : (
          <>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/20 text-accent"><LayoutTemplate size={28} /></div>
            <p className="text-center text-sm text-text-2">Create a server from the template</p>
            <h1 className="text-center text-2xl font-bold" data-template-name>{t.name}</h1>
            {t.description && <p className="mt-1 text-center text-sm text-text-1">{t.description}</p>}
            <p className="mt-1 text-center text-xs text-text-2">Used {t.usage_count} time{t.usage_count === 1 ? '' : 's'}{t.creator ? ` · by ${t.creator}` : ''}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-line bg-bg-0/50 p-3" data-template-channels>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">Channels</div>
                <div className="max-h-48 space-y-0.5 overflow-y-auto">
                  {cats.map((c, i) => c.kind === 'category'
                    ? <div key={i} className="pt-1 text-[11px] font-bold uppercase text-text-2">{c.name}</div>
                    : <div key={i} className="flex items-center gap-1 truncate text-text-1">{c.kind === 'voice' || c.kind === 'stage' ? <Volume2 size={13} /> : <Hash size={13} />}{c.name}</div>)}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-bg-0/50 p-3" data-template-roles>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">Roles</div>
                <div className="max-h-48 space-y-0.5 overflow-y-auto">
                  {[...t.snapshot.roles].reverse().map((r, i) => <div key={i} className="flex items-center gap-1 truncate"><Shield size={13} style={{ color: r.color ?? undefined }} />{r.name}</div>)}
                  {t.snapshot.roles.length === 0 && <div className="text-text-2">Just @everyone</div>}
                </div>
              </div>
            </div>
            <label className="label mt-5" htmlFor="tpl-name">Server name</label>
            <input id="tpl-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} data-template-server-name />
            {err && <p className="mt-2 text-sm text-danger">{err}</p>}
            <button className="btn-primary mt-4 w-full" disabled={busy || !name.trim()} onClick={create} data-template-create>{busy ? 'Creating…' : 'Create Server'}</button>
            <p className="mt-2 text-center text-xs text-text-2">Copies channels, roles and permissions. No messages or members.</p>
          </>
        )}
      </div>
    </div>
  )
}

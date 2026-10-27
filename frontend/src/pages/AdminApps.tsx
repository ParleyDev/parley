import { BadgeCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'

interface AdminApp { id: string; name: string; description: string; icon_url: string | null; verified: boolean; bot_public: boolean; created_at: string; owner: string | null; servers: number }

/** Admin › Apps: every app with a bot; verify the ones you've reviewed (their bots get a check on their tag). */
export default function AppsPane() {
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<AdminApp[] | null>(null)
  useEffect(() => { api.get<AdminApp[]>('/admin/applications').then(setList).catch((e) => pushToast((e as Error).message, 'error')) }, [pushToast])
  const toggle = async (a: AdminApp) => { try { await api.patch(`/admin/applications/${a.id}`, { verified: !a.verified }); setList((l) => l?.map((x) => (x.id === a.id ? { ...x, verified: !a.verified } : x)) ?? null) } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="space-y-4" data-admin-apps>
      <div><h1 className="text-xl font-bold">Apps</h1><p className="mt-1 text-sm text-text-2">Apps with a bot. Verify the ones you have reviewed: their bots show a check next to the Bot tag.</p></div>
      {!list ? <p className="text-sm text-text-2">Loading…</p> : list.length === 0 ? <p className="text-sm text-text-2">No apps have bots yet.</p> : (
        <div className="divide-y divide-line rounded-xl border border-line bg-bg-1">
          {list.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-admin-app={a.id}>
              {a.icon_url ? <img src={a.icon_url} alt="" className="h-8 w-8 rounded-lg" /> : <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg-3 font-bold">{a.name[0]}</div>}
              <span className="min-w-0 flex-1"><span className="flex items-center gap-1 font-semibold">{a.name}{a.verified && <BadgeCheck size={14} className="text-accent" />}</span><span className="block truncate text-xs text-text-2">by @{a.owner ?? 'unknown'} · in {a.servers} server{a.servers === 1 ? '' : 's'}{a.bot_public ? '' : ' · private'}</span></span>
              <button type="button" className={a.verified ? 'btn-ghost py-1' : 'btn-primary py-1'} onClick={() => toggle(a)} data-admin-verify={a.id}>{a.verified ? 'Unverify' : 'Verify'}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

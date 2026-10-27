import { Link2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { Connection } from '../../../lib/types'
import { Toggle } from '../SettingsShell'

const LABELS: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', twitch: 'Twitch', reddit: 'Reddit', spotify: 'Spotify' }

/** Settings → Connections: link external accounts and choose which show on your profile. */
export default function ConnectionsTab() {
  const available = useStore((s) => s.instance.oauth_available ?? [])
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<Connection[] | null>(null)
  const load = () => api.get<Connection[]>('/users/@me/connections').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  const connect = async (p: string) => {
    try { const r = await api.get<{ url: string }>(`/connections/${p}/start`); window.location.href = r.url } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const setVisible = async (c: Connection, visible: boolean) => { try { await api.patch(`/users/@me/connections/${c.id}`, { visible }); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  const remove = async (c: Connection) => { try { await api.delete(`/users/@me/connections/${c.id}`); pushToast('Connection removed'); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="space-y-6" data-connections-tab>
      <h2 className="text-xl font-bold">Connections</h2>
      <section className="space-y-2">
        <h3 className="label">Connect your accounts</h3>
        {available.length === 0 && <p className="text-sm text-text-2">No providers are set up on this server yet. An admin can add GitHub and Twitch keys in the admin console.</p>}
        <div className="flex flex-wrap gap-2">
          {available.map((p) => <button key={p} type="button" onClick={() => connect(p)} className="btn-ghost bg-bg-3 hover:bg-bg-4" data-connect={p}><Link2 size={14} /> {LABELS[p] ?? p}</button>)}
        </div>
        <p className="text-xs text-text-2">You will be sent to the provider to approve the link, then brought back here.</p>
      </section>
      <div className="h-px bg-line" />
      <section className="space-y-2">
        <h3 className="label">Your connections</h3>
        {list === null && <p className="text-sm text-text-2">Loading…</p>}
        {list?.length === 0 && <p className="text-sm text-text-2">Nothing linked yet.</p>}
        <ul className="space-y-2">
          {list?.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-bg-1 px-3 py-2.5 space-y-2" data-connection-row={c.provider}>
              <div className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-md bg-bg-3 text-xs font-bold flex items-center justify-center uppercase">{c.provider[0]}</span>
                <div className="min-w-0 flex-1"><div className="font-semibold truncate">{c.name}</div><div className="text-xs text-text-2">{LABELS[c.provider] ?? c.provider}{c.url && <> · <a href={c.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{c.url}</a></>}</div></div>
                <button type="button" onClick={() => remove(c)} title="Remove" className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:text-danger hover:bg-bg-3" data-connection-remove><Trash2 size={16} /></button>
              </div>
              <span data-connection-visible={c.visible ? '1' : '0'}><Toggle label="Display on profile" checked={c.visible} onChange={(v) => setVisible(c, v)} /></span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

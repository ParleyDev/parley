import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { AuthorizedApp } from '../../../lib/types'

const SCOPE_LABELS: Record<string, string> = { identify: 'Read your profile', email: 'Read your email', guilds: 'See your servers', 'messages.read': 'Read messages', 'messages.write': 'Send messages as you', bot: 'Add its bot to servers' }

/** Settings → Authorized Apps: third-party apps holding a token for your account, with Deauthorize. */
export default function AuthorizedAppsTab() {
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<AuthorizedApp[] | null>(null)
  const load = () => api.get<AuthorizedApp[]>('/users/@me/authorized-apps').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  const revoke = async (a: AuthorizedApp) => { try { await api.delete(`/users/@me/authorized-apps/${a.id}`); pushToast(`${a.name} can no longer access your account`); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div className="space-y-6" data-authorized-apps>
      <h2 className="text-xl font-bold">Authorized Apps</h2>
      <p className="text-sm text-text-2">Apps you let in with "Authorise". Each keeps only the access listed; deauthorising ends it at once.</p>
      {list === null && <p className="text-sm text-text-2">Loading…</p>}
      {list?.length === 0 && <p className="text-sm text-text-2">No apps have access to your account.</p>}
      <ul className="space-y-2">
        {list?.map((a) => (
          <li key={a.id} className="rounded-lg border border-line bg-bg-1 px-3 py-2.5" data-authorized-app={a.id}>
            <div className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-md bg-bg-3 text-sm font-bold flex items-center justify-center">{a.name[0]}</span>
              <div className="min-w-0 flex-1"><div className="font-semibold truncate">{a.name}</div><div className="text-xs text-text-2 truncate">{a.owner ? `by ${a.owner} · ` : ''}authorised {new Date(a.since).toLocaleDateString()}</div></div>
              <button type="button" onClick={() => revoke(a)} className="rounded-md border border-danger/60 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10" data-deauthorize>Deauthorize</button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">{a.scopes.map((s) => <li key={s} className="rounded-full bg-bg-3 px-2 py-0.5 text-xs" data-scope={s}>{SCOPE_LABELS[s] ?? s}</li>)}</ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

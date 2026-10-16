import { useCallback, useEffect, useState } from 'react'
import { LogOut, MonitorSmartphone } from 'lucide-react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { describeUa, relativeTime } from '../../../lib/ua'

interface Session { id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string; current: boolean }

/** "Devices" card in My Account: every active login, log one out, or log out everywhere else. */
export default function SessionsSection() {
  const pushToast = useStore((s) => s.pushToast)
  const logout = useStore((s) => s.logout)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setSessions(await api.get<Session[]>('/users/@me/sessions')) } catch (e) { pushToast((e as Error).message, 'error') }
  }, [pushToast])
  useEffect(() => { load() }, [load])

  const end = async (s: Session) => {
    setBusy(s.id)
    try {
      await api.delete(`/users/@me/sessions/${s.id}`)
      if (s.current) { logout(); return }
      pushToast('Device logged out'); await load()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(null) }
  }
  const endOthers = async () => {
    setBusy('others')
    try {
      const r = await api.delete<{ revoked: number }>('/users/@me/sessions')
      pushToast(r.revoked === 1 ? 'Logged out 1 other device' : `Logged out ${r.revoked} other devices`); await load()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(null) }
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-3" data-sessions-section>
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-bg-3 text-text-2 flex items-center justify-center"><MonitorSmartphone size={18} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Devices</h3>
          <p className="text-sm text-text-2">Where you are logged in. Log out any device you don't recognise; its session stops working immediately.</p>
        </div>
      </div>
      {sessions === null ? <div className="text-sm text-text-2">Loading…</div> : (
        <ul className="divide-y divide-line rounded-lg border border-line" data-sessions>
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2" data-session={s.id} data-session-current={s.current ? '1' : '0'}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" data-session-device>{describeUa(s.user_agent)}{s.current && <span className="ml-2 rounded bg-success/20 text-success px-1.5 py-0.5 text-[10px] font-bold align-middle">THIS DEVICE</span>}</div>
                <div className="text-xs text-text-2 truncate" title={s.user_agent}>{s.ip || 'unknown IP'} · {s.current ? 'active now' : `last active ${relativeTime(s.last_seen_at)}`} · signed in {relativeTime(s.created_at)}</div>
              </div>
              <button type="button" title={s.current ? 'Log out' : 'Log out this device'} onClick={() => end(s)} disabled={busy !== null} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:text-danger hover:bg-bg-3 disabled:opacity-50" data-session-logout><LogOut size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {others > 0 && <button type="button" className="btn-ghost py-1.5 text-danger" onClick={endOthers} disabled={busy !== null} data-sessions-logout-others>Log out all other devices ({others})</button>}
    </section>
  )
}

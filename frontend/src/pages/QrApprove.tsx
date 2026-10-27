import { MonitorSmartphone, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'

/** /login/qr/:id: someone scanned a login QR code while signed in here. Approve only if it's you. */
export default function QrApprovePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const me = useStore((s) => s.user)
  const [info, setInfo] = useState<{ device: string; ip: string; created_at: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<'approved' | 'denied' | null>(null)
  useEffect(() => { api.get<typeof info>(`/auth/qr/${id}/info`).then(setInfo).catch((e) => setErr((e as Error).message)) }, [id])
  const act = async (ok: boolean) => { try { await api.post(`/auth/qr/${id}/${ok ? 'approve' : 'deny'}`); setDone(ok ? 'approved' : 'denied') } catch (e) { setErr((e as Error).message) } }
  return (
    <div className="h-full overflow-y-auto flex items-center-safe justify-center bg-bg-0 p-4">
      <div className="pop w-full max-w-sm rounded-2xl border border-line bg-bg-1 p-6 text-center shadow-2xl" data-qr-approve>
        <MonitorSmartphone size={40} className="mx-auto text-accent" />
        {err ? <><h1 className="mt-3 text-lg font-bold">Can't use this code</h1><p className="mt-1 text-sm text-text-2">{err}</p></>
          : done ? <><h1 className="mt-3 text-lg font-bold">{done === 'approved' ? 'Signed in' : 'Refused'}</h1><p className="mt-1 text-sm text-text-2">{done === 'approved' ? 'The other device is signed in as you now.' : 'Nobody was signed in.'}</p><button type="button" className="btn-primary mt-4 w-full" onClick={() => navigate('/channels/@me')}>Done</button></>
          : !info ? <p className="mt-3 text-sm text-text-2">Loading…</p> : (
            <>
              <h1 className="mt-3 text-lg font-bold">Log in on another device?</h1>
              <p className="mt-1 text-sm text-text-2">It will be signed in as <b>{me?.display_name}</b>.</p>
              <div className="mt-3 rounded-lg bg-bg-0/60 p-2 text-left text-xs text-text-1"><div className="truncate" title={info.device}>{info.device || 'Unknown browser'}</div><div className="text-text-2">{info.ip} · {new Date(info.created_at).toLocaleTimeString()}</div></div>
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-2 text-left text-xs"><ShieldAlert size={14} className="mt-0.5 shrink-0 text-warn" />Only approve if you're signing in yourself, right now. Never scan a code someone sent you: they would get into your account.</div>
              <div className="mt-4 flex gap-2"><button type="button" className="btn-ghost flex-1" onClick={() => act(false)} data-qr-deny>No, that's not me</button><button type="button" className="btn-primary flex-1" onClick={() => act(true)} data-qr-yes>Yes, log in</button></div>
            </>
          )}
      </div>
    </div>
  )
}

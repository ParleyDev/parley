import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { PrivateUser } from '../lib/types'
import { publicOrigin } from './InviteCard'

/** The login page's QR code: scan it on a device where you're signed in and approve, and this screen signs in. */
export default function QrLogin({ onSession }: { onSession: (token: string, user: PrivateUser) => void }) {
  const [code, setCode] = useState<{ id: string; secret: string; img: string } | null>(null)
  const [status, setStatus] = useState<'pending' | 'scanned' | 'expired' | 'denied'>('pending')
  const [who, setWho] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let live = true
    api.post<{ id: string; secret: string }>('/auth/qr').then(async (r) => {
      const img = await QRCode.toDataURL(`${publicOrigin()}/login/qr/${r.id}`, { margin: 1, width: 176 })
      if (live) { setCode({ ...r, img }); setStatus('pending'); setWho(null) }
    }).catch(() => {})
    return () => { live = false }
  }, [round])
  useEffect(() => {
    if (!code || status === 'expired' || status === 'denied') return
    const t = setInterval(async () => {
      try {
        const r = await api.get<{ status: string; token?: string; user?: PrivateUser | { display_name: string } }>(`/auth/qr/${code.id}?secret=${encodeURIComponent(code.secret)}`)
        if (r.status === 'approved' && r.token && r.user) { clearInterval(t); onSession(r.token, r.user as PrivateUser); return }
        if (r.status === 'scanned') { setStatus('scanned'); setWho(r.user?.display_name ?? null) }
        if (r.status === 'expired' || r.status === 'used') setStatus('expired')
        if (r.status === 'denied') setStatus('denied')
      } catch { /* keep trying */ }
    }, 1500)
    return () => clearInterval(t)
  }, [code, status, onSession])
  return (
    <div className="flex flex-col items-center gap-3 text-center" data-qr-login data-qr-status={status}>
      <div className="relative rounded-xl bg-white p-2">
        {code ? <img src={code.img} alt="QR code to log in" className={`h-44 w-44 ${status !== 'pending' ? 'opacity-20' : ''}`} data-qr-code={code.id} /> : <div className="h-44 w-44" />}
        {(status === 'expired' || status === 'denied') && <button type="button" onClick={() => setRound((n) => n + 1)} className="absolute inset-0 m-auto h-10 w-32 rounded-full bg-accent text-sm font-semibold text-white" data-qr-refresh>New code</button>}
      </div>
      <div className="max-w-[220px]">
        {status === 'scanned' ? <><div className="font-semibold">Check your other device</div><p className="text-sm text-text-2">Approve the sign-in{who ? ` as ${who}` : ''} there.</p></>
          : status === 'denied' ? <p className="text-sm text-danger">The sign-in was refused.</p>
          : status === 'expired' ? <p className="text-sm text-text-2">This code expired.</p>
          : <><div className="font-semibold">Log in with a QR code</div><p className="text-sm text-text-2">Scan it on a phone or computer where you're already signed in.</p></>}
      </div>
    </div>
  )
}
